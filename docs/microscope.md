# MV — Inference microscope

Watch a real GGUF model think. The engine records every intermediate value of an
actual forward pass; a local viewer renders it as an explorable, steppable trace.
Not a generic transformer explainer (bbycroft.net/llm already does that beautifully
for toy weights) — this shows *your* model on *your* prompt with *real* numbers,
which nothing else does for GGUF/local models.

## Why suiron can build this and others can't (easily)

llama.cpp fuses intermediates away inside optimized kernels; instrumenting it is
surgery. suiron owns every layer of the stack, so emitting "attention matrix,
layer 7, head 3" is a hook designed in from M1, not bolted on. The from-scratch
constraint is the moat.

## Architecture

```
suiron trace <model> -p "prompt"   →   trace file (versioned, std-only writer)
suiron view <trace>                →   serves viewer on localhost (std TcpListener)
```

- The tracer is a recording hook inside the M1/M2 forward pass. Off by default,
  zero cost when disabled.
- Full traces are large (28 layers × 16 heads × seq² attention …); record
  small-rank summaries by default (top-k attention edges, activation histograms,
  norms) with `--full` for everything.
- Viewer is a single static HTML file + vanilla JS + canvas. No build step, no
  npm — the zero-dependency identity extends to the frontend.

## Visual language

Inspired by nothing.tech / Aaron's portfolio: industrial-minimal, schematic,
monochrome with one accent. The data is the decoration — no chrome.

- **Palette:** near-black `#0a0a0a` background, off-white `#e8e8e8` ink,
  single red accent `#d71921` reserved exclusively for "what the model chose /
  attended to most." Mid-grey hairlines `#2a2a2a` for structure. Nothing else.
- **Type:** dot-matrix display face for numerals and labels (NDot-style),
  plain monospace for token text. All-lowercase labels, generous letter-spacing.
- **Texture:** data rendered as *dot grids*, not gradient heatmaps. Magnitude =
  dot size/density. Reads like a Nothing glyph interface; stays legible in pure
  monochrome.
- **Motion:** stepping is the only animation that matters. Each token advance is
  a crisp ≤200 ms cascade down the layer stack — satisfying, never decorative.
  No easing flourishes, no parallax.
- **Layout:** thin hairline borders, large whitespace, schematic feel — closer
  to a measurement instrument than a dashboard.

## The view, top to bottom

One screen, four bands. Scrubbing the token strip re-renders everything below.

```
┌──────────────────────────────────────────────────────────────────┐
│ qwen3-0.6b · q8_0 · 28 layers · 16h/8kv          token 4 / 12 ●  │  header
├──────────────────────────────────────────────────────────────────┤
│ [the][ cat][ sat][ on][▮ the]  ░mat ░rug ░floor                  │  token strip
├──────────────────────────────────────────────────────────────────┤
│ 27 ┊ ·  ·  ▪  ·  ●  ·  ·  ·   ┆  attn L27                       │
│ 26 ┊ ·  ▪  ·  ·  ●  ·  ·  ·   ┆  ┌─────────────┐               │  layer stack
│ …  ┊                           ┆  │ · · ▪ · ●   │  head 3        │  + detail
│  1 ┊ ▪  ·  ·  ·  ●  ·  ·  ·   ┆  │ · ▪ · · ●   │  dot grid      │  panel
│  0 ┊ ·  ·  ·  ▪  ●  ·  ·  ·   ┆  └─────────────┘               │
├──────────────────────────────────────────────────────────────────┤
│ mat ████████████████ 0.62   rug ████ 0.14   floor ██ 0.07        │  logits
└──────────────────────────────────────────────────────────────────┘
```

1. **Header** — model identity as a spec line (name · quant · geometry), current
   position. The lone red dot ● is the "recording/live" indicator.
2. **Token strip** — the prompt as bordered monospace cells; generated tokens
   append live. Current token red. This is the scrubber: click or arrow-key
   through positions, everything below follows.
3. **Layer stack** — all 28 layers as thin rows. Per row, a compressed dot-strip
   of where this layer's attention mass went (which earlier tokens). Red dot =
   strongest edge. Click a row → detail panel expands: 16 per-head dot-grid
   attention maps, RMSNorm/residual magnitude sparklines, the Qwen3 per-head q/k
   norms. GQA is *visible*: the 8 KV groups render as paired head columns.
4. **Logits band** — top-k next-token candidates as hairline bars with
   probabilities, winner in red. With temperature/top-p shown as small dials,
   you can see sampling truncate the tail.

Secondary view (one keystroke away): **weights mode** — per-tensor histograms of
the dequantized distributions, Q8_0 scale-vs-quant structure, so quantization
stops being abstract.

## What "done" looks like

A learner with zero ML background loads Qwen3, types "the cat sat on the", and
in five minutes can point at: the BPE merge that made " the" one token, the layer
where attention locks onto "cat", and the logit bar that made "mat" win. That
GIF is the project's front door.
