//! "The machine" band: on-demand deep inspection of one position at one
//! layer (full intermediates, recomputed from a cloned KV cache), plus the
//! engine's own source code served for the code-level cards.

use crate::trace::escape_json;
use suiron_core::forward::Observer;

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

/// Serialize one deep inspection. `token` is (id, text) of the inspected
/// position.
pub fn inspect_json(obs: &DeepObserver, pos: usize, token: (u32, &str)) -> String {
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
    j.push_str("]}");
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
