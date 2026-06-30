//! Conversion from on-disk dtypes to f32, used by the correctness-first CPU
//! path. Quantized formats stay in their native layout on the fast paths;
//! this module is for loading and for verifying those paths.

use crate::GgmlType;

pub fn f16_to_f32(bits: u16) -> f32 {
    let sign = (bits as u32 >> 15) << 31;
    let exp = (bits >> 10) & 0x1f;
    let frac = (bits & 0x3ff) as u32;

    let out = match exp {
        0 if frac == 0 => sign,
        0 => {
            // Subnormal: renormalize by shifting the fraction up to the
            // implicit-one position, adjusting the exponent per shift.
            let mut e = -14i32;
            let mut m = frac;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (((e + 127) as u32) << 23) | ((m & 0x3ff) << 13)
        }
        0x1f => sign | (0xff << 23) | (frac << 13), // inf / NaN
        _ => sign | ((exp as u32 + 127 - 15) << 23) | (frac << 13),
    };
    f32::from_bits(out)
}

pub fn bf16_to_f32(bits: u16) -> f32 {
    f32::from_bits((bits as u32) << 16)
}

/// Q8_0: blocks of 32 elements, stored as one f16 scale followed by 32
/// signed bytes. element = scale * quant.
pub fn dequantize_q8_0(raw: &[u8], out: &mut Vec<f32>) {
    debug_assert!(raw.len().is_multiple_of(34));
    for block in raw.chunks_exact(34) {
        let d = f16_to_f32(u16::from_le_bytes([block[0], block[1]]));
        out.extend(block[2..].iter().map(|&q| d * (q as i8) as f32));
    }
}

/// The 6-bit sub-block scale and min for sub-block `j` of a Q4_K super-block,
/// unpacked from the 12 `scales` bytes. Matches ggml's `get_scale_min_k4`.
fn q4_k_scale_min(j: usize, q: &[u8]) -> (u8, u8) {
    if j < 4 {
        (q[j] & 63, q[j + 4] & 63)
    } else {
        (
            (q[j + 4] & 0x0F) | ((q[j - 4] >> 6) << 4),
            (q[j + 4] >> 4) | ((q[j] >> 6) << 4),
        )
    }
}

/// Q4_K_M super-block (256 values, 144 bytes): f16 super-scale `d`, f16
/// super-min `dmin`, 12 bytes of 6-bit packed sub-block scales/mins, then 128
/// bytes of 4-bit quants. Value = d·scale·q − dmin·min. Mirrors ggml's
/// `dequantize_row_q4_K` exactly (eight 32-value sub-blocks, low then high
/// nibble, two scale/min pairs per 64).
pub fn dequantize_q4_k(raw: &[u8], out: &mut Vec<f32>) {
    debug_assert!(raw.len().is_multiple_of(144));
    for block in raw.chunks_exact(144) {
        let d = f16_to_f32(u16::from_le_bytes([block[0], block[1]]));
        let dmin = f16_to_f32(u16::from_le_bytes([block[2], block[3]]));
        let scales = &block[4..16];
        let qs = &block[16..144];
        for j in 0..4 {
            let is = j * 2;
            let (sc1, m1) = q4_k_scale_min(is, scales);
            let (sc2, m2) = q4_k_scale_min(is + 1, scales);
            let (d1, m1) = (d * sc1 as f32, dmin * m1 as f32);
            let (d2, m2) = (d * sc2 as f32, dmin * m2 as f32);
            let q = &qs[j * 32..j * 32 + 32];
            for &b in q {
                out.push(d1 * (b & 0x0F) as f32 - m1);
            }
            for &b in q {
                out.push(d2 * (b >> 4) as f32 - m2);
            }
        }
    }
}

