# suiron — LLM inference engine in Rust + Metal

From-scratch inference engine for Apple Silicon (dev machine: M1 Pro, 16 GB).
Reference model: Qwen3-0.6B Q8_0 GGUF at `models/Qwen3-0.6B-Q8_0.gguf` (gitignored;
download command in README). Long-term goal: power on-device AI features in the
Kana-Master-Mobile iOS app.

## Hard rules

- **Zero runtime dependencies — in the Rust crates.** No candle, tokenizers, ggml,
  serde, anyhow, clap. std only. Dev-dependencies for testing are acceptable if truly
  needed. This is the project's identity — being from scratch is the point.
  Exception: `web/` (the microscope frontend) is a normal React + TypeScript Vite app;
  it talks to the engine only through `suiron lab`'s JSON API (`/api/v1/…`). The
  embedded-HTML viewer is gone; `suiron lab`/`view` serve `web/dist` if built.
- **Correctness before speed.** Every new compute path is verified against llama.cpp
  output (and against the existing CPU path once one exists) before optimizing.
- **Each milestone stays demo-able.** Don't break `suiron inspect`/`run` mid-refactor;
  the README roadmap (M0–M7 plus MV, the inference microscope) is the source of truth
  for sequencing. MV's design lives in `docs/microscope.md` — visual decisions there
  (monochrome + single red accent, dot-matrix, nothing.tech-inspired) are deliberate.

## Commands

```sh
cargo build --workspace
cargo test --workspace
cargo run --release -p suiron-cli -- inspect models/Qwen3-0.6B-Q8_0.gguf
cargo clippy --workspace -- -D warnings
```

## Architecture notes

- `suiron-gguf`: GGUF v3 parser. Whole-file `Vec<u8>` read for now; swap to mmap when
  model sizes demand it. `GgufFile::tensor_data()` returns raw bytes; dequantization
  (`f16_to_f32`, `dequantize_q8_0`) lives in `dequant.rs`.
- Qwen3-0.6B architecture facts (from GGUF metadata): 28 layers, GQA (16 Q heads /
  8 KV heads), head_dim 128, hidden 1024, FFN 3072, SwiGLU, RMSNorm (+ per-head
  q/k norm — Qwen3-specific), RoPE theta 1e6, vocab 151 936, tied embeddings.
- Q8_0 block = 34 bytes: f16 scale `d` followed by 32 × i8 quants; value = d * q.
