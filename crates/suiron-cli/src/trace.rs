//! Trace recording for the inference microscope: implements the forward
//! pass's Observer hooks and serializes to versioned JSON (hand-rolled
//! writer, std only).

use suiron_core::forward::Observer;
use suiron_core::model::Config;
use suiron_core::sampling::SampleTrace;

pub struct Step {
    /// [layer][head] → top-k (position, weight) attention edges.
    pub attn: Vec<Vec<Vec<(usize, f32)>>>,
    /// RMS of the residual stream after each layer.
    pub rnorm: Vec<f32>,
    /// Top-k (token id, prob) next-token predictions after this position.
    pub top: Vec<(u32, f32)>,
    /// How THIS token was selected (None for prompt tokens — they're given).
    pub sel: Option<SampleTrace>,
}

pub struct Recorder {
    pub steps: Vec<Step>,
    top_edges: usize,
}

impl Recorder {
    pub fn new(top_edges: usize) -> Self {
        Self { steps: Vec::new(), top_edges }
    }

    /// Call before each forward() so hooks land in the right step.
    pub fn begin_step(&mut self) {
        self.steps.push(Step { attn: Vec::new(), rnorm: Vec::new(), top: Vec::new(), sel: None });
    }

    /// Attach the sampling decision that produced this step's token.
    pub fn set_sel(&mut self, sel: SampleTrace) {
        if let Some(s) = self.steps.last_mut() {
            s.sel = Some(sel);
        }
    }

    /// Record top-k softmax probabilities from raw logits.
    pub fn record_logits(&mut self, logits: &[f32], k: usize) {
        let max = logits.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
        let sum: f32 = logits.iter().map(|&l| (l - max).exp()).sum();
        let mut ranked: Vec<(u32, f32)> = logits
            .iter()
            .enumerate()
            .map(|(i, &l)| (i as u32, (l - max).exp() / sum))
            .collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
        ranked.truncate(k);
        if let Some(s) = self.steps.last_mut() {
            s.top = ranked;
        }
    }
}

impl Observer for Recorder {
    fn attention(&mut self, layer: usize, _head: usize, weights: &[f32]) {
        let step = self.steps.last_mut().expect("begin_step before forward");
        if step.attn.len() == layer {
            step.attn.push(Vec::new());
        }
        let mut idx: Vec<usize> = (0..weights.len()).collect();
        idx.sort_by(|&a, &b| weights[b].total_cmp(&weights[a]));
        idx.truncate(self.top_edges);
        step.attn[layer].push(idx.into_iter().map(|p| (p, weights[p])).collect());
    }

    fn residual(&mut self, _layer: usize, norm: f32) {
        self.steps.last_mut().expect("begin_step before forward").rnorm.push(norm);
    }
}

pub fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// The discarded half of a counterfactual fork (docs/22): the tail of the
/// replaced run from the fork point on. The prefix [0, pos) is shared with the
/// live run, so only the tail is stored — recorded top-k summaries, one level
/// deep (the next fork replaces it), cleared by the next generate.
pub struct Shadow {
    pub pos: usize,
    /// the tail's text, for the one-line fork note
    pub prev: String,
    /// the discarded tokens from `pos` on
    pub tokens: Vec<(u32, String)>,
    /// their steps, aligned with `tokens`
    pub steps: Vec<Step>,
    /// the replaced run's prompt length (exceeds `pos` when forking inside the prompt)
    pub n_prompt: usize,
}

impl Shadow {
    /// Split the resident run at `pos`: the tail moves into the shadow (no
    /// copies), the prefix stays resident. The caller then forces the
    /// counterfactual token at `pos` and continues generating.
    pub fn capture(
        pos: usize,
        tokens: &mut Vec<(u32, String)>,
        steps: &mut Vec<Step>,
        n_prompt: usize,
    ) -> Shadow {
        let tail_tokens: Vec<(u32, String)> = tokens.drain(pos..).collect();
        let tail_steps: Vec<Step> = steps.drain(pos..).collect();
        let prev = tail_tokens.iter().map(|(_, t)| t.as_str()).collect();
        Shadow { pos, prev, tokens: tail_tokens, steps: tail_steps, n_prompt }
    }
}

