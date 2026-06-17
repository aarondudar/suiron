# suiron

An LLM inference engine for Apple Silicon, written from scratch in Rust — the
GGUF parser, the byte-level BPE tokenizer, attention, RoPE, the Metal kernels —
with no ML dependencies. Paired with a browser microscope that traces a real
forward pass, token by token.

<!-- DEMO GIF — record from `make lab`: type a prompt, step through a few
     tokens, hover a layer so the attention arcs light up, expand a "math" card.
     Save as docs/demo.gif and uncomment:
![suiron inference microscope](docs/demo.gif)
-->

Everything from the file format up to the GPU is implemented here and verified
token-for-token against `llama.cpp`. `suiron` began as the
on-device engine for [Kana Master](https://github.com/aarondudar/Kana-Master-Mobile),
a mobile app I developed for learning Japanese.

## Quick start

```sh
make setup   # fetch model (~640 MB) + build engine + frontend
make lab     # open the microscope in your browser
```

`make help` lists every target; `make dev` runs the frontend with hot reload.
Or from the terminal:

```sh
cargo run --release -p suiron-cli -- run models/Qwen3-0.6B-Q8_0.gguf -p "The capital of France is"
```

## The microscope

`suiron lab` keeps the model resident and serves a single-page instrument over a
JSON API. You step through generation one token at a time and read, in real
numbers, how each one was produced: attention per layer (with arcs back over the
prompt), the residual stream, the ranked next-token logits, and the sampling
decision that picked the winner. Click a candidate to force it instead and watch
the model continue from the altered history. An "explain" toggle narrates each
panel; a "machine" view shows the engine's own source beside the math for every
stage. Built on `web/` (React + TypeScript) — see [`docs/microscope.md`](docs/microscope.md).

## Roadmap

Each milestone is independently runnable; quoted results are measured against
llama.cpp on an M1 Pro.

- [x] **M0 — GGUF parser.** Zero-dependency v3 reader (metadata, tensor index,
      Q8_0 blocks). `suiron inspect`.
- [x] **M1 — One correct token.** Byte-level BPE tokenizer + fp32 CPU forward
      pass. Tokenizer is token-exact vs `llama-tokenize` (13/13 inputs incl.
      Japanese, emoji, code); logits match llama.cpp.
- [x] **M2 — CPU generation.** KV cache, sampling, UTF-8-safe streaming, chat
      template. Greedy output matches `llama-completion` 5/5 prompts × 32 tokens.
- [x] **MV — Inference microscope.** `suiron lab` + the `web/` frontend above.
- [x] **M3 — Metal backend.** Hand-rolled Objective-C FFI (no crates),
      runtime-compiled MSL kernels, full GPU forward parity with the CPU path,
      ~4× decode speedup.
- [ ] **M4 — Quantized inference.** Q8_0/Q4 compute without dequantizing to f32,
      on CPU (NEON) and GPU.
- [ ] **M5 — Paged KV cache + continuous batching.**
- [ ] **M6 — Speculative decoding.**
- [ ] **M7 — OpenAI-compatible HTTP server.**

## Workspace

| Crate          | Purpose                                                          |
| -------------- | ---------------------------------------------------------------- |
| `suiron-gguf`  | GGUF v3 container format: metadata, tensor index, dequantization |
| `suiron-core`  | Tokenizer, fp32 forward pass, sampling, generation               |
| `suiron-metal` | Metal GPU backend (hand-rolled Objective-C FFI, runtime MSL)     |
| `suiron-cli`   | The `suiron` binary: `inspect`, `run`, `trace`, `lab`, …         |
| `web/`         | Microscope frontend (React + TypeScript)                         |

The zero-dependency rule applies to the Rust crates — the engine. The `web/`
frontend is an ordinary Vite app talking to the lab's JSON API.

## Why from scratch

Inference engines are where systems programming meets modern ML: binary file
formats, cache-aware matrix multiplication, GPU kernel design, numerical
precision tradeoffs, scheduling. A framework would hide exactly the parts worth
learning.

## License

MIT
