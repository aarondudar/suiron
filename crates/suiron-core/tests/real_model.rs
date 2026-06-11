//! Integration tests against the real GGUF file. Skipped (not failed) when
//! the model isn't downloaded, so CI without the 640 MB file stays green.

use suiron_core::Tokenizer;
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
