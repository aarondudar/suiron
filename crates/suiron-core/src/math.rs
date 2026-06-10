//! The M1 math kernels, naive and obviously correct.

pub fn silu(x: f32) -> f32 {
    x * (1.0 / (1.0 + (-x).exp()))
}

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

// Tests 
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
    fn rmsnorm_output_has_unit_rms() {
        // The defining property: after normalizing (unit weights), the rms
        // of the output is ~1, whatever the input scale was.
        let x = [100.0, -250.0, 42.0, 7.0];
        let out = rmsnorm(&x, &[1.0; 4], 1e-6);
        let rms = (out.iter().map(|v| v * v).sum::<f32>() / 4.0).sqrt();
        assert_close(rms, 1.0, 1e-4, "output rms");
    }
}
