# design-05 — re-home RoPE onto "looks back" (+ the multi-dive row)

## Goal

Give step 2 (**looks back**) its second live drawer: `RopeDemo`, unchanged —
how position spins the vectors before attention compares them. This pass also
introduces the one shell mechanism design-01 deferred: a step with MORE than
one dive point. The single-drawer rule is untouched (opening one closes the
other); only the affordance row grows.

## Scope decision (differs from the design.md map)

The map lists "attention heads" on looks back too, but no standalone heads
module exists — the head grid lives inside the `LayerStack` band. Extracting
it would be rebuilding, which re-homing forbids. So: RoPE only; the heads
grid stays in the expert view until a heads module exists on its own terms.
(Noted here so the map's entry isn't silently dropped.)

## In scope

- `DIVES` becomes per-step **lists**; the dive row renders one quiet button
  per drawer, stacked, same styling. One open at a time, by the same single
  state slot.
- `rope` drawer → `<RopeDemo ctx={flowCtx} />` behind a framing line ("before
  comparing two tokens, attention spins each one's vector by its position —
  that spin is how word order enters"). RopeDemo fetches its own inspect at
  `ctx.cur` (identity read) — untouched.

## Out of scope

- No heads extraction, no LayerStack changes, no RopeDemo/`rope-*` CSS edits.

## Done when

- Step 2 shows two dive buttons; each opens its drawer live; opening one
  closes the other; close returns to step 2.
- The RoPE demo runs on the current token's real pass (its identity check
  "rotating q_pre by the angles reproduces q" passes on screen).
- Zero-line diffs on RopeDemo; gate green; screenshots desktop + mobile.

## Pitched alongside (optional)

None this pass — the multi-dive row IS the readability work here; keeping it
visually identical to the single-dive case is the feature.

## Commit

"lab: rope drawer live on looks-back (multi-dive row)". Claude commits.
