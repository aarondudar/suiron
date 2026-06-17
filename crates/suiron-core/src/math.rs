//! The M1 math kernels, naive and obviously correct.

/// silu(x) = x * sigmoid(x). The nonlinearity inside SwiGLU.
pub fn silu(x: f32) -> f32 {
    x * (1.0 / (1.0 + (-x).exp()))
}

/// RMS-normalize: out[i] = x[i] * weight[i] / sqrt(mean(x²) + eps).
/// Resets the vector's overall magnitude to ~1 without changing its direction.
pub fn rmsnorm(x: &[f32], weight: &[f32], eps: f32) -> Vec<f32> {
    let sum_of_squares = x.iter().map(|v| v * v).sum::<f32>();
    let mean_of_squares = sum_of_squares / x.len() as f32;
    let rms = (mean_of_squares + eps).sqrt();
    let mut out = Vec::new();
    for i in 0..x.len() {
        out.push(x[i] * weight[i] / rms);
    }
    out
}

/// Scores → probability distribution (all positive, sums to 1).
/// Subtracts the max before exponentiating so big scores can't overflow.
pub fn softmax(x: &[f32]) -> Vec<f32> {
    let max = x.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
    let mut out = Vec::new();
    for v in x {
        out.push((v - max).exp());
    }
    let sum: f32 = out.iter().sum();
    for v in &mut out {
        *v /= sum;
    }
    out
}

/// C (m×n) = A (m×k) × B (k×n). All matrices flat, row-major:
/// element(row, col) = data[row * width + col].
pub fn matmul(a: &[f32], b: &[f32], m: usize, k: usize, n: usize) -> Vec<f32> {
    let mut c = vec![0.0f32; m * n];
    for i in 0..m {
        for j in 0..n {
            let mut acc: f32 = 0.0;
            for p in 0..k {
                acc += a[i * k + p] * b[p * n + j];
            }
            c[i * n + j] = acc;
        }
    }
    c
}

/// Dot product. The attention inner loop.
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// y = W·x where W is [rows, cols] stored as raw Q8_0 blocks (34 bytes:
/// f16 scale + 32 i8 quants), x is f32. Each block is dequantized in
/// registers and fused into the dot product — the full f32 weight matrix is
/// never materialized. Same arithmetic as `matmul(dequantize_q8_0(w), x)`,
/// but reading ~4× fewer weight bytes, which is the win on memory-bound
/// decode. `cols` must be a multiple of 32 (the Q8_0 block size).
pub fn matvec_q8_0(blocks: &[u8], x: &[f32], rows: usize, cols: usize) -> Vec<f32> {
    debug_assert_eq!(cols % 32, 0);
    debug_assert_eq!(x.len(), cols);
    let blocks_per_row = cols / 32;
    let mut out = vec![0.0f32; rows];
    for (r, o) in out.iter_mut().enumerate() {
        let mut acc = 0.0f32;
        let row_base = r * blocks_per_row * 34;
        for b in 0..blocks_per_row {
            let block = &blocks[row_base + b * 34..][..34];
            let scale = suiron_gguf::f16_to_f32(u16::from_le_bytes([block[0], block[1]]));
            let xb = &x[b * 32..][..32];
            let mut block_acc = 0.0f32;
            for i in 0..32 {
                block_acc += (block[2 + i] as i8) as f32 * xb[i];
            }
            acc += scale * block_acc;
        }
        *o = acc;
    }
    out
}

