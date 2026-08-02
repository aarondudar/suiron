# design-06 — re-home RMSNorm + the residual onto "sharpens"

## Goal

Give step 3 (**sharpens**) its two drawers from the design.md map: `RmsNormDemo`
(the renormalization before every block, on this pass's real numbers) and
`RnormSparkline` (the residual stream's RMS after every layer — the same
signal the inline climb reads). The lens climb stays inline and untouched;
these deepen it. Uses the multi-dive row from design-05.

## The critical rule

Zero-line diffs on both modules. Registry feeds copied exactly:
`<RmsNormDemo ctx={c} />` and
`<RnormSparkline step={c.step} layer={c.layer} layers={c.trace.layers} />`.

## In scope

- `DIVES[3] = [rmsnorm, residual]` with plain-language labels
  ("the reset before every layer", "the signal, layer by layer").
- Each behind one framing line tying it to the climb.

## Out of scope

- No module/CSS edits; no LayerStack work; the lens climb unchanged.

## Done when

- Both drawers open live on step 3 (the norm demo shows this pass's real
  slice; the sparkline plots the recorded per-layer RMS), close back to the
  step, one at a time. Zero-line module diffs. Gate green + screenshots.

## Pitched alongside

None — same-shape pass, the affordance row already exists.

## Commit

"lab: rmsnorm + residual drawers live on sharpens". Claude commits.
