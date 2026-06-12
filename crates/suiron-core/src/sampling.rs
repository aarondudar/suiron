//! Token sampling: greedy, temperature, top-k, top-p. Seeded xorshift64*
//! RNG so runs are reproducible.

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1)) // xorshift state must be nonzero
    }

    /// Uniform in [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let x = self.0.wrapping_mul(0x2545_f491_4f6c_dd1d);
        (x >> 40) as f32 / (1u64 << 24) as f32
    }
}

pub struct Sampler {
    /// <= 0 means greedy (argmax); ignores all other settings.
    pub temperature: f32,
    /// 0 disables.
    pub top_k: usize,
    /// >= 1.0 disables.
    pub top_p: f32,
    pub seed: u64,
    rng: Rng,
}

/// One candidate's journey through the sampling pipeline.
pub struct Cand {
    pub id: u32,
    pub logit: f32,
    /// softmax probability at temperature among top-k survivors (0 if cut).
    pub p: f32,
    /// renormalized probability after the top-p cut (0 if cut).
    pub p_final: f32,
    /// which stage eliminated it, if any: "top-k" | "top-p".
    pub cut: Option<&'static str>,
}

/// Full record of one sampling decision, for the microscope.
pub struct SampleTrace {
    pub temperature: f32,
    pub top_k: usize,
    pub top_p: f32,
    pub seed: u64,
    /// the uniform draw in [0,1); None for greedy.
    pub r: Option<f32>,
    pub chosen: u32,
    /// true when a human forced this token (counterfactual fork) — the
    /// model's own preferences are still recorded in `cand`.
    pub forced: bool,
    /// top candidates by logit (chosen one always included).
    pub cand: Vec<Cand>,
}

const TRACE_CANDS: usize = 12;

impl Sampler {
    pub fn new(temperature: f32, top_k: usize, top_p: f32, seed: u64) -> Self {
        Self { temperature, top_k, top_p, seed, rng: Rng::new(seed) }
    }

    pub fn greedy() -> Self {
        Self::new(0.0, 0, 1.0, 0)
    }

    pub fn sample(&mut self, logits: &[f32]) -> u32 {
        self.sample_traced(logits).0
    }

    /// Sample and explain: identical decision to `sample`, plus the record
    /// of every pipeline stage with the actual numbers.
    pub fn sample_traced(&mut self, logits: &[f32]) -> (u32, SampleTrace) {
        let mut ranked: Vec<(u32, f32)> =
            logits.iter().enumerate().map(|(i, &l)| (i as u32, l)).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1));

        let mut trace = SampleTrace {
            temperature: self.temperature,
            top_k: self.top_k,
            top_p: self.top_p,
            seed: self.seed,
            r: None,
            chosen: ranked[0].0,
            forced: false,
            cand: Vec::new(),
        };

        if self.temperature <= 0.0 {
            // greedy: highest logit wins, nothing else matters
            trace.cand = ranked
                .iter()
                .take(TRACE_CANDS)
                .enumerate()
                .map(|(i, &(id, logit))| Cand {
                    id,
                    logit,
                    p: if i == 0 { 1.0 } else { 0.0 },
                    p_final: if i == 0 { 1.0 } else { 0.0 },
                    cut: None,
                })
                .collect();
            return (trace.chosen, trace);
        }

        // 1. top-k guillotine
        let kept_k = if self.top_k > 0 { self.top_k.min(ranked.len()) } else { ranked.len() };

        // 2. softmax at temperature over the survivors
        let max = ranked[0].1;
        let mut sum = 0.0;
        let probs: Vec<f32> = ranked[..kept_k]
            .iter()
            .map(|&(_, l)| {
                let p = ((l - max) / self.temperature).exp();
                sum += p;
                p
            })
            .collect();
        let probs: Vec<f32> = probs.iter().map(|p| p / sum).collect();

        // 3. top-p nucleus cut
        let mut kept_p = kept_k;
        if self.top_p < 1.0 {
            let mut cum = 0.0;
            for (i, &p) in probs.iter().enumerate() {
                cum += p;
                if cum >= self.top_p {
                    kept_p = i + 1;
                    break;
                }
            }
        }
        let total: f32 = probs[..kept_p].iter().sum();

        // 4. the draw
        let r = self.rng.next_f32();
        let mut walk = r;
        let mut chosen_idx = kept_p - 1; // float-rounding fallback
        for (i, &p) in probs[..kept_p].iter().enumerate() {
            let pf = p / total;
            if walk < pf {
                chosen_idx = i;
                break;
            }
            walk -= pf;
        }
        trace.r = Some(r);
        trace.chosen = ranked[chosen_idx].0;

        trace.cand = ranked
            .iter()
            .take(TRACE_CANDS.max(chosen_idx + 1))
            .enumerate()
            .map(|(i, &(id, logit))| Cand {
                id,
                logit,
                p: if i < kept_k { probs[i] } else { 0.0 },
                p_final: if i < kept_p { probs[i] / total } else { 0.0 },
                cut: if i >= kept_k {
                    Some("top-k")
                } else if i >= kept_p {
                    Some("top-p")
                } else {
                    None
                },
            })
            .collect();

        (trace.chosen, trace)
    }
}

