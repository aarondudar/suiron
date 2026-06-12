//! fp32 CPU forward pass with KV cache. One token per call; prefill loops.
//! Mirrors llama.cpp's build_qwen3: per-head q/k RMSNorm before NeoX RoPE,
//! GQA (q head h reads kv head h / (n_heads/n_kv_heads)), scale 1/√head_dim.

use crate::math::{dot, matmul, rmsnorm, rope, silu, softmax};
use crate::model::Model;

/// Per-layer K/V history. Layout per layer: [pos][kv_head][head_dim] flat.
#[derive(Clone)]
pub struct KvCache {
    pub k: Vec<Vec<f32>>,
    pub v: Vec<Vec<f32>>,
    pub len: usize,
    kv_dim: usize,
}

impl KvCache {
    pub fn new(model: &Model) -> Self {
        let c = &model.config;
        let kv_dim = c.n_kv_heads * c.head_dim;
        Self {
            k: vec![Vec::new(); c.n_layers],
            v: vec![Vec::new(); c.n_layers],
            len: 0,
            kv_dim,
        }
    }

    /// Drop cached positions beyond `len` (speculative-decode rollback).
    pub fn truncate(&mut self, len: usize) {
        for l in 0..self.k.len() {
            self.k[l].truncate(len * self.kv_dim);
            self.v[l].truncate(len * self.kv_dim);
        }
        self.len = len;
    }
}

/// Tracing hooks for the inference microscope. All no-ops by default, so
/// the standard recorder pays nothing for the deep-inspection hooks.
pub trait Observer {
    fn attention(&mut self, _layer: usize, _head: usize, _weights: &[f32]) {}
    fn residual(&mut self, _layer: usize, _norm: f32) {}
    /// Raw attention scores (pre-softmax, post-scale) for one head.
    fn scores(&mut self, _layer: usize, _head: usize, _scores: &[f32]) {}
    /// Named intermediate vectors ("x_in", "q", "gate", …) per layer.
    fn vector(&mut self, _layer: usize, _name: &'static str, _v: &[f32]) {}
}

/// Process one token at position `cache.len`; returns logits over the vocab.
pub fn forward(
    model: &Model,
    cache: &mut KvCache,
    token: u32,
    mut obs: Option<&mut dyn Observer>,
) -> Vec<f32> {
    let c = &model.config;
    let (h, hd) = (c.hidden, c.head_dim);
    let q_dim = c.n_heads * hd;
    let kv_dim = c.n_kv_heads * hd;
    let group = c.n_heads / c.n_kv_heads;
    let scale = 1.0 / (hd as f32).sqrt();
    let pos = cache.len;

    let mut x = model.embedding(token).to_vec();

    for (li, layer) in model.layers.iter().enumerate() {
        // --- attention block ---
        if let Some(o) = obs.as_deref_mut() {
            o.vector(li, "x_in", &x);
        }
        let xn = rmsnorm(&x, &layer.attn_norm.data, c.rms_eps);
        if let Some(o) = obs.as_deref_mut() {
            o.vector(li, "attn_norm", &xn);
        }
        let mut q = matmul(&layer.wq.data, &xn, q_dim, h, 1);
        let mut k = matmul(&layer.wk.data, &xn, kv_dim, h, 1);
        let v = matmul(&layer.wv.data, &xn, kv_dim, h, 1);

        // Qwen3: RMSNorm each head's q/k, then RoPE
        for head in 0..c.n_heads {
            let qh = &mut q[head * hd..(head + 1) * hd];
            qh.copy_from_slice(&rmsnorm(qh, &layer.q_norm.data, c.rms_eps));
            rope(qh, pos, c.rope_base);
        }
        for head in 0..c.n_kv_heads {
            let kh = &mut k[head * hd..(head + 1) * hd];
            kh.copy_from_slice(&rmsnorm(kh, &layer.k_norm.data, c.rms_eps));
            rope(kh, pos, c.rope_base);
        }

        if let Some(o) = obs.as_deref_mut() {
            o.vector(li, "q", &q);
            o.vector(li, "k", &k);
            o.vector(li, "v", &v);
        }
        cache.k[li].extend_from_slice(&k);
        cache.v[li].extend_from_slice(&v);
        let n_pos = pos + 1;

        // machine:attention:start
        let mut attn = vec![0.0f32; q_dim];
        for head in 0..c.n_heads {
            let kv_head = head / group;
            let qh = &q[head * hd..(head + 1) * hd];

            let mut scores = Vec::with_capacity(n_pos);
            for p in 0..n_pos {
                let kp = &cache.k[li][p * kv_dim + kv_head * hd..][..hd];
                scores.push(dot(qh, kp) * scale);
            }
            if let Some(o) = obs.as_deref_mut() {
                o.scores(li, head, &scores);
            }
            let weights = softmax(&scores);
            if let Some(o) = obs.as_deref_mut() {
                o.attention(li, head, &weights);
            }

            let out = &mut attn[head * hd..(head + 1) * hd];
            for (p, &w) in weights.iter().enumerate() {
                let vp = &cache.v[li][p * kv_dim + kv_head * hd..][..hd];
                for d in 0..hd {
                    out[d] += w * vp[d];
                }
            }
        }
        // machine:attention:end
        let proj = matmul(&layer.wo.data, &attn, h, q_dim, 1);
        for i in 0..h {
            x[i] += proj[i];
        }
        if let Some(o) = obs.as_deref_mut() {
            o.vector(li, "attn_out", &proj);
        }

        // machine:ffn:start
        let xn = rmsnorm(&x, &layer.ffn_norm.data, c.rms_eps);
        let mut gate = matmul(&layer.ffn_gate.data, &xn, c.ffn, h, 1);
        let up = matmul(&layer.ffn_up.data, &xn, c.ffn, h, 1);
        if let Some(o) = obs.as_deref_mut() {
            o.vector(li, "gate", &gate);
            o.vector(li, "up", &up);
        }
        for i in 0..c.ffn {
            gate[i] = silu(gate[i]) * up[i];
        }
        let down = matmul(&layer.ffn_down.data, &gate, h, c.ffn, 1);
        for i in 0..h {
            x[i] += down[i];
        }
        // machine:ffn:end
        if let Some(o) = obs.as_deref_mut() {
            o.vector(li, "gate_act", &gate);
            o.vector(li, "down", &down);
            o.vector(li, "x_out", &x);
            o.residual(li, (x.iter().map(|v| v * v).sum::<f32>() / h as f32).sqrt());
        }
    }

    cache.len = pos + 1;

    let xn = rmsnorm(&x, &model.output_norm.data, c.rms_eps);
    let w_out = model.output.as_ref().unwrap_or(&model.token_embd);
    matmul(&w_out.data, &xn, c.vocab, h, 1)
}

/// Run all `tokens` through the model; returns logits after the last one.
pub fn prefill(model: &Model, cache: &mut KvCache, tokens: &[u32]) -> Vec<f32> {
    let mut logits = Vec::new();
    for &t in tokens {
        logits = forward(model, cache, t, None);
    }
    logits
}
