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
    rng: Rng,
}

impl Sampler {
    pub fn new(temperature: f32, top_k: usize, top_p: f32, seed: u64) -> Self {
        Self { temperature, top_k, top_p, rng: Rng::new(seed) }
    }

    pub fn greedy() -> Self {
        Self::new(0.0, 0, 1.0, 0)
    }

    pub fn sample(&mut self, logits: &[f32]) -> u32 {
        if self.temperature <= 0.0 {
            return argmax(logits);
        }

        let mut ranked: Vec<(u32, f32)> =
            logits.iter().enumerate().map(|(i, &l)| (i as u32, l)).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
        if self.top_k > 0 {
            ranked.truncate(self.top_k);
        }

        // softmax over the survivors at the given temperature
        let max = ranked[0].1;
        let mut sum = 0.0;
        let mut probs: Vec<f32> = ranked
            .iter()
            .map(|&(_, l)| {
                let p = ((l - max) / self.temperature).exp();
                sum += p;
                p
            })
            .collect();
        for p in &mut probs {
            *p /= sum;
        }

        // top-p: cut the tail once cumulative probability passes the nucleus
        if self.top_p < 1.0 {
            let mut cum = 0.0;
            let mut keep = probs.len();
            for (i, &p) in probs.iter().enumerate() {
                cum += p;
                if cum >= self.top_p {
                    keep = i + 1;
                    break;
                }
            }
            probs.truncate(keep);
            ranked.truncate(keep);
            let total: f32 = probs.iter().sum();
            for p in &mut probs {
                *p /= total;
            }
        }

        // draw
        let mut r = self.rng.next_f32();
        for (i, &p) in probs.iter().enumerate() {
            if r < p {
                return ranked[i].0;
            }
            r -= p;
        }
        ranked.last().map_or(0, |&(id, _)| id) // float-rounding fallback
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
    fn rng_is_roughly_uniform() {
        let mut rng = Rng::new(1);
        let mean: f32 = (0..10_000).map(|_| rng.next_f32()).sum::<f32>() / 10_000.0;
        assert!((mean - 0.5).abs() < 0.02, "mean {mean}");
    }
}
