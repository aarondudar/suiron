//! GPU forward pass: every matvec (≈95% of FLOPs) runs on Metal; rmsnorm,
//! rope, attention softmax and residuals stay on CPU. Mirrors
//! suiron_core::forward — that CPU path is the correctness reference.

use crate::{Gpu, GpuBuf};
use suiron_core::forward::KvCache;
use suiron_core::math::{dot, rmsnorm, rope, silu, softmax};
use suiron_core::model::Model;

struct GpuLayer {
    wq: GpuBuf,
    wk: GpuBuf,
    wv: GpuBuf,
    wo: GpuBuf,
    gate: GpuBuf,
    up: GpuBuf,
    down: GpuBuf,
}

pub struct GpuModel<'m> {
    pub model: &'m Model,
    gpu: Gpu,
    layers: Vec<GpuLayer>,
    w_out: GpuBuf, // token_embd when tied
    // reusable scratch
    xb: GpuBuf,
    ffn_in: GpuBuf,
    out_q: GpuBuf,
    out_kv: GpuBuf,
    out_h: GpuBuf,
    out_ffn: GpuBuf,
    out_logits: GpuBuf,
}

impl<'m> GpuModel<'m> {
    pub fn new(model: &'m Model) -> Result<Self, String> {
        let gpu = Gpu::new()?;
        let c = &model.config;
        let layers = model
            .layers
            .iter()
            .map(|l| GpuLayer {
                wq: gpu.upload(&l.wq.data),
                wk: gpu.upload(&l.wk.data),
                wv: gpu.upload(&l.wv.data),
                wo: gpu.upload(&l.wo.data),
                gate: gpu.upload(&l.ffn_gate.data),
                up: gpu.upload(&l.ffn_up.data),
                down: gpu.upload(&l.ffn_down.data),
            })
            .collect();
        let w_out = gpu.upload(&model.output.as_ref().unwrap_or(&model.token_embd).data);
        Ok(Self {
            layers,
            w_out,
            xb: gpu.alloc(c.hidden),
            ffn_in: gpu.alloc(c.ffn),
            out_q: gpu.alloc(c.n_heads * c.head_dim),
            out_kv: gpu.alloc(c.n_kv_heads * c.head_dim),
            out_h: gpu.alloc(c.hidden),
            out_ffn: gpu.alloc(c.ffn),
            out_logits: gpu.alloc(c.vocab),
            gpu,
            model,
        })
    }

    fn matvec(&self, w: &GpuBuf, x: &[f32], xbuf: &GpuBuf, out: &GpuBuf, rows: usize) -> Vec<f32> {
        self.gpu.write(xbuf, x);
        self.gpu.matvec(w, xbuf, out, rows, x.len());
        let mut y = vec![0.0f32; rows];
        self.gpu.read(out, &mut y);
        y
    }

    /// Same contract as suiron_core::forward.
    pub fn forward(&self, cache: &mut KvCache, token: u32) -> Vec<f32> {
        let model = self.model;
        let c = &model.config;
        let (h, hd) = (c.hidden, c.head_dim);
        let q_dim = c.n_heads * hd;
        let kv_dim = c.n_kv_heads * hd;
        let group = c.n_heads / c.n_kv_heads;
        let scale = 1.0 / (hd as f32).sqrt();
        let pos = cache.len;

        let mut x = model.embedding(token).to_vec();

        for (li, (layer, gl)) in model.layers.iter().zip(&self.layers).enumerate() {
            let xn = rmsnorm(&x, &layer.attn_norm.data, c.rms_eps);
            let mut q = self.matvec(&gl.wq, &xn, &self.xb, &self.out_q, q_dim);
            let mut k = self.matvec(&gl.wk, &xn, &self.xb, &self.out_kv, kv_dim);
            let v = self.matvec(&gl.wv, &xn, &self.xb, &self.out_kv, kv_dim);

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

            cache.k[li].extend_from_slice(&k);
            cache.v[li].extend_from_slice(&v);
            let n_pos = pos + 1;

            let mut attn = vec![0.0f32; q_dim];
            for head in 0..c.n_heads {
                let kv_head = head / group;
                let qh = &q[head * hd..(head + 1) * hd];
                let mut scores = Vec::with_capacity(n_pos);
                for p in 0..n_pos {
                    let kp = &cache.k[li][p * kv_dim + kv_head * hd..][..hd];
                    scores.push(dot(qh, kp) * scale);
                }
                let weights = softmax(&scores);
                let out = &mut attn[head * hd..(head + 1) * hd];
                for (p, &w) in weights.iter().enumerate() {
                    let vp = &cache.v[li][p * kv_dim + kv_head * hd..][..hd];
                    for d in 0..hd {
                        out[d] += w * vp[d];
                    }
                }
            }
            let proj = self.matvec(&gl.wo, &attn, &self.ffn_in, &self.out_h, h);
            for i in 0..h {
                x[i] += proj[i];
            }

            let xn = rmsnorm(&x, &layer.ffn_norm.data, c.rms_eps);
            let mut gate = self.matvec(&gl.gate, &xn, &self.xb, &self.out_ffn, c.ffn);
            let up = self.matvec(&gl.up, &xn, &self.xb, &self.out_ffn, c.ffn);
            for i in 0..c.ffn {
                gate[i] = silu(gate[i]) * up[i];
            }
            let down = self.matvec(&gl.down, &gate, &self.ffn_in, &self.out_h, h);
            for i in 0..h {
                x[i] += down[i];
            }
        }

        cache.len = pos + 1;

        let xn = rmsnorm(&x, &model.output_norm.data, c.rms_eps);
        self.matvec(&self.w_out, &xn, &self.xb, &self.out_logits, c.vocab)
    }
}
