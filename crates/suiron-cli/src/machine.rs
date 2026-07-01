//! "The machine" band: on-demand deep inspection of one position at one
//! layer (full intermediates, recomputed from a cloned KV cache), plus the
//! engine's own source code served for the code-level cards.

use crate::trace::escape_json;
use suiron_core::forward::{KvCache, Observer};
use suiron_core::model::Config;
use suiron_core::tokenizer::PreMerges;
use suiron_core::Model;

/// Serialize the BPE merge trace for one input (per pre-token): the byte-level
/// start, the ordered merges with their real ranks, and the final token ids.
pub fn merges_json(pms: &[PreMerges]) -> String {
    let arr = |out: &mut String, items: &[String]| {
        out.push('[');
        for (i, s) in items.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push('"');
            out.push_str(&escape_json(s));
            out.push('"');
        }
        out.push(']');
    };
    let mut j = String::from("{\"pretokens\":[");
    for (pi, pm) in pms.iter().enumerate() {
        if pi > 0 {
            j.push(',');
        }
        j.push_str("{\"start\":");
        arr(&mut j, &pm.start);
        j.push_str(",\"steps\":[");
        for (si, s) in pm.steps.iter().enumerate() {
            if si > 0 {
                j.push(',');
            }
            j.push_str(&format!(
                "{{\"left\":\"{}\",\"right\":\"{}\",\"rank\":{},\"result\":",
                escape_json(&s.left),
                escape_json(&s.right),
                s.rank
            ));
            arr(&mut j, &s.result);
            j.push('}');
        }
        j.push_str("],\"tokens\":[");
        for (i, id) in pm.ids.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&id.to_string());
        }
        j.push_str("]}");
    }
    j.push_str("]}");
    j
}

const SRC_MATH: &str = include_str!("../../suiron-core/src/math.rs");
const SRC_FORWARD: &str = include_str!("../../suiron-core/src/forward.rs");
const SRC_MODEL: &str = include_str!("../../suiron-core/src/model.rs");