/// Dequantize a whole tensor. Returns `None` for dtypes without a conversion
/// implemented yet.
pub fn dequantize(dtype: GgmlType, raw: &[u8]) -> Option<Vec<f32>> {
    let mut out = Vec::with_capacity(raw.len()); // close enough for all cases below
    match dtype {
        GgmlType::F32 => {
            out.extend(raw.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())));
        }
        GgmlType::F16 => {
            out.extend(
                raw.chunks_exact(2)
                    .map(|c| f16_to_f32(u16::from_le_bytes(c.try_into().unwrap()))),
            );
        }
        GgmlType::BF16 => {
            out.extend(
                raw.chunks_exact(2)
                    .map(|c| bf16_to_f32(u16::from_le_bytes(c.try_into().unwrap()))),
            );
        }
        GgmlType::Q8_0 => dequantize_q8_0(raw, &mut out),
        GgmlType::Q4K => dequantize_q4_k(raw, &mut out),
        _ => return None,
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f16_special_and_ordinary_values() {
        assert_eq!(f16_to_f32(0x3c00), 1.0);
        assert_eq!(f16_to_f32(0xc000), -2.0);
        assert_eq!(f16_to_f32(0x7bff), 65504.0); // largest finite f16
        assert_eq!(f16_to_f32(0x3555), 0.333_251_95);
        assert_eq!(f16_to_f32(0x0000), 0.0);
        assert!(f16_to_f32(0x8000).is_sign_negative());
        assert_eq!(f16_to_f32(0x7c00), f32::INFINITY);
        assert_eq!(f16_to_f32(0xfc00), f32::NEG_INFINITY);
        assert!(f16_to_f32(0x7e00).is_nan());
    }

    #[test]
    fn f16_subnormals() {
        assert_eq!(f16_to_f32(0x0001), 2.0f32.powi(-24)); // smallest positive
        assert_eq!(f16_to_f32(0x03ff), 2.0f32.powi(-14) - 2.0f32.powi(-24)); // largest subnormal
    }

    #[test]
    fn q8_0_roundtrip() {
        // One block: scale 0.5, quants -3, 7, then zeros.
        let mut raw = vec![0x00u8, 0x38]; // f16 0.5
        raw.push((-3i8) as u8);
        raw.push(7);
        raw.extend([0u8; 30]);

        let mut out = Vec::new();
        dequantize_q8_0(&raw, &mut out);
        assert_eq!(out.len(), 32);
        assert_eq!(out[0], -1.5);
        assert_eq!(out[1], 3.5);
        assert!(out[2..].iter().all(|&v| v == 0.0));
    }

    #[test]
    fn q4_k_scale_min_packing() {
        // j < 4: scale = scales[j] & 63, min = scales[j+4] & 63
        let s = [42u8, 0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(q4_k_scale_min(0, &s), (42 & 63, 17 & 63));
        // j >= 4 (the packed branch): high 2 bits of earlier bytes extend the
        // 6-bit value. scales[0]=0b1100_0000 → top bits 3; scales[8] low nibble 5.
        let mut s2 = [0u8; 12];
        s2[0] = 0b1100_0000; // q[j-4] for j=4 → (3 << 4) into the scale
        s2[8] = 0x05; // q[j+4] for j=4 → low nibble 5 into the scale
        let (d, _m) = q4_k_scale_min(4, &s2);
        assert_eq!(d, 5 | (3 << 4)); // 53
    }

    #[test]
    fn q4_k_dequant_known_block() {
        // 144-byte super-block: d = 1.0, dmin = 0.0, sub-block 0 scale = 2,
        // sub-block 1 scale = 3, qs[0] = 0x35 (low nibble 5, high nibble 3).
        let mut block = vec![0u8; 144];
        block[0] = 0x00;
        block[1] = 0x3c; // d = 1.0 (f16)
        block[2] = 0x00;
        block[3] = 0x00; // dmin = 0.0
        block[4] = 2; // scales[0] → sub-block 0 scale
        block[5] = 3; // scales[1] → sub-block 1 scale
        block[16] = 0x35; // qs[0]: low nibble 5 (value 0), high nibble 3 (value 32)

        let mut out = Vec::new();
        dequantize_q4_k(&block, &mut out);
        assert_eq!(out.len(), 256);
        // value 0  = d·scale0·(low nibble) − 0 = 1·2·5 = 10
        assert!((out[0] - 10.0).abs() < 1e-4, "out[0] = {}", out[0]);
        // value 32 = d·scale1·(high nibble) − 0 = 1·3·3 = 9
        assert!((out[32] - 9.0).abs() < 1e-4, "out[32] = {}", out[32]);
        assert_eq!(out[1], 0.0); // qs[1] = 0
        assert_eq!(out[33], 0.0);
    }
}
