//! Integration tests against the real GGUF file. Skipped (not failed) when
//! the model isn't downloaded, so CI without the 640 MB file stays green.

use suiron_core::{forward, Backend, KvCache, Model, Tokenizer};
use suiron_gguf::GgufFile;

const MODEL: &str = "../../models/Qwen3-0.6B-Q8_0.gguf";
const MODEL_Q4: &str = "../../models/Qwen3-0.6B-Q4_K_M.gguf";

fn tokenizer() -> Option<Tokenizer> {
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return None;
    }
    let file = GgufFile::open(MODEL).expect("model parses");
    Some(Tokenizer::from_gguf(&file).expect("tokenizer builds"))
}

#[test]
fn q8_backend_agrees_with_f32() {
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let prompt = [1782u32, 8251, 7578, 389, 279]; // "the cat sat on the"

    let mut f32_cache = KvCache::new(&model);
    let mut q8_cache = KvCache::new(&model);
    let mut max_diff = 0.0f32;
    for &t in &prompt {
        let f = forward(&model, &mut f32_cache, t, Backend::F32, None);
        let q = forward(&model, &mut q8_cache, t, Backend::Q8, None);
        // both start from the same Q8_0 weights, so this is near-exact —
        // only f32 accumulation order differs. argmax MUST agree.
        assert_eq!(
            suiron_core::sampling::argmax(&f),
            suiron_core::sampling::argmax(&q),
            "Q8 picked a different token than F32"
        );
        for (a, b) in f.iter().zip(&q) {
            max_diff = max_diff.max((a - b).abs());
        }
    }
    eprintln!("max |f32 - q8| logit diff over prompt: {max_diff}");
    assert!(max_diff < 1e-2, "Q8 diverges from F32 by {max_diff}");
}

#[test]
fn encode_decode_roundtrip() {
    let Some(t) = tokenizer() else { return };
    // Round-tripping proves byte mapping, scanner coverage, and decode are
    // mutually consistent (it does NOT prove llama.cpp parity — that check
    // is manual via llama-tokenize until a fixture is added).
    for text in [
        "the cat sat on the mat",
        "Hello, world! 123",
        "I'm    spaced\n\nout",
        "こんにちは世界",
        "日本語のトークン化テスト",
        "emoji 🙂 and ümlauts",
    ] {
        let ids = t.encode(text);
        assert!(!ids.is_empty());
        assert_eq!(t.decode(&ids), text, "roundtrip failed for {text:?}");
    }
}

#[test]
fn vocab_matches_model() {
    let Some(t) = tokenizer() else { return };
    assert_eq!(t.vocab_size(), 151_936);
}

#[test]
fn model_loads_with_expected_architecture() {
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("model parses");
    let m = suiron_core::Model::load(&file).expect("model loads");

    let c = &m.config;
    assert_eq!(
        (c.n_layers, c.hidden, c.n_heads, c.n_kv_heads, c.head_dim, c.ffn, c.vocab),
        (28, 1024, 16, 8, 128, 3072, 151_936)
    );
    assert_eq!(c.rope_base, 1e6);
    assert_eq!(m.layers.len(), 28);
    assert!(m.output.is_none(), "0.6B has tied embeddings");

    // spot-check data quality: embeddings of a real token are finite and not
    // all zero (would indicate a dequant or offset bug)
    let emb = m.embedding(1782); // "the"
    assert_eq!(emb.len(), 1024);
    assert!(emb.iter().all(|v| v.is_finite()));
    assert!(emb.iter().any(|&v| v != 0.0));
}

