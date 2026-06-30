# suiron

**Watch a real language model predict the next token, one step at a time** — every
number on screen is computed live by a from-scratch engine and verified
token-for-token against `llama.cpp`.

![the suiron microscope: the logit lens, a prediction forming layer by layer](docs/demo.gif)

suiron is an LLM inference engine for Apple Silicon, written from scratch in Rust —
a GGUF parser, a byte-level BPE tokenizer, attention, RoPE, SwiGLU, and hand-rolled
Metal kernels, with **no ML dependencies** — paired with a browser "microscope" that
traces an actual forward pass.

- **Curious how text prediction actually works?** Open the microscope, type a
  prompt, and watch it happen: attention reaching back over the words, the logit
  lens showing the winning token climb the layers, one real attention score
  stepped out component by component.
- **Building inference, or want to read one end to end?** It is a complete,
  dependency-free implementation from the binary file format up to the GPU,
  checked against llama.cpp at every layer — not just the final output.

It began as the on-device engine for [Kana Master](https://github.com/aarondudar/Kana-Master-Mobile),
a mobile app I built for learning Japanese.

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
JSON API. Type a prompt and step through generation one token at a time, reading —
in real numbers — how each one was produced.

The headline is the **logit lens**: drag a slider down the 28 layers and watch the
winning token climb the rankings, the prediction resolving out of the residual
stream layer by layer; the instrument marks the exact layer where it takes the
lead. Around it: a **worked dot product** that steps one real attention score out
of two 128-number vectors; per-layer attention with arcs back over the prompt; the
residual stream; and the ranked next-token logits with the sampling decision that
picked the winner. Click a candidate to force it and watch the model continue from
the altered history. Every concept has an on-demand explainer that, for the compute
stages, weaves the engine's own Rust source together with this token's real values.
Built on `web/` (React + TypeScript) — see [`docs/microscope.md`](docs/microscope.md).

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