/// Captures everything forward() reports for one target layer.
pub struct DeepObserver {
    pub layer: usize,
    pub vectors: Vec<(&'static str, Vec<f32>)>,
    pub scores: Vec<Vec<f32>>,  // per head, pre-softmax
    pub weights: Vec<Vec<f32>>, // per head, post-softmax
}

impl DeepObserver {
    pub fn new(layer: usize) -> Self {
        Self { layer, vectors: Vec::new(), scores: Vec::new(), weights: Vec::new() }
    }
}

impl Observer for DeepObserver {
    fn vector(&mut self, layer: usize, name: &'static str, v: &[f32]) {
        if layer == self.layer {
            self.vectors.push((name, v.to_vec()));
        }
    }
    fn scores(&mut self, layer: usize, _head: usize, s: &[f32]) {
        if layer == self.layer {
            self.scores.push(s.to_vec());
        }
    }
    fn attention(&mut self, layer: usize, _head: usize, w: &[f32]) {
        if layer == self.layer {
            self.weights.push(w.to_vec());
        }
    }
}

fn stats(v: &[f32]) -> (f32, f32, f32) {
    let rms = (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt();
    let min = v.iter().fold(f32::INFINITY, |a, &b| a.min(b));
    let max = v.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
    (rms, min, max)
}

fn vec_json(v: &[f32], head_n: usize) -> String {
    let (rms, min, max) = stats(v);
    let head: Vec<String> = v.iter().take(head_n).map(|x| format!("{x:.4}")).collect();
    format!(
        "{{\"head\":[{}],\"len\":{},\"rms\":{rms:.4},\"min\":{min:.4},\"max\":{max:.4}}}",
        head.join(","),
        v.len()
    )
}

/// One (head, source) query·key slice for the worked-dot-product demo: the full
/// `head_dim` query for `head` and the source position's key for that head's KV
/// group — the two vectors whose dot product, scaled by 1/√head_dim, is the
/// head's recorded score. Pure exposure of values `forward()` already produced;
/// no new compute.
pub struct WorkedDot {
    pub head: usize,
    pub src: usize,
    pub q: Vec<f32>,
    pub k: Vec<f32>,
    /// this head's value vector for each source position (KV group), so the web
    /// can step the blend Σ_p weight[p]·v[p]
    pub v: Vec<Vec<f32>>,
    /// the engine's recorded head context (that blend), for the "matches" check
    pub ctx: Vec<f32>,
    /// this head's query BEFORE RoPE (post per-head norm), so the web can show
    /// the rotation; `q` above is the same vector after RoPE
    pub q_pre: Vec<f32>,
    /// per-pair rotation angles RoPE applies at this position: pos·base^(-2i/d)
    /// for i in 0..head_dim/2 (pairs (i, i+head_dim/2))
    pub angles: Vec<f32>,
}

/// Pull the (head, src) query/key slice out of one deep inspection. `q` is the
/// post-norm+RoPE query recorded for this layer; `k` is the source key for this
/// head's KV group, read from the cache after the forward pass. `src_req`
/// defaults to the head's strongest attention edge. None if indices are out of
/// range (then the inspect response simply omits the slice).
pub fn worked_dot(
    obs: &DeepObserver,
    cache: &KvCache,
    head: usize,
    src_req: Option<usize>,
    pos: usize,
    cfg: &Config,
) -> Option<WorkedDot> {
    let hd = cfg.head_dim;
    let kv_dim = cfg.n_kv_heads * hd;
    let group = cfg.n_heads / cfg.n_kv_heads;
    if head >= cfg.n_heads {
        return None;
    }
    // the full post-norm+RoPE query vector forward() recorded for this layer
    let q = obs.vectors.iter().find(|kv| kv.0 == "q").map(|kv| &kv.1)?;
    let weights = obs.weights.get(head)?;
    if (head + 1) * hd > q.len() || weights.is_empty() {
        return None;
    }
    // strongest source by this head's softmax weights, unless one is requested
    let src = src_req.unwrap_or_else(|| {
        let mut m = 0;
        for i in 1..weights.len() {
            if weights[i] > weights[m] {
                m = i;
            }
        }
        m
    });
    let layer_k = cache.k.get(obs.layer)?;
    let start = src * kv_dim + (head / group) * hd;
    if src >= weights.len() || start + hd > layer_k.len() {
        return None;
    }
    // value vector for each source position (this head's KV group), for the blend
    let layer_v = cache.v.get(obs.layer)?;
    let kv_head = head / group;
    let n_pos = weights.len();
    let mut v = Vec::with_capacity(n_pos);
    for p in 0..n_pos {
        let vs = p * kv_dim + kv_head * hd;
        if vs + hd > layer_v.len() {
            return None;
        }
        v.push(layer_v[vs..vs + hd].to_vec());
    }
    // the engine's head context (Σ_p weights[p]·v[p]) recorded before the output
    // projection — the blend's target
    let ctx_full = obs.vectors.iter().find(|kv| kv.0 == "attn_ctx").map(|kv| &kv.1)?;
    if (head + 1) * hd > ctx_full.len() {
        return None;
    }
    // the pre-RoPE (post-norm) query for this head, plus the rotation angles RoPE
    // applies at this position — enough for the web to show q rotating
    let q_pre_full = obs.vectors.iter().find(|kv| kv.0 == "q_pre").map(|kv| &kv.1)?;
    if (head + 1) * hd > q_pre_full.len() {
        return None;
    }
    let half = hd / 2;
    let angles: Vec<f32> = (0..half)
        .map(|i| pos as f32 * cfg.rope_base.powf(-(2.0 * i as f32) / hd as f32))
        .collect();
    Some(WorkedDot {
        head,
        src,
        q: q[head * hd..head * hd + hd].to_vec(),
        k: layer_k[start..start + hd].to_vec(),
        v,
        ctx: ctx_full[head * hd..head * hd + hd].to_vec(),
        q_pre: q_pre_full[head * hd..head * hd + hd].to_vec(),
        angles,
    })
}

/// Captures the residual stream after every layer (`x_out`) for the logit lens.
#[derive(Default)]
pub struct LensObserver {
    pub residuals: Vec<Vec<f32>>,
}

impl Observer for LensObserver {
    fn vector(&mut self, _layer: usize, name: &'static str, v: &[f32]) {
        if name == "x_out" {
            self.residuals.push(v.to_vec());
        }
    }
}

/// Serialize the per-layer logit lens for one position: for each layer's
/// residual, the top-`k` tokens the model would predict if it stopped there.
/// `residuals` is one vector per layer in order (the LensObserver output).
pub fn lens_json(
    model: &Model,
    residuals: &[Vec<f32>],
    pos: usize,
    k: usize,
    decode: impl Fn(u32) -> String,
) -> String {
    let mut j = format!("{{\"pos\":{pos},\"layers\":[");
    for (l, res) in residuals.iter().enumerate() {
        if l > 0 {
            j.push(',');
        }
        j.push_str(&format!("{{\"layer\":{l},\"top\":["));
        for (i, (id, p)) in model.lens_topk(res, k).iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("[{id},\"{}\",{p:.4}]", escape_json(&decode(*id))));
        }
        j.push_str("]}");
    }
    j.push_str("]}");
    j
}

