# design-11 — the two worlds (the fork, side by side)

## Goal

After a fork, the flow shows one quiet road-not-taken line. Give the
counterfactual its full payoff: a "the two worlds" drawer on **loops**,
visible only while a fork is resident, showing both runs as sentences —
shared prefix dimmed, the divergence marked, both continuations side by side.
`shadowTrace()` (lib.ts) already reconstructs the replaced run; this is pure
composition over it.

## Honest color (the law applied)

Red means THE MODEL'S choice. So in the other world's row, red marks the
token the model actually chose at the fork position; the token YOU forced in
this world gets an ink emphasis and a "you forced" tag — never red. The two
tags teach the whole idea by themselves.

## In scope

- `DIVES[5]` gains `worlds` ("the two worlds"), rendered only when
  `trace.fork` exists (a conditional affordance, not a dead button).
- Drawer: two labelled rows (this world / the other world) of real chips —
  prefix `[0, fork.pos)` dim, divergence tagged, tails at full ink — plus a
  caption naming both tokens and the position. `shadowTrace() === null`
  (older engine recording) degrades to an honest note.

## Done when

- Fork a token → open "the two worlds" → both real runs render with the
  divergence marked; the shadow's fork-position token is red, the forced one
  ink-tagged; close returns to loops; the dive hides when no fork is
  resident. Gate green.

## Commit

"lab: two-worlds drawer compares the fork". Claude commits.