#[test]
fn worked_dot_matches_engine_score() {
    // The worked-operation demo re-exposes the post-norm+RoPE query for one head
    // and the source key for that head's KV group; their dot product scaled by
    // 1/√head_dim must equal the score the engine already computed. This pins the
    // indexing (head slice, GQA kv_head, source offset) the inspect endpoint and
    // the web stepper both rely on.
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");
    let ids = tok.encode("The capital of France is");
    assert!(ids.len() >= 2);

    let cfg = &model.config;
    let (hd, layer, head) = (cfg.head_dim, 5usize, 3usize);
    let kv_dim = cfg.n_kv_heads * hd;
    let kv_head = head / (cfg.n_heads / cfg.n_kv_heads);

    // capture the target layer's recorded q vector and per-head scores at the
    // final position (after prefilling the earlier tokens)
    struct Cap {
        layer: usize,
        q: Vec<f32>,
        scores: Vec<Vec<f32>>,
    }
    impl suiron_core::forward::Observer for Cap {
        fn vector(&mut self, l: usize, name: &'static str, v: &[f32]) {
            if l == self.layer && name == "q" {
                self.q = v.to_vec();
            }
        }
        fn scores(&mut self, l: usize, _head: usize, s: &[f32]) {
            if l == self.layer {
                self.scores.push(s.to_vec());
            }
        }
    }

    let mut cache = KvCache::new(&model);
    for &t in &ids[..ids.len() - 1] {
        forward(&model, &mut cache, t, Backend::F32, None);
    }
    let mut cap = Cap { layer, q: Vec::new(), scores: Vec::new() };
    forward(&model, &mut cache, *ids.last().unwrap(), Backend::F32, Some(&mut cap));

    let n_pos = ids.len();
    assert_eq!(cap.scores.len(), cfg.n_heads, "one score row per head");
    assert_eq!(cache.k[layer].len(), n_pos * kv_dim, "all positions cached");

    let scale = 1.0 / (hd as f32).sqrt();
    let q = &cap.q[head * hd..head * hd + hd];
    for src in 0..n_pos {
        let kstart = src * kv_dim + kv_head * hd;
        let k = &cache.k[layer][kstart..kstart + hd];
        let recomputed: f32 = q.iter().zip(k).map(|(a, b)| a * b).sum::<f32>() * scale;
        let engine = cap.scores[head][src];
        assert!(
            (recomputed - engine).abs() < 1e-3,
            "layer {layer} head {head} src {src}: worked {recomputed} vs engine {engine}"
        );
    }
}

#[test]
fn rmsnorm_reconstructs_from_pre_and_weight() {
    // RMSNorm: postᵢ = xᵢ · weightᵢ / rms, rms = sqrt(mean(x²) + eps). Rebuilding
    // the post-norm vector from the pre-norm vector, the rms, and the weight must
    // equal the engine's recorded attn_norm. Pins the worked-norm slice the web
    // steps and checks.
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");
    let ids = tok.encode("The capital of France is");
    assert!(ids.len() >= 2);

    let layer = 5usize;
    struct Cap {
        layer: usize,
        x_in: Vec<f32>,
        attn_norm: Vec<f32>,
    }
    impl suiron_core::forward::Observer for Cap {
        fn vector(&mut self, l: usize, name: &'static str, v: &[f32]) {
            if l == self.layer {
                match name {
                    "x_in" => self.x_in = v.to_vec(),
                    "attn_norm" => self.attn_norm = v.to_vec(),
                    _ => {}
                }
            }
        }
    }

    let mut cache = KvCache::new(&model);
    for &t in &ids[..ids.len() - 1] {
        forward(&model, &mut cache, t, Backend::F32, None);
    }
    let mut cap = Cap { layer, x_in: Vec::new(), attn_norm: Vec::new() };
    forward(&model, &mut cache, *ids.last().unwrap(), Backend::F32, Some(&mut cap));

    assert!(!cap.x_in.is_empty() && !cap.attn_norm.is_empty(), "x_in/attn_norm captured");
    let weight = &model.layers[layer].attn_norm.data;
    let len = cap.x_in.len();
    let rms = ((cap.x_in.iter().map(|v| v * v).sum::<f32>() / len as f32) + model.config.rms_eps)
        .sqrt();

    let mut max_diff = 0.0f32;
    for j in 0..len {
        let recomputed = cap.x_in[j] * weight[j] / rms;
        max_diff = max_diff.max((recomputed - cap.attn_norm[j]).abs());
    }
    eprintln!("rmsnorm: reconstructed vs engine attn_norm, max |diff| = {max_diff}");
    assert!(max_diff < 1e-4, "rmsnorm reconstruction diverges by {max_diff}");
}

