//! Direct logit attribution (design-23) against the real model. Skipped (not
//! failed) when the model isn't downloaded, so CI without the 640 MB file
//! stays green. The claims under test are the ones the lab shows:
//!   1. the 16 per-head hidden pushes sum to the layer's recorded attn_out
//!      (exact linearity of the output projection),
//!   2. the per-candidate head contributions sum to the layer's whole
//!      attention contribution to that candidate's logit.

use suiron_cli::machine::{head_attribution, DeepObserver};
use suiron_core::{forward, Backend, KvCache, Model, Tokenizer};
use suiron_gguf::GgufFile;

const MODEL: &str = "../../models/Qwen3-0.6B-Q8_0.gguf";

#[test]
fn head_pushes_reconstruct_the_layer() {
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");
    let ids = tok.encode("The capital of France is");

    // run the context, then inspect the last position at a mid layer
    let mut cache = KvCache::new(&model);
    for &t in &ids[..ids.len() - 1] {
        forward(&model, &mut cache, t, Backend::F32, None);
    }
    let layer = 14;
    let mut deep = DeepObserver::new(layer);
    forward(&model, &mut cache, ids[ids.len() - 1], Backend::F32, Some(&mut deep));

    let n_heads = model.config.n_heads;
    // per-head contributions for every head; the builder's own sum check must
    // hold for each response
    let mut per_head: Vec<Vec<(u32, f32, f32, f32)>> = Vec::new();
    for h in 0..n_heads {
        let a = head_attribution(&deep, &model, h, 4).expect("attribution builds");
        assert!(a.sum_ok, "head {h}: pushes do not reconstruct attn_out");
        per_head.push(a.cands);
    }
    // claim 2: for each candidate, Σ_heads head_contribution ≈ layer_attention
    // contribution (linearity through the frozen final-norm fold)
    for c in 0..per_head[0].len() {
        let (id, _, layer_contrib, logit) = per_head[0][c];
        let sum: f32 = per_head.iter().map(|cands| cands[c].1).sum();
        assert!(
            (sum - layer_contrib).abs() < 5e-2,
            "candidate {id} (logit {logit}): Σ heads {sum} vs layer {layer_contrib}"
        );
    }
}
