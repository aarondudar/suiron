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
}