/// Serialize one deep inspection. `token` is (id, text) of the inspected
/// position. `worked`, when present, adds the full q/k slice for one (head,
/// src) so the web can step the real dot product.
pub fn inspect_json(
    obs: &DeepObserver,
    pos: usize,
    token: (u32, &str),
    worked: Option<&WorkedDot>,
) -> String {
    let mut j = String::with_capacity(1 << 16);
    j.push_str(&format!(
        "{{\"pos\":{pos},\"layer\":{},\"token\":{{\"id\":{},\"t\":\"{}\"}}",
        obs.layer,
        token.0,
        escape_json(token.1)
    ));
    for (name, v) in &obs.vectors {
        j.push_str(&format!(",\"{name}\":{}", vec_json(v, 8)));
    }
    j.push_str(",\"heads\":[");
    for (h, (scores, weights)) in obs.scores.iter().zip(&obs.weights).enumerate() {
        if h > 0 {
            j.push(',');
        }
        let s: Vec<String> = scores.iter().map(|x| format!("{x:.3}")).collect();
        let w: Vec<String> = weights.iter().map(|x| format!("{x:.4}")).collect();
        j.push_str(&format!("{{\"scores\":[{}],\"weights\":[{}]}}", s.join(","), w.join(",")));
    }
    j.push(']');
    if let Some(w) = worked {
        j.push_str(&format!(",\"worked\":{{\"head\":{},\"src\":{},\"q\":[", w.head, w.src));
        for (i, x) in w.q.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{x:.6}"));
        }
        j.push_str("],\"k\":[");
        for (i, x) in w.k.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{x:.6}"));
        }
        // value vector per source (for the blend) and the engine head context
        j.push_str("],\"v\":[");
        for (i, vp) in w.v.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push('[');
            for (d, x) in vp.iter().enumerate() {
                if d > 0 {
                    j.push(',');
                }
                j.push_str(&format!("{x:.6}"));
            }
            j.push(']');
        }
        j.push_str("],\"ctx\":[");
        for (i, x) in w.ctx.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{x:.6}"));
        }
        // pre-RoPE query and the per-pair rotation angles (for the RoPE demo)
        j.push_str("],\"q_pre\":[");
        for (i, x) in w.q_pre.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{x:.6}"));
        }
        j.push_str("],\"angles\":[");
        for (i, x) in w.angles.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{x:.6}"));
        }
        j.push_str("]}");
    }
    j.push('}');
    j
}

/// The real engine source for a named piece. Functions are extracted by
/// signature + brace matching; blocks by `// machine:<name>:start/end`.
pub fn source_for(name: &str) -> Option<String> {
    match name {
        "silu" | "rmsnorm" | "softmax" | "dot" | "matmul" | "rope" => {
            extract_fn(SRC_MATH, name)
        }
        "embedding" => extract_fn(SRC_MODEL, name),
        "forward" => extract_fn(SRC_FORWARD, name),
        "attention" | "ffn" => extract_block(SRC_FORWARD, name),
        _ => None,
    }
}

fn extract_fn(src: &str, name: &str) -> Option<String> {
    // prefer the full signature so we never anchor on a different function
    let sig_pos = src
        .find(&format!("pub fn {name}("))
        .or_else(|| src.find(&format!("fn {name}(")))?;
    // walk back over the doc-comment lines directly above the signature
    let mut start = src[..sig_pos].rfind('\n').map_or(0, |p| p + 1);
    loop {
        let prev_end = src[..start.saturating_sub(1)].rfind('\n').map_or(0, |p| p + 1);
        if prev_end == start {
            break;
        }
        let prev = src[prev_end..start].trim_start();
        if prev.starts_with("///") || prev.starts_with("//") {
            start = prev_end;
            if prev_end == 0 {
                break;
            }
        } else {
            break;
        }
    }
    let open = src[sig_pos..].find('{')? + sig_pos;
    let mut depth = 0usize;
    for (i, c) in src[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(src[start..=open + i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_block(src: &str, name: &str) -> Option<String> {
    let start_marker = format!("// machine:{name}:start");
    let end_marker = format!("// machine:{name}:end");
    let s = src.find(&start_marker)? + start_marker.len();
    let e = src.find(&end_marker)?;
    Some(dedent(src[s..e].trim_matches('\n')))
}

fn dedent(block: &str) -> String {
    let indent = block
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    block
        .lines()
        .map(|l| if l.len() >= indent { &l[indent..] } else { l })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_known_functions() {
        for name in ["silu", "rmsnorm", "softmax", "rope", "matmul", "dot", "embedding"] {
            let src = source_for(name).unwrap_or_else(|| panic!("no source for {name}"));
            assert!(src.contains(&format!("fn {name}(")), "{name}: bad extraction");
            assert!(src.trim_end().ends_with('}'), "{name}: unbalanced");
            // exactly one function: no bleed from neighbors
            assert_eq!(src.matches("pub fn ").count(), 1, "{name}: includes neighbor fn");
        }
    }

    #[test]
    fn extracts_marked_blocks() {
        let attn = source_for("attention").expect("attention block");
        assert!(attn.contains("dot(qh, kp) * scale"));
        let ffn = source_for("ffn").expect("ffn block");
        assert!(ffn.contains("silu(gate[i]) * up[i]"));
    }
}
