# design-23 — what this read bought: direct logit attribution per head

## Goal (Aaron, 2026-07-20 — the sanctioned engine addition)

Answer "how does the model use these values later?" with engine-computed
numbers: for the inspected (pos, layer, head), what this head's attention
read contributed to each final candidate's logit. The worked-dot drawer ends
with "this head's read bought ' Paris' +1.83 of its 17.40 logit."

## Method (and its honesty contract)

contribution(c) = row(c) · ((W_O · pad(ctx_head)) / rms_final ⊙ output_norm)
— the head's hidden-space push through the output projection, folded through
the final norm FROZEN at this pass's real scale (the standard direct-logit-
attribution fold). Two checks keep it honest:

- **linearity**: the 16 heads' pushes must sum to the layer's recorded
  `attn_out` (max component error < 1e-2) — returned as `sum_ok` and shown.
- **a Rust test** (model-gated, self-skipping like real_model.rs) asserting
  both the hidden-space sum and that the per-candidate head contributions sum
  to the layer's whole-attention contribution.

No new kernels: the per-head push reuses the existing quantized matvec on a
zero-padded vector. The observer additionally captures the final residual and
post-norm vector on every inspect (previously final-stage only).

## Files

- suiron-cli machine.rs (DeepObserver fields, `head_attribution`,
  `attribution_json`, `inspect_json` gains the serialized field), lab.rs +
  suiron-wasm lib.rs wiring, new tests/attribution.rs.
- web: DotProduct renders the attribution block when present (absent in old
  recordings — omitted gracefully).

## Commit

"engine+lab: direct logit attribution for one head". Claude commits.
