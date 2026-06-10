# suiron

A large-language-model inference engine for Apple Silicon, written from scratch in Rust.
Zero runtime dependencies: no candle, no tokenizers, no ggml bindings. Every layer of the stack, from the GGUF file parser to the Metal kernels, is implemented in this repository.

## Why from scratch?

Inference engines are where systems programming meets modern ML: memory-mapped file
formats, cache-aware matrix multiplication, GPU kernel design, numerical precision
tradeoffs, and scheduling. Using a framework would hide exactly the parts worth learning.

## Roadmap

Each milestone is independently runnable and verified against `llama.cpp` output.

- [x] **M0 — GGUF parser.** Parse the GGUF v3 container (metadata, tensor index, Q8_0
      blocks) with a zero-dependency reader. `suiron inspect <model>` dumps the
      architecture. _(done — see `crates/suiron-gguf`)_
- [ ] **M1 — One correct token.** Byte-level BPE tokenizer from GGUF vocab + fp32 CPU
      forward pass (RMSNorm, RoPE, GQA attention, SwiGLU) for Qwen3-0.6B. Logits match
      llama.cpp.
- [ ] **M2 — CPU generation.** KV cache, sampling (greedy/top-p/temperature), streaming
      output. `suiron run <model> -p "..."`.
- [ ] **MV — Inference microscope.** _(parallel track, unlocked by M2.)_ `suiron trace`
      records every intermediate of a real forward pass — tokenization, attention maps,
      KV cache growth, ranked logits — and a zero-dependency local viewer renders it as
      a minimalist, dot-matrix "glass box" you can step through token by token. No such
      tool exists for real GGUF models; owning the forward pass makes it nearly free.
      Design: [`docs/microscope.md`](docs/microscope.md).
- [ ] **M3 — Metal backend.** Hand-written MSL kernels: matmul, RMSNorm, softmax,
      fused attention. Correctness parity with the CPU path.
- [ ] **M4 — Quantized inference.** Q8_0/Q4 compute without dequantize-to-f32, on CPU
      (NEON) and GPU.
- [ ] **M5 — Paged KV cache + continuous batching.** Serve concurrent generations.
- [ ] **M6 — Speculative decoding.** Draft-model acceleration.
- [ ] **M7 — Server.** OpenAI-compatible HTTP API. Benchmarks vs llama.cpp published here.

## Quick start

```sh
# fetch the reference model (~640 MB)
curl -L -o models/Qwen3-0.6B-Q8_0.gguf \
  "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"

cargo run --release -p suiron-cli -- inspect models/Qwen3-0.6B-Q8_0.gguf
```

## Workspace layout

| Crate         | Purpose                                                          |
| ------------- | ---------------------------------------------------------------- |
| `suiron-gguf` | GGUF v3 container format: metadata, tensor index, dequantization |
| `suiron-cli`  | Command-line interface (`inspect`, later `run` and `serve`)      |

## License

MIT
