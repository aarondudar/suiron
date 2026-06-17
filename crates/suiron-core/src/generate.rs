//! Generation loop: prefill the prompt, then sample/feed-back until a stop
//! token or the budget runs out. Printing is the caller's job (on_token).

use crate::forward::{forward, prefill, KvCache};
use crate::model::{Backend, Model};
use crate::sampling::Sampler;
use std::time::{Duration, Instant};

pub struct GenStats {
    pub prompt_tokens: usize,
    pub gen_tokens: usize,
    pub prefill: Duration,
    pub decode: Duration,
}

impl GenStats {
    pub fn prefill_tps(&self) -> f64 {
        self.prompt_tokens as f64 / self.prefill.as_secs_f64()
    }
    pub fn decode_tps(&self) -> f64 {
        self.gen_tokens as f64 / self.decode.as_secs_f64().max(1e-9)
    }
}

#[allow(clippy::too_many_arguments)]
pub fn generate(
    model: &Model,
    prompt: &[u32],
    sampler: &mut Sampler,
    max_tokens: usize,
    stop: &[u32],
    backend: Backend,
    mut on_token: impl FnMut(u32),
) -> GenStats {
    let mut cache = KvCache::new(model);

    let t0 = Instant::now();
    let mut logits = prefill(model, &mut cache, prompt, backend);
    let prefill_time = t0.elapsed();

    let t1 = Instant::now();
    let mut gen_tokens = 0;
    for _ in 0..max_tokens {
        let id = sampler.sample(&logits);
        if stop.contains(&id) {
            break;
        }
        on_token(id);
        gen_tokens += 1;
        logits = forward(model, &mut cache, id, backend, None);
    }

    GenStats {
        prompt_tokens: prompt.len(),
        gen_tokens,
        prefill: prefill_time,
        decode: t1.elapsed(),
    }
}
