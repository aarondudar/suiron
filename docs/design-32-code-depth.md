# design-32 — code snippets with depth (Aaron's #7 / #11)

The woven code views ("under the hood", the ffn "read, then think" drawer, the
expert view's engine source) show the real Rust, but flat: monochrome text, no
guidance about what to notice. Aaron: *"Code snippets lack depth, theming and
analysis"* and *"Read, then think could benefit from the code snippet upgrades."*

## Plan

One shared `CodeView` component replaces the raw `<pre>` rendering everywhere a
snippet appears. Three layers, all zero-dep (a ~40-line regex tokenizer — the
snippets are small, curated Rust):

1. **Syntax tinting, console palette.** Keywords/types dim-steel, comments
   faint, numbers/literals ink, function names slightly lit. NO new hues — stays
   inside the monochrome+red system; red remains reserved for the live values
   already woven in (`uh-var` hot state).
2. **Line-level analysis.** Each snippet ships a per-line note map (hover/tap a
   line → it lights + a one-line "what this does" appears in a fixed readout
   under the code, same place every time). Notes tie to the live values UnderHood
   already interpolates ("this line computed the 0.42 above").
3. **"Why this code" caption.** One short paragraph per snippet (attention, dot,
   rope, rmsnorm, ffn/silu, softmax, matmul, forward): the shape of the loop,
   where the hot path is, what's deliberately naive vs what's load-bearing.

The ffn drawer ("read, then think") gets all three via the shared component —
it is UnderHood at stage=feedforward.

## Honesty

The code shown is still fetched from `/api/v1/source` (the engine's own files) —
the notes/captions are the only authored layer, and they describe, never
paraphrase, the fetched code. If a snippet drifts from its note map (source
changes), unmatched lines simply carry no note — never a wrong one.

## Pitched alongside (approve/strike)

- **a.** line numbers + copy-to-clipboard on every snippet
- **b.** "view on GitHub" deep link per snippet (file+line of the real source)
- **c.** long snippets collapsed to the hot loop with an "expand" affordance

## Method

CodeView first behind one drawer (attention) → confirm the feel → roll to the
rest + expert view. Per-stage commits; gate stays green.
