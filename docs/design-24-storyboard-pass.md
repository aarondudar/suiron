# design-24 — the storyboard pass (one hero per step)

## Goal

Bring the stage under the same authority as the words. `docs/storyboard.md`
now owns everything visible (hero, cast, chrome, entrance order, what is NOT
shown); `docs/copy-script.md` plus its addendum owns every string, including
instrument text, the machine map, and the dock handles. This pass makes the
shipped flow conform to both. It is mostly SUBTRACTIVE: demotion, deletion,
and choreography, not new features.

## Read first (binding, in this order)

1. `CLAUDE.md` — the hard rules.
2. `docs/storyboard.md` — the law of the stage and the per-step stage
   directions. Binding.
3. `docs/copy-script.md` INCLUDING the addendum — the amended step 2/3
   captions, the four adopted drawers, the I-slot instrument strings, the
   map's exact strings, the dock handles. Binding and verbatim.
4. The flow components before editing: Flow.tsx, MachineMap, AttnSpace,
   LensSpace, TokenSpace, SignalField, the dock, and each drawer named.

## In scope

- Enforce one-hero-per-step and the tier hierarchy on every step (0–5).
- Implement the entrance order (H → beat → hero plays once → C → A → dock
  last; reduced-motion: all at once) and silence between steps.
- The map: chrome tier, steps 2–4 only, script strings verbatim, the step-2
  intro beat, the rounds→layers relabel at step 3, absent at 0–1 and 5.
- Install the two amended captions (step 2, step 3) and wire {lock_layer}
  from lib.ts moments(); expose {lens_top} from the climb to its caption.
- Install the four adopted drawers' copy verbatim; set all dock handles from
  the addendum; long script phrases become drawer TITLES when open.
- Re-dock "guess by depth" (residual) to the lens-depth module; retire
  SignalField to the expert view.
- Replace instrument-printed text with I-slot strings; delete every
  instrument string not listed.
- Final ledger sweep across EVERYTHING visible (slots, instruments, chrome,
  map, handles): zero violations is the bar.

## Out of scope (do not)

- No new visual elements, no new drawers, no new motion beyond the entrance
  order. The displacement rule is in force: this pass only adds what the
  storyboard names, and the storyboard mostly removes.
- No changes to engine calls, module math, props, the registry, or drawer
  open/close logic.
- design-30 (visual-world) and design-31 (sci-fi skin) are frozen behind this
  pass; touch neither.
- If storyboard and code conflict in a way the storyboard does not rule on,
  STOP and flag it. Aaron edits the documents, not CC.

## Build sequence

One step at a time, verified live before the next: step 0 → 1 → 2 (map
entrance) → 3 (climb + re-dock + relabel) → 4 → 5 (map retirement). Then the
instrument-text sweep, then the full ledger sweep.

## Done when

- Walking the tour on a real prompt: every step shows exactly its storyboard
  stage (hero, ≤1 cast, chrome), enters in the scripted order, and clears
  between steps. Reduced-motion shows everything at once.
- The map matches the addendum exactly, including the step-3 relabel moment,
  and does not exist on steps 0–1 or 5.
- Step 2 and 3 captions render with live {cur_token}, {lens_top},
  {lock_layer}; no slot is hardcoded.
- All nine + four drawers carry script copy verbatim; dock handles match the
  addendum; "guess by depth" opens the lens-depth module; SignalField is
  reachable only in the expert view.
- Ledger sweep: ZERO violations anywhere visible in the flow.
- tsc strict + build clean; all tests green.

## Report

Per step: hero, cast, chrome present, entrance order observed, and every
string removed. Plus: the ledger sweep result, any slot without a live value,
any storyboard/code conflict hit. No commits; Aaron commits.
