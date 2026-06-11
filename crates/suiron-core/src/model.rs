//! Qwen3 weights loaded to f32, plus the architecture config from metadata.
//! Tensor shapes are row-major `[rows, cols]` — GGUF dims (innermost-first)
//! are reversed once at load; nothing downstream sees GGUF order.

use suiron_gguf::GgufFile;

pub struct Tensor {
    pub data: Vec<f32>,
    /// Row-major. 2D weights: [out_dim, in_dim], so y = W·x is
    /// matmul(w, x, out_dim, in_dim, 1). 1D norms: [len].
    pub shape: Vec<usize>,
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
}

impl Model {
    pub fn load(file: &GgufFile) -> Result<Self, String> {
        let config = Config::from_gguf(file)?;

        let tensor = |name: &str| -> Result<Tensor, String> {
            let info = file.tensor(name).ok_or_else(|| format!("missing tensor {name}"))?;
            let data = file.tensor_f32(info).map_err(|e| e.to_string())?;
            let shape: Vec<usize> = info.dims.iter().rev().map(|&d| d as usize).collect();
            Ok(Tensor { data, shape })
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

        Ok(Self {
            token_embd: expect(tensor("token_embd.weight")?, &[config.vocab, h], "token_embd")?,
            layers,
            output_norm: expect(tensor("output_norm.weight")?, &[h], "output_norm")?,
            output: file.tensor("output.weight").is_some().then(|| tensor("output.weight")).transpose()?,
            config,
        })
    }

    /// The row of token_embd for one token id: its 1024 meaning-numbers.
    pub fn embedding(&self, token: u32) -> &[f32] {
        let h = self.config.hidden;
        let start = token as usize * h;
        &self.token_embd.data[start..start + h]
    }
}
