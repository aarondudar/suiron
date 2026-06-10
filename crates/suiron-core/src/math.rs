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