/// Rotary position embedding, in place on one head's q or k vector.
/// NeoX pairing (i with i+d/2), per-pair angle = pos * base^(-2i/d).
/// Qwen3: d = 128, base = 1e6 (`qwen3.rope.freq_base`).
pub fn rope(x: &mut [f32], pos: usize, base: f32) {
    let d = x.len();
    let half = d / 2;
    for i in 0..half {
        let freq_i = base.powf(-(2.0 * i as f32) / d as f32);
        let angle = pos as f32 * freq_i;
        let (sin, cos) = angle.sin_cos();

        let x0 = x[i];
        let x1 = x[i + half];

        x[i] = x0 * cos - x1 * sin;
        x[i + half] = x0 * sin + x1 * cos;
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    /// Floats are approximate; compare with a tolerance, never `==`.
    fn assert_close(got: f32, want: f32, tol: f32, what: &str) {
        assert!(
            (got - want).abs() <= tol,
            "{what}: got {got}, want {want} (tolerance {tol})"
        );
    }

    /// f32 → f16 little-endian bytes (round-toward-zero), enough for tests.
    fn f32_to_f16_le(v: f32) -> [u8; 2] {
        let bits = v.to_bits();
        let sign = ((bits >> 16) & 0x8000) as u16;
        let exp = ((bits >> 23) & 0xff) as i32 - 127 + 15;
        let frac = bits & 0x7f_ffff;
        let h = if exp <= 0 {
            sign
        } else if exp >= 0x1f {
            sign | 0x7c00
        } else {
            sign | ((exp as u16) << 10) | ((frac >> 13) as u16)
        };
        h.to_le_bytes()
    }

    /// Synthetic Q8_0 weight [rows, cols] + the exact f32 it dequantizes to.
    fn synthetic_q8(rows: usize, cols: usize) -> (Vec<u8>, Vec<f32>) {
        assert_eq!(cols % 32, 0);
        let mut blocks = Vec::new();
        let mut f32s = Vec::new();
        for r in 0..rows {
            for b in 0..cols / 32 {
                let scale = 0.05 + 0.01 * ((r + b) % 7) as f32;
                let sbytes = f32_to_f16_le(scale);
                let d = suiron_gguf::f16_to_f32(u16::from_le_bytes(sbytes));
                blocks.extend(sbytes);
                for i in 0..32 {
                    let q = (((r * 31 + b * 17 + i * 13) % 255) as i32 - 127) as i8;
                    blocks.push(q as u8);
                    f32s.push(d * q as f32);
                }
            }
        }
        (blocks, f32s)
    }

    #[test]
    fn matvec_q8_0_matches_f32_path() {
        // The quantized kernel must equal dequantize-then-matmul (same
        // arithmetic, just fused) — only tiny f32 reassociation differs.
        let (rows, cols) = (40, 128);
        let (blocks, weights) = synthetic_q8(rows, cols);
        let x: Vec<f32> = (0..cols).map(|i| ((i * 7 % 23) as f32 - 11.0) / 5.0).collect();

        let quant = matvec_q8_0(&blocks, &x, rows, cols);
        let reference = matmul(&weights, &x, rows, cols, 1);

        assert_eq!(quant.len(), rows);
        for (i, (q, r)) in quant.iter().zip(&reference).enumerate() {
            assert_close(*q, *r, 1e-3, &format!("row {i}"));
        }
    }

    #[test]
    fn silu_known_values() {
        // sigmoid(0) = 0.5, so silu(0) = 0 * 0.5 = 0
        assert_close(silu(0.0), 0.0, 1e-6, "silu(0)");
        // sigmoid(1) = 1/(1+e^-1) = 0.7310586
        assert_close(silu(1.0), 0.731_058_6, 1e-5, "silu(1)");
        // the characteristic dip below zero
        assert_close(silu(-1.0), -0.268_941_4, 1e-5, "silu(-1)");
        // large positive ≈ identity
        assert_close(silu(5.0), 4.966_536, 1e-4, "silu(5)");
        // large negative ≈ zero
        assert_close(silu(-5.0), -0.033_464, 1e-4, "silu(-5)");
    }

    #[test]
    fn rmsnorm_unit_weights() {
        // x = [2, -4, 4]: mean of squares = (4+16+16)/3 = 12, rms = sqrt(12) ≈ 3.4641
        let out = rmsnorm(&[2.0, -4.0, 4.0], &[1.0, 1.0, 1.0], 1e-6);
        assert_eq!(out.len(), 3);
        assert_close(out[0], 0.577_350_3, 1e-5, "out[0]");
        assert_close(out[1], -1.154_700_5, 1e-5, "out[1]");
        assert_close(out[2], 1.154_700_5, 1e-5, "out[2]");
    }

    #[test]
    fn rmsnorm_learned_weights_scale_each_dim() {
        // same x, but weight rescales each output element independently
        let out = rmsnorm(&[2.0, -4.0, 4.0], &[1.0, 0.5, 2.0], 1e-6);
        assert_close(out[0], 0.577_350_3, 1e-5, "out[0]");
        assert_close(out[1], -0.577_350_3, 1e-5, "out[1]");
        assert_close(out[2], 2.309_401, 1e-5, "out[2]");
    }

    #[test]
    fn softmax_known_values() {
        // exp([2,1,0] - max 2) = [1, e^-1, e^-2] = [1, 0.36788, 0.13534]
        // sum = 1.50321 → divide through
        let out = softmax(&[2.0, 1.0, 0.0]);
        assert_close(out[0], 0.665_240_9, 1e-5, "out[0]");
        assert_close(out[1], 0.244_728_5, 1e-5, "out[1]");
        assert_close(out[2], 0.090_030_6, 1e-5, "out[2]");
    }

    #[test]
    fn softmax_sums_to_one() {
        let out = softmax(&[0.3, -1.2, 4.5, 0.0, 2.2]);
        assert_close(out.iter().sum::<f32>(), 1.0, 1e-5, "sum");
        assert!(out.iter().all(|&v| v > 0.0), "all outputs positive");
    }

    #[test]
    fn softmax_survives_huge_scores() {
        // Without the subtract-max trick, e^800 = inf and this returns NaN.
        let out = softmax(&[800.0, 800.0]);
        assert_close(out[0], 0.5, 1e-5, "out[0]");
        assert_close(out[1], 0.5, 1e-5, "out[1]");
    }

    #[test]
    fn matmul_identity() {
        // I (2×2) × A (2×2) = A, the sanity check
        let identity = [1.0, 0.0, 0.0, 1.0];
        let a = [3.0, -1.0, 2.0, 5.0];
        let c = matmul(&identity, &a, 2, 2, 2);
        assert_eq!(c, vec![3.0, -1.0, 2.0, 5.0]);
    }

    #[test]
    fn matmul_rectangular() {
        // A (2×3) = [[1,2,3],[4,5,6]],  B (3×2) = [[7,8],[9,10],[11,12]]
        // C (2×2) = [[1·7+2·9+3·11, 1·8+2·10+3·12],
        //            [4·7+5·9+6·11, 4·8+5·10+6·12]] = [[58,64],[139,154]]
        // Non-square on purpose: swapping any two of m/k/n, or using the
        // wrong width in an index, makes this fail loudly.
        let a = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let b = [7.0, 8.0, 9.0, 10.0, 11.0, 12.0];
        let c = matmul(&a, &b, 2, 3, 2);
        assert_eq!(c, vec![58.0, 64.0, 139.0, 154.0]);
    }

    #[test]
    fn matmul_matrix_times_vector() {
        // n = 1: B is a column vector. This is the decode-time shape —
        // hidden-state vector through a weight matrix.
        // [[1,2,3],[4,5,6]] × [2,0,1] = [1·2+3, 4·2+6] = [5, 14]
        let a = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let v = [2.0, 0.0, 1.0];
        let c = matmul(&a, &v, 2, 3, 1);
        assert_eq!(c, vec![5.0, 14.0]);
    }

    #[test]
    fn rope_position_zero_changes_nothing() {
        // pos 0 → every angle is 0 → cos 1, sin 0 → identity rotation.
        let mut x = [0.3, -1.2, 4.5, 0.0];
        rope(&mut x, 0, 1e6);
        assert_eq!(x, [0.3, -1.2, 4.5, 0.0]);
    }

    #[test]
    fn rope_rotates_one_pair() {
        // d=2: one pair, freq_0 = base^0 = 1 (whatever the base), so the
        // angle IS the position. Rotating (1, 0) by 1 radian:
        let mut x = [1.0, 0.0];
        rope(&mut x, 1, 1e6);
        assert_close(x[0], 0.540_302_3, 1e-5, "x[0] = cos(1)");
        assert_close(x[1], 0.841_471_0, 1e-5, "x[1] = sin(1)");
    }

    #[test]
    fn rope_pairs_first_half_with_second_half() {
        // d=4, x = [1,0,0,0]. Element 0 pairs with element 2 (NeoX style).
        // Rotating pair (x[0], x[2]) = (1, 0) by 1 radian must move x[2],
        // and x[1]/x[3] (the other pair, both zero) must stay zero.
        // An adjacent-pairing implementation puts sin(1) into x[1] instead.
        let mut x = [1.0, 0.0, 0.0, 0.0];
        rope(&mut x, 1, 1e6);
        assert_close(x[0], 0.540_302_3, 1e-5, "x[0] = cos(1)");
        assert_close(x[1], 0.0, 1e-6, "x[1] untouched");
        assert_close(x[2], 0.841_471_0, 1e-5, "x[2] = sin(1)");
        assert_close(x[3], 0.0, 1e-6, "x[3] untouched");
    }

    #[test]
    fn rope_preserves_length() {
        // Rotation never changes a vector's length — only its direction.
        // Fails if x0 is overwritten before computing the second element.
        let mut x = [3.0, -1.0, 2.0, 0.5];
        let before: f32 = x.iter().map(|v| v * v).sum();
        rope(&mut x, 13, 1e6);
        let after: f32 = x.iter().map(|v| v * v).sum();
        assert_close(after, before, 1e-3, "sum of squares");
    }

    #[test]
    fn rmsnorm_output_has_unit_rms() {
        // The defining property: after normalizing (unit weights), the rms
        // of the output is ~1, whatever the input scale was.
        let x = [100.0, -250.0, 42.0, 7.0];
        let out = rmsnorm(&x, &[1.0; 4], 1e-6);
        let rms = (out.iter().map(|v| v * v).sum::<f32>() / 4.0).sqrt();
        assert_close(rms, 1.0, 1e-4, "output rms");
    }
}