pub fn argmax(logits: &[f32]) -> u32 {
    let mut best = 0;
    for (i, &l) in logits.iter().enumerate() {
        if l > logits[best] {
            best = i;
        }
    }
    best as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greedy_picks_argmax() {
        let mut s = Sampler::greedy();
        assert_eq!(s.sample(&[0.1, 5.0, -2.0, 4.9]), 1);
    }

    #[test]
    fn seeded_sampling_is_reproducible() {
        let logits = vec![1.0, 0.9, 0.8, 0.1, -1.0];
        let a: Vec<u32> =
            (0..20).scan(Sampler::new(0.8, 0, 0.95, 42), |s, _| Some(s.sample(&logits))).collect();
        let b: Vec<u32> =
            (0..20).scan(Sampler::new(0.8, 0, 0.95, 42), |s, _| Some(s.sample(&logits))).collect();
        assert_eq!(a, b);
    }

    #[test]
    fn top_k_one_is_greedy() {
        let mut s = Sampler::new(1.0, 1, 1.0, 7);
        for _ in 0..10 {
            assert_eq!(s.sample(&[0.0, 3.0, 1.0]), 1);
        }
    }

    #[test]
    fn traced_sample_matches_untraced() {
        let logits = vec![1.0, 0.9, 0.8, 0.1, -1.0, 2.3, 0.0];
        let mut a = Sampler::new(0.8, 4, 0.9, 99);
        let mut b = Sampler::new(0.8, 4, 0.9, 99);
        for _ in 0..30 {
            assert_eq!(a.sample(&logits), b.sample_traced(&logits).0);
        }
    }

    #[test]
    fn trace_records_pipeline() {
        let mut s = Sampler::new(1.0, 3, 0.99, 5);
        let (chosen, t) = s.sample_traced(&[5.0, 4.0, 3.0, 2.0, 1.0]);
        assert!(t.cand.iter().any(|c| c.id == chosen && c.cut.is_none()));
        assert_eq!(t.cand[3].cut, Some("top-k")); // 4th candidate, top_k=3
        assert!(t.r.unwrap() >= 0.0 && t.r.unwrap() < 1.0);
        // surviving p_final sums to ~1
        let pf: f32 = t.cand.iter().map(|c| c.p_final).sum();
        assert!((pf - 1.0).abs() < 1e-4, "pf sum {pf}");
    }

    #[test]
    fn greedy_trace_is_argmax_story() {
        let mut s = Sampler::greedy();
        let (chosen, t) = s.sample_traced(&[0.5, 9.0, 3.0]);
        assert_eq!(chosen, 1);
        assert_eq!(t.r, None);
        assert_eq!(t.cand[0].id, 1);
        assert_eq!(t.cand[0].p_final, 1.0);
    }

    #[test]
    fn rng_is_roughly_uniform() {
        let mut rng = Rng::new(1);
        let mean: f32 = (0..10_000).map(|_| rng.next_f32()).sum::<f32>() / 10_000.0;
        assert!((mean - 0.5).abs() < 0.02, "mean {mean}");
    }
}
