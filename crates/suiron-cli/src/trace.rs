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
    fork: Option<&(usize, String)>,
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
    if let Some((pos, prev)) = fork {
        j.push_str(&format!("\"fork\":{{\"pos\":{pos},\"prev\":\"{}\"}},", escape_json(prev)));
    }

    j.push_str("\"tokens\":[");
    for (i, (id, text)) in tokens.iter().enumerate() {
        if i > 0 {
            j.push(',');
        }
        j.push_str(&format!("{{\"id\":{id},\"t\":\"{}\"}}", escape_json(text)));
    }
    j.push_str("],\"steps\":[");

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
    j.push_str("]}");
    j
}
