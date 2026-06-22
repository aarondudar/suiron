//! Qwen3 weights + the architecture config from metadata. Tensor shapes are
//! row-major `[rows, cols]` — GGUF dims (innermost-first) are reversed once
//! at load; nothing downstream sees GGUF order.
//!
//! Each weight keeps an f32 copy (the permanent correctness reference) and,
//! when the source was Q8_0, the raw quantized blocks too — so the compute
//! backend is a runtime toggle, not a load-time decision.

use suiron_gguf::{GgmlType, GgufFile};

use crate::math::{matmul, matvec_q8_0};

/// Which arithmetic a weight·vector product uses. Same result (within
/// quantization tolerance), different memory traffic and speed. f32 is the
/// reference every other backend is checked against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// Dequantized f32 weights. The M1–M3 path; slowest, exact reference.
    F32,
    /// Q8_0 weights read directly as blocks (~4× less weight memory traffic).
    /// Not lossy vs F32 here — both start from the same Q8_0 weights on disk;
    /// Q8 just skips materializing them as f32.
    Q8,
}

impl Backend {
    pub fn parse(s: &str) -> Backend {
        match s {
            "q8" => Backend::Q8,
            _ => Backend::F32,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Backend::F32 => "f32",
            Backend::Q8 => "q8",
        }
    }
}

pub struct Tensor {
    pub data: Vec<f32>,
    /// Raw Q8_0 blocks (34 bytes each) when the source tensor was Q8_0;
    /// absent for f32 tensors (the norm weights).
    pub q8: Option<Vec<u8>>,
    /// Row-major. 2D weights: [out_dim, in_dim], so y = W·x is `matvec(x)`.
    /// 1D norms: [len].
    pub shape: Vec<usize>,
}

impl Tensor {
    /// y = W·x for a 2D weight [rows, cols], under the chosen backend.
    /// Q8 falls back to f32 if this tensor wasn't quantized.
    pub fn matvec(&self, x: &[f32], backend: Backend) -> Vec<f32> {
        let (rows, cols) = (self.shape[0], self.shape[1]);
        match (backend, &self.q8) {
            (Backend::Q8, Some(blocks)) => matvec_q8_0(blocks, x, rows, cols),
            _ => matmul(&self.data, x, rows, cols, 1),
        }
    }
}

pub struct Config {
    pub n_layers: usize,
    pub hidden: usize,
    pub n_heads: usize,
    pub n_kv_heads: usize,
    pub head_dim: usize,
    pub ffn: usize,
    pub vocab: usize,
    pub context: usize,
    pub rms_eps: f32,
    pub rope_base: f32,
}

impl Config {
    pub fn from_gguf(file: &GgufFile) -> Result<Self, String> {
        let arch = file.get_str("general.architecture").ok_or("missing architecture")?;
        let u = |key: &str| -> Result<usize, String> {
            file.get_u64(&format!("{arch}.{key}"))
                .map(|v| v as usize)
                .ok_or_else(|| format!("missing {arch}.{key}"))
        };
        let f = |key: &str| -> Result<f32, String> {
            file.get_f64(&format!("{arch}.{key}"))
                .map(|v| v as f32)
                .ok_or_else(|| format!("missing {arch}.{key}"))
        };
        Ok(Self {
            n_layers: u("block_count")?,
            hidden: u("embedding_length")?,
            n_heads: u("attention.head_count")?,
            n_kv_heads: u("attention.head_count_kv")?,
            head_dim: u("attention.key_length")?,
            ffn: u("feed_forward_length")?,
            context: u("context_length")?,
            rms_eps: f("attention.layer_norm_rms_epsilon")?,
            rope_base: f("rope.freq_base")?,
            vocab: file
                .tensor("token_embd.weight")
                .map(|t| t.dims.last().copied().unwrap_or(0) as usize)
                .ok_or("missing token_embd.weight")?,
        })
    }
}

pub struct Layer {
    pub attn_norm: Tensor, // [hidden]
    pub wq: Tensor,        // [n_heads * head_dim, hidden]
    pub wk: Tensor,        // [n_kv_heads * head_dim, hidden]
    pub wv: Tensor,        // [n_kv_heads * head_dim, hidden]
    pub wo: Tensor,        // [hidden, n_heads * head_dim]
    pub q_norm: Tensor,    // [head_dim] — Qwen3 per-head norm
    pub k_norm: Tensor,    // [head_dim]
    pub ffn_norm: Tensor,  // [hidden]
    pub ffn_gate: Tensor,  // [ffn, hidden]
    pub ffn_up: Tensor,    // [ffn, hidden]
    pub ffn_down: Tensor,  // [hidden, ffn]
}

pub struct Model {
    pub config: Config,
    pub token_embd: Tensor, // [vocab, hidden]; also the output projection (tied)
    pub layers: Vec<Layer>,
    pub output_norm: Tensor, // [hidden]
    /// Untied output projection; None for Qwen3-0.6B (tied embeddings).
    pub output: Option<Tensor>,
    /// L2 norm |emb_i| of every embedding row, precomputed once at load so a
    /// cosine query is a single matrix pass. One f32 per vocabulary entry.
    emb_norms: Vec<f32>,
}