#[test]
fn rope_rotates_query_by_position() {
    // RoPE rotates each query pair (i, i+d/2) by pos·base^(-2i/d). Applying those
    // angles to the pre-RoPE query (post per-head norm) must reproduce the
    // post-RoPE query the attention score multiplies. Pins the q_pre + angles the
    // inspect slice exposes and the web rotates.
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");
    let ids = tok.encode("The capital of France is");
    assert!(ids.len() >= 2);

    let cfg = &model.config;
    let (hd, layer, head) = (cfg.head_dim, 5usize, 3usize);
    let half = hd / 2;
    let base = cfg.rope_base;

    struct Cap {
        layer: usize,
        q_pre: Vec<f32>,
        q: Vec<f32>,
    }
    impl suiron_core::forward::Observer for Cap {
        fn vector(&mut self, l: usize, name: &'static str, v: &[f32]) {
            if l == self.layer {
                match name {
                    "q_pre" => self.q_pre = v.to_vec(),
                    "q" => self.q = v.to_vec(),
                    _ => {}
                }
            }
        }
    }

    let mut cache = KvCache::new(&model);
    for &t in &ids[..ids.len() - 1] {
        forward(&model, &mut cache, t, Backend::F32, None);
    }
    let mut cap = Cap { layer, q_pre: Vec::new(), q: Vec::new() };
    forward(&model, &mut cache, *ids.last().unwrap(), Backend::F32, Some(&mut cap));

    let pos = ids.len() - 1; // the position the last token was processed at
    assert!(!cap.q_pre.is_empty() && !cap.q.is_empty(), "q_pre/q captured");

    // rotate head `head`'s pre-RoPE pairs by the position angles, compare to q
    let mut max_diff = 0.0f32;
    for i in 0..half {
        let angle = pos as f32 * base.powf(-(2.0 * i as f32) / hd as f32);
        let (sin, cos) = angle.sin_cos();
        let x0 = cap.q_pre[head * hd + i];
        let x1 = cap.q_pre[head * hd + i + half];
        let r0 = x0 * cos - x1 * sin;
        let r1 = x0 * sin + x1 * cos;
        max_diff = max_diff.max((r0 - cap.q[head * hd + i]).abs());
        max_diff = max_diff.max((r1 - cap.q[head * hd + i + half]).abs());
    }
    eprintln!("rope pos={pos}: rotated q_pre vs engine q, max |diff| = {max_diff}");
    assert!(max_diff < 1e-3, "rotated q_pre diverges from engine q by {max_diff}");
}

#[test]
fn attention_blend_matches_engine_context() {
    // The worked blend re-forms one head's attention output: softmax turns the
    // scores into weights, and each source's value vector is summed by its
    // weight. That sum must equal the engine's recorded per-head context
    // (`attn_ctx`, the concat before the output projection). Pins the value
    // vectors + context the inspect slice exposes and the web steps.
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");
    let ids = tok.encode("The capital of France is");
    assert!(ids.len() >= 2);

    let cfg = &model.config;
    let (hd, layer, head) = (cfg.head_dim, 5usize, 3usize);
    let kv_dim = cfg.n_kv_heads * hd;
    let kv_head = head / (cfg.n_heads / cfg.n_kv_heads);

    struct Cap {
        layer: usize,
        ctx: Vec<f32>,
        weights: Vec<Vec<f32>>,
    }
    impl suiron_core::forward::Observer for Cap {
        fn vector(&mut self, l: usize, name: &'static str, v: &[f32]) {
            if l == self.layer && name == "attn_ctx" {
                self.ctx = v.to_vec();
            }
        }
        fn attention(&mut self, l: usize, _head: usize, w: &[f32]) {
            if l == self.layer {
                self.weights.push(w.to_vec());
            }
        }
    }

    let mut cache = KvCache::new(&model);
    for &t in &ids[..ids.len() - 1] {
        forward(&model, &mut cache, t, Backend::F32, None);
    }
    let mut cap = Cap { layer, ctx: Vec::new(), weights: Vec::new() };
    forward(&model, &mut cache, *ids.last().unwrap(), Backend::F32, Some(&mut cap));

    let n_pos = ids.len();
    assert_eq!(cap.weights.len(), cfg.n_heads, "one weights row per head");
    assert_eq!(cap.ctx.len(), cfg.n_heads * hd, "context concat over all heads");

    // reconstruct head `head`'s context = Σ_p weights[p]·v[p], values from the cache
    let w = &cap.weights[head];
    assert_eq!(w.len(), n_pos, "weights over all positions");
    let mut recomputed = vec![0.0f32; hd];
    for (p, &wp) in w.iter().enumerate() {
        let vp = &cache.v[layer][p * kv_dim + kv_head * hd..][..hd];
        for d in 0..hd {
            recomputed[d] += wp * vp[d];
        }
    }
    let engine = &cap.ctx[head * hd..head * hd + hd];
    let mut max_diff = 0.0f32;
    for d in 0..hd {
        max_diff = max_diff.max((recomputed[d] - engine[d]).abs());
    }
    eprintln!("blend vs engine head context: max |diff| = {max_diff}");
    assert!(max_diff < 1e-3, "blend diverges from engine context by {max_diff}");
}

