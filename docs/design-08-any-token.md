# design-08 — inspect any token (the flow becomes a microscope)

## Goal

Unlock the sentence: the flow currently walks only the frontier token; the
trace already records every token's production. Make the sentence chips
clickable — pick any word and steps 2–4 re-anchor to HOW THAT WORD WAS MADE
(its context, its climb, its draw, its drawers). This is the pass that turns
the corridor into an instrument: N tokens = N explanations sitting in one
sentence.

## Design

- New state: `inspect: number | null` (null = follow the frontier, the
  current behavior). `cur = min(inspect ?? frontier, frontier)`; everything
  downstream (prod, prodStep, flowCtx, drawers) already keys off `cur`.
- **Gestures**: on step 5, clicking any word opens its story (sets inspect,
  jumps to step 2) — with a quiet hint line. On step 2, clicking a context
  chip re-anchors in place. Position 0 is not inspectable (nothing produced
  the seed); its title says so.
- **Orientation**: steps 2–4 show a compact inspect bar while off the
  frontier — `under the microscope: “tok” · position N · ⨯ back to the
  newest` — so the learner always knows which prediction they are inside,
  and has one obvious way home.
- **Reset**: begin / run-again / fork / experiment all return to the
  frontier (inspect = null) — a new run is a new frontier walk.
- Prompt tokens (pos ≥ 1) are inspectable and HONEST: step 3/4 show what the
  model would have predicted there; step 4's existing no-sel copy explains
  "you supplied this one". The fork drawer works there too — "what if you'd
  typed differently" is a legitimate counterfactual the engine supports.

## Out of scope

- No module changes; no engine work; step 1 stays the tokenization lesson
  (anchored to cur's context, same as step 2).

## Done when

- Generate + loop a few tokens; click a mid-sentence word on step 5 → step 2
  anchored there, step 3 climbs to THAT word, step 4 shows ITS draw, the
  dot/rope/sampling/fork drawers all run on it. "Back to the newest" restores
  the frontier. Position 0 refuses quietly. Gate green.

## Commit

"lab: inspect any token from the sentence". Claude commits.