impl Model {
    pub fn load(file: &GgufFile) -> Result<Self, String> {
        let config = Config::from_gguf(file)?;

        let tensor = |name: &str| -> Result<Tensor, String> {
            let info = file.tensor(name).ok_or_else(|| format!("missing tensor {name}"))?;
            let data = file.tensor_f32(info).map_err(|e| e.to_string())?;
            let shape: Vec<usize> = info.dims.iter().rev().map(|&d| d as usize).collect();
            // keep the raw Q8_0 blocks so the quantized backend can run without
            // reloading; cheap (a byte-slice copy) next to the f32 dequant.
            let q8 = match info.dtype {
                GgmlType::Q8_0 => Some(file.tensor_bytes(info).map_err(|e| e.to_string())?.to_vec()),
                _ => None,
            };
            Ok(Tensor { data, q8, shape })
        };
        let expect = |t: Tensor, shape: &[usize], name: &str| -> Result<Tensor, String> {
            if t.shape != shape {
                return Err(format!("{name}: shape {:?}, expected {shape:?}", t.shape));
            }
            Ok(t)
        };

        let (h, hd) = (config.hidden, config.head_dim);
        let (q_dim, kv_dim) = (config.n_heads * hd, config.n_kv_heads * hd);

        let mut layers = Vec::with_capacity(config.n_layers);
        for i in 0..config.n_layers {
            let t = |suffix: &str| tensor(&format!("blk.{i}.{suffix}.weight"));
            layers.push(Layer {
                attn_norm: expect(t("attn_norm")?, &[h], "attn_norm")?,
                wq: expect(t("attn_q")?, &[q_dim, h], "attn_q")?,
                wk: expect(t("attn_k")?, &[kv_dim, h], "attn_k")?,
                wv: expect(t("attn_v")?, &[kv_dim, h], "attn_v")?,
                wo: expect(t("attn_output")?, &[h, q_dim], "attn_output")?,
                q_norm: expect(t("attn_q_norm")?, &[hd], "attn_q_norm")?,
                k_norm: expect(t("attn_k_norm")?, &[hd], "attn_k_norm")?,
                ffn_norm: expect(t("ffn_norm")?, &[h], "ffn_norm")?,
                ffn_gate: expect(t("ffn_gate")?, &[config.ffn, h], "ffn_gate")?,
                ffn_up: expect(t("ffn_up")?, &[config.ffn, h], "ffn_up")?,
                ffn_down: expect(t("ffn_down")?, &[h, config.ffn], "ffn_down")?,
            });
        }

        let token_embd = expect(tensor("token_embd.weight")?, &[config.vocab, h], "token_embd")?;
        // Cache |emb_i| once; reused by every cosine-neighbor query.
        let emb_norms: Vec<f32> = (0..config.vocab)
            .map(|r| {
                let row = &token_embd.data[r * h..r * h + h];
                row.iter().map(|v| v * v).sum::<f32>().sqrt()
            })
            .collect();

        Ok(Self {
            token_embd,
            layers,
            output_norm: expect(tensor("output_norm.weight")?, &[h], "output_norm")?,
            output: file.tensor("output.weight").is_some().then(|| tensor("output.weight")).transpose()?,
            emb_norms,
            config,
        })
    }

    /// The row of token_embd for one token id: its 1024 meaning-numbers.
    pub fn embedding(&self, token: u32) -> &[f32] {
        let h = self.config.hidden;
        let start = token as usize * h;
        &self.token_embd.data[start..start + h]
    }

    /// Top-`n` vocabulary entries by cosine similarity to an arbitrary
    /// hidden-dim direction `query`, strongest first as `(token_id, cosine)`.
    ///
    /// `cos(a, b) = (a·b) / (|a| |b|)` over the whole embedding matrix, using
    /// the row norms cached at load. Pure over the resident model (no I/O, no
    /// mutation) so the future WASM build can call it directly. A token queried
    /// against its own row scores exactly 1.0.
    pub fn neighbors(&self, query: &[f32], n: usize) -> Vec<(u32, f32)> {
        let h = self.config.hidden;
        let qn = query.iter().map(|v| v * v).sum::<f32>().sqrt();
        if qn == 0.0 || n == 0 {
            return Vec::new();
        }
        let mut scored: Vec<(u32, f32)> = (0..self.config.vocab)
            .map(|r| {
                let row = &self.token_embd.data[r * h..r * h + h];
                let dot: f32 = row.iter().zip(query).map(|(a, b)| a * b).sum();
                let denom = self.emb_norms[r] * qn;
                let cos = if denom > 0.0 { dot / denom } else { 0.0 };
                (r as u32, cos)
            })
            .collect();
        // descending cosine; NaN-safe (treat as -inf so it sinks)
        scored.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(n);
        scored
    }

    /// Cosine neighbors of a token, using its own embedding row as the query.
    /// The first result is the token itself (cosine 1.0).
    pub fn neighbors_of(&self, token: u32, n: usize) -> Vec<(u32, f32)> {
        self.neighbors(self.embedding(token), n)
    }
}
