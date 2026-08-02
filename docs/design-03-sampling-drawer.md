# design-03 — re-home the sampling knobs onto "draws one"

## Goal

Turn the "bend the odds: temperature, top-k, top-p" stub on step 4 (**draws
one**) live: the three existing knob demos, running on the real recorded draw
that picked the current token. Same recipe design-02 proved: modules move in
unchanged, wiring only.

**Read first:** `docs/design.md`; `docs/design-02-merges-drawer.md` for the
re-homing recipe.

## The critical rule (do not violate)

`TemperatureDemo` / `TopKDemo` / `TopPDemo` are pure client-side recomputes
over the trace's real candidates (`sel.cand`) — no engine call, already
honest, already anchored by `chosen`. Zero-line diff on all three. The exact
prop feeds are the ones the expert registry uses (Explanations.tsx):
`cand={sel.cand}`, the token's own `temp`/`top_k`/`top_p`, `chosen={sel.chosen}`.

## In scope

- **One knob at a time**: the drawer gets a small flow-side segmented toggle
  (temperature | top-k | top-p) rendering ONE demo, fed from
  `flowCtx.sel` (= `trace.steps[cur].sel`, the draw that picked the frontier
  token). Three stacked 8-row demos in a 560px drawer would bury the idea;
  one-at-a-time is the flow's own law applied inside the drawer. Reuse the
  existing `.seg` / `.seg-opt` classes.
- **A framing line** above the demo: these are the same real options as the
  step's bar; the knobs recompute from the recorded logits, nothing re-runs
  the model.
- **The no-sel case** (prompt-token frontier / stale state): an honest quiet
  note, not a broken demo — mirror the registry's `c.sel ? … : null` gate.

## Out of scope (do not)

- No edits to the three demos or their `temp-*` CSS. No fork drawer (that is
  design-07's). No engine work.

## Files

- `web/src/components/Flow.tsx` — the `sampling` drawer body: toggle state +
  the three feeds. Should be ~30 lines.
- `web/src/styles.css` — a `.fl-knob-*` line or two only if `.seg` doesn't
  already cover the toggle.

## Done when

- The drawer opens on step 4, shows one knob at a time, and every bar/number
  recomputes from the real recorded candidates of the current draw (spot-check
  one probability against the step-4 bar).
- Dragging temp/k/p is anchored by the actually-picked token (red), including
  the "would have been cut" line when applicable.
- Greedy default (temp 0) renders sensibly (the demos already handle it).
- Open → close returns to step 4; the three demos have zero-line diffs.
- `tsc`, build, tests green; drawer screenshots desktop + mobile.

## Pitched alongside (optional — approve or strike each line)

1. **Arrow-key step nav**: ←/→ move between steps when no drawer is open and
   focus isn't in an input — the flow currently requires the mouse for its
   most basic action.
2. **Mobile footer crowding fix**: at ≤400px, hide the `.fl-meta` center text
   on step 0 (it nearly touches the continue button at 375px — noted during
   design-02 verification).

## Commit

"lab: sampling knobs drawer live on draws-one" (+ pitches as their own small
commits). Claude commits.
