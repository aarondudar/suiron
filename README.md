# suiron

**Watch a real language model predict the next token, one step at a time** — every
number on screen is computed live by a from-scratch engine and verified
token-for-token against `llama.cpp`.

suiron is an LLM inference engine for Apple Silicon, written from scratch in Rust —
a GGUF parser, a byte-level BPE tokenizer, attention, RoPE, SwiGLU, and hand-rolled
Metal kernels, with **no ML dependencies** — paired with a browser "microscope" that
traces an actual forward pass.

- **Curious how text prediction actually works?** Take the guided tour: the
  prompt splitting into tokens merge by merge, attention reaching back over the
  words, one real attention score built out of two 128-number vectors, and the
  logit lens showing the winning token climb the layers.
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
JSON API. Type a prompt (or take the guided tour) and step through generation one
token at a time; inspecting a token is a full read of how it was **produced** —
the forward pass at the token before it, the prediction that formed, and the draw
that picked it.

The headline is the **logit lens**: drag a slider down the 28 layers and watch the
winning token climb the rankings, the prediction resolving out of the residual
stream layer by layer; the instrument marks the exact layer where it takes the
lead. And every other stage runs on real numbers too, demonstrated rather than
described:

- the prompt collapsing through its **actual BPE merges**, rank by rank, into
  the token ids the model reads
- the token's **embedding row** — one real row of the 151,936 × 1,024 table
- **RoPE** rotating the query's pairs by the token's position (direction
  changes, length never)
- **RMSNorm** rescaling the vector, shown number by number
- one attention score built from two 128-number vectors, then **softmax →
  weights → the blend** of value vectors into the head's output — attention,
  end to end
- the **KV cache** filling, one column per cached token, brightness showing how
  hard this pass read from each
- the **unembed**: the final vector dotted against a candidate's own table row,
  landing exactly on its logit
- temperature / top-k / top-p **re-run live on this token's real options**, with
  the actually-picked token marked — drag the cut below it and the demo tells you

Every stepped demo is pinned to the engine by an integration test against the
real weights (the worked score equals the recorded score, the blend equals the
head's context, the final-layer lens equals the logits, replayed merges equal
`encode`, q8 agrees with f32). Click any candidate to **fork** history and watch
the model continue from your edit, or flip the prompt box to **chat** and talk to
the same resident model. Every concept opens an inline explainer card inside the
band it explains, weaving the engine's own Rust source with this token's live
values — and past the last band, an **epilogue** draws one honest boundary:
everything above it was computed and verified here; below it, how production
systems scale the same loop, ending with why a coding agent is this exact loop
plus a wrapper. Built on `web/` (React + TypeScript) — see
[`docs/microscope.md`](docs/microscope.md).

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
- [x] **M4 — Quantized inference (CPU).** Q8_0 blocks multiplied directly, no f32
      materialization — ~4× less weight-memory traffic, measured live in the lab's
      f32/q8 toggle; argmax-identical to the f32 path. Q4_K_M loads via Q4_K/Q6_K
      dequant. (GPU-quantized kernels: stretch.)
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