/// Live-session fields the lab UI polls on. None for a static recorded trace.
pub struct Live {
    pub busy: bool,
    pub seq: u64,
    pub backend: &'static str,
    /// last measured decode tok/s per backend, for the speed comparison
    pub tps_f32: Option<f64>,
    pub tps_q8: Option<f64>,
}

/// Serialize a complete trace. Format v1; the viewer depends on this shape.
#[allow(clippy::too_many_arguments)]
pub fn write_trace(
    model_name: &str,
    quant: &str,
    config: &Config,
    tokens: &[(u32, String)],
    n_prompt: usize,
    steps: &[Step],
    live: Option<&Live>,
    fork: Option<&Shadow>,
    decode: impl Fn(u32) -> String,
) -> String {
    let mut j = String::with_capacity(1 << 20);
    j.push_str(&format!(
        "{{\"v\":1,\"model\":\"{}\",\"quant\":\"{}\",\"layers\":{},\"heads\":{},\"kv_heads\":{},\"head_dim\":{},\"n_prompt\":{},",
        escape_json(model_name), quant, config.n_layers, config.n_heads, config.n_kv_heads, config.head_dim, n_prompt
    ));
    if let Some(l) = live {
        let f = |t: Option<f64>| t.map_or("null".to_string(), |v| format!("{v:.2}"));
        j.push_str(&format!(
            "\"live\":true,\"busy\":{},\"seq\":{},\"backend\":\"{}\",\"tps\":{{\"f32\":{},\"q8\":{}}},",
            l.busy, l.seq, l.backend, f(l.tps_f32), f(l.tps_q8)
        ));
    }
    if let Some(sh) = fork {
        j.push_str(&format!(
            "\"fork\":{{\"pos\":{},\"prev\":\"{}\",\"n_prompt\":{},\"tokens\":",
            sh.pos,
            escape_json(&sh.prev),
            sh.n_prompt
        ));
        write_tokens_json(&mut j, &sh.tokens);
        j.push_str(",\"steps\":");
        write_steps_json(&mut j, &sh.steps, &decode);
        j.push_str("},");
    }

    j.push_str("\"tokens\":");
    write_tokens_json(&mut j, tokens);
    j.push_str(",\"steps\":");
    write_steps_json(&mut j, steps, &decode);
    j.push('}');
    j
}

/// `[{"id":..,"t":".."}, …]`
fn write_tokens_json(j: &mut String, tokens: &[(u32, String)]) {
    j.push('[');
    for (i, (id, text)) in tokens.iter().enumerate() {
        if i > 0 {
            j.push(',');
        }
        j.push_str(&format!("{{\"id\":{id},\"t\":\"{}\"}}", escape_json(text)));
    }
    j.push(']');
}