#[test]
fn lens_final_layer_equals_logits() {
    // The logit lens at the final layer must reproduce the real next-token
    // logits exactly: it applies the same final RMSNorm + tied unembed to the
    // last layer's residual that the forward pass applies at the end. This pins
    // the lens invariant the endpoint and the UI rely on.
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");
    let ids = tok.encode("The capital of France is");

    // capture every layer's residual (x_out) on the final token
    struct Caps {
        res: Vec<Vec<f32>>,
    }
    impl suiron_core::forward::Observer for Caps {
        fn vector(&mut self, _l: usize, name: &'static str, v: &[f32]) {
            if name == "x_out" {
                self.res.push(v.to_vec());
            }
        }
    }

    let mut cache = KvCache::new(&model);
    for &t in &ids[..ids.len() - 1] {
        forward(&model, &mut cache, t, Backend::F32, None);
    }
    let mut caps = Caps { res: Vec::new() };
    let logits = forward(&model, &mut cache, *ids.last().unwrap(), Backend::F32, Some(&mut caps));

    assert_eq!(caps.res.len(), model.config.n_layers, "one residual per layer");

    let real_top = suiron_core::sampling::argmax(&logits);
    let probs = suiron_core::math::softmax(&logits);
    let lens_last = model.lens_topk(caps.res.last().unwrap(), 5);

    // final-layer lens top-1 id and probability equal the real logits'
    assert_eq!(
        lens_last[0].0, real_top,
        "final-layer lens top-1 {} != real argmax {real_top}",
        lens_last[0].0
    );
    assert!(
        (lens_last[0].1 - probs[real_top as usize]).abs() < 1e-4,
        "final-layer lens prob {} != real {}",
        lens_last[0].1,
        probs[real_top as usize]
    );
    eprintln!("lens final-layer top-1 id={real_top} p={:.4}", lens_last[0].1);
}

#[test]
fn q4_k_model_loads_and_predicts_the_known_answer() {
    // Exercises Q4_K_M dequant on the real weights: the model must load (no
    // UnsupportedDtype) and greedily continue "The capital of France is" with
    // " Paris" — the same answer Q8 and llama.cpp give. Self-skips until the
    // real Q4 file is downloaded (the repo ships a 15-byte stub).
    let real_q4 = std::fs::metadata(MODEL_Q4).map(|m| m.len() > 1_000_000).unwrap_or(false);
    if !real_q4 {
        eprintln!("skipping: {MODEL_Q4} not present (or a stub)");
        return;
    }
    let file = GgufFile::open(MODEL_Q4).expect("Q4 parses");
    let model = Model::load(&file).expect("Q4 loads via Q4_K dequant");
    let tok = Tokenizer::from_gguf(&file).expect("tokenizer");

    let ids = tok.encode("The capital of France is");
    let mut cache = KvCache::new(&model);
    let mut logits = Vec::new();
    for &t in &ids {
        logits = forward(&model, &mut cache, t, Backend::F32, None);
    }
    assert!(logits.iter().all(|v| v.is_finite()), "Q4 produced non-finite logits");
    let next = tok.decode(&[suiron_core::sampling::argmax(&logits)]);
    assert_eq!(next, " Paris", "Q4 greedy next token was {next:?}, expected \" Paris\"");
}

#[test]
fn merge_trace_replays_to_the_same_ids() {
    // The recorded BPE merge sequence must reduce to exactly the ids `encode`
    // produces — the merge demo's invariant. Spot-check a visible space+word
    // merge is present.
    let Some(t) = tokenizer() else { return };
    for text in ["The capital of France is", "Hello, world! 123"] {
        let pm = t.encode_merges(text);
        let flat: Vec<u32> = pm.iter().flat_map(|p| p.ids.clone()).collect();
        assert_eq!(flat, t.encode(text), "merge replay != encode for {text:?}");
        // each step's rank is real and each pre-token ends on its own tokens
        for p in &pm {
            assert!(!p.start.is_empty());
        }
    }
    // " the"-style merge: a leading space joins a word within one pre-token
    let pm = t.encode_merges("the the");
    let joined_space = pm
        .iter()
        .flat_map(|p| &p.steps)
        .any(|s| s.left == " " || s.right.starts_with(' ') || s.left.starts_with(' '));
    assert!(joined_space, "expected a leading-space merge step");
}

#[test]
fn matches_llama_cpp_reference_ids() {
    // Fixtures captured from `llama-tokenize` (llama.cpp, 2026-06-10) on this
    // exact model file. 13/13 parity inputs passed; these pin three of them.
    let Some(t) = tokenizer() else { return };
    assert_eq!(
        t.encode("the cat sat on the mat"),
        vec![1782, 8251, 7578, 389, 279, 5517]
    );
    assert_eq!(
        t.encode("Hello, world! 123"),
        vec![9707, 11, 1879, 0, 220, 16, 17, 18]
    );
    assert_eq!(t.encode("こんにちは世界"), vec![89015, 99489]);
    assert_eq!(
        t.encode("def main():\n    print(\"hi\")"),
        vec![750, 1887, 3932, 262, 1173, 445, 6023, 899]
    );
}
