//! Integration tests against the real GGUF file. Skipped (not failed) when
//! the model isn't downloaded, so CI without the 640 MB file stays green.

use suiron_core::{forward, Backend, KvCache, Model, Tokenizer};
use suiron_gguf::GgufFile;

const MODEL: &str = "../../models/Qwen3-0.6B-Q8_0.gguf";

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