/// The steps array, exactly as the viewer reads it — shared by the live run
/// and the fork's shadow so both serialize byte-identically.
fn write_steps_json(j: &mut String, steps: &[Step], decode: &impl Fn(u32) -> String) {
    j.push('[');
    for (si, step) in steps.iter().enumerate() {
        if si > 0 {
            j.push(',');
        }
        j.push_str("{\"attn\":[");
        for (li, layer) in step.attn.iter().enumerate() {
            if li > 0 {
                j.push(',');
            }
            j.push('[');
            for (hi, head) in layer.iter().enumerate() {
                if hi > 0 {
                    j.push(',');
                }
                j.push('[');
                for (ei, &(p, w)) in head.iter().enumerate() {
                    if ei > 0 {
                        j.push(',');
                    }
                    j.push_str(&format!("[{p},{w:.4}]"));
                }
                j.push(']');
            }
            j.push(']');
        }
        j.push_str("],\"rnorm\":[");
        for (i, n) in step.rnorm.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{n:.3}"));
        }
        j.push_str("],\"top\":[");
        for (i, &(id, p)) in step.top.iter().enumerate() {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("[{id},\"{}\",{p:.4}]", escape_json(&decode(id))));
        }
        j.push(']');
        if let Some(sel) = &step.sel {
            j.push_str(&format!(
                ",\"sel\":{{\"temp\":{},\"top_k\":{},\"top_p\":{},\"seed\":{},\"r\":{},\"chosen\":{},\"forced\":{},\"cand\":[",
                sel.temperature,
                sel.top_k,
                sel.top_p,
                sel.seed,
                sel.r.map_or("null".to_string(), |r| format!("{r:.4}")),
                sel.chosen,
                sel.forced,
            ));
            for (i, c) in sel.cand.iter().enumerate() {
                if i > 0 {
                    j.push(',');
                }
                j.push_str(&format!(
                    "{{\"id\":{},\"t\":\"{}\",\"logit\":{:.3},\"p\":{:.4},\"pf\":{:.4},\"cut\":\"{}\"}}",
                    c.id,
                    escape_json(&decode(c.id)),
                    c.logit,
                    c.p,
                    c.p_final,
                    c.cut.unwrap_or(""),
                ));
            }
            j.push_str("]}");
        }
        j.push('}');
    }
    j.push(']');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(top: &[(u32, f32)]) -> Step {
        Step { attn: vec![vec![vec![(0, 1.0)]]], rnorm: vec![1.0], top: top.to_vec(), sel: None }
    }

    fn run(n: usize) -> (Vec<(u32, String)>, Vec<Step>) {
        let tokens: Vec<(u32, String)> = (0..n as u32).map(|i| (i, format!("t{i}"))).collect();
        let steps: Vec<Step> = (0..n as u32).map(|i| step(&[(i, 0.5)])).collect();
        (tokens, steps)
    }

    #[test]
    fn shadow_capture_splits_at_the_fork_point() {
        let (mut tokens, mut steps) = run(5);
        let sh = Shadow::capture(3, &mut tokens, &mut steps, 2);
        // the prefix stays resident; the tail moves into the shadow
        assert_eq!(tokens.len(), 3);
        assert_eq!(steps.len(), 3);
        assert_eq!(sh.pos, 3);
        assert_eq!(sh.tokens, vec![(3, "t3".into()), (4, "t4".into())]);
        assert_eq!(sh.steps.len(), 2);
        assert_eq!(sh.steps[0].top, vec![(3, 0.5)]);
        assert_eq!(sh.prev, "t3t4");
        assert_eq!(sh.n_prompt, 2);
    }

    #[test]
    fn trace_json_carries_the_shadow_tail() {
        let (mut tokens, mut steps) = run(4);
        let sh = Shadow::capture(2, &mut tokens, &mut steps, 2);
        let config = Config {
            n_layers: 1,
            hidden: 8,
            n_heads: 1,
            n_kv_heads: 1,
            head_dim: 8,
            ffn: 8,
            vocab: 16,
            context: 32,
            rms_eps: 1e-6,
            rope_base: 1e6,
        };
        let json = write_trace("m", "q8_0", &config, &tokens, 2, &steps, None, Some(&sh), |id| {
            format!("t{id}")
        });
        // the fork object carries pos, the tail text, and the tail tokens+steps
        assert!(json.contains("\"fork\":{\"pos\":2,\"prev\":\"t2t3\",\"n_prompt\":2,"));
        assert!(json.contains("\"tokens\":[{\"id\":2,\"t\":\"t2\"},{\"id\":3,\"t\":\"t3\"}]"));
        // shadow steps use the same writer as the live steps (same shape)
        assert_eq!(json.matches("\"rnorm\":[1.000]").count(), 4); // 2 live + 2 shadow
        // and the resident arrays only hold the prefix
        assert!(json.contains("\"tokens\":[{\"id\":0,\"t\":\"t0\"},{\"id\":1,\"t\":\"t1\"}]"));
    }
}
