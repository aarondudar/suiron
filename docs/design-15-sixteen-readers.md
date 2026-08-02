# design-15 — the sixteen readers (looks back drawer 3)

## Goal

The flow presents attention as one spotlight; it is sixteen, each looking
somewhere different, and their jobs change with depth. New drawer on
**looks back**: a live grid of all 16 heads at one layer — each cell names
that head's strongest source token and its real weight — with a layer
scrubber (Stepper + autoplay) so you WATCH the readers change jobs as the
pass deepens. Early layers: local/syntax; middle: the content lock; sinks
everywhere once there's nothing to find.

## The teachable moment

Scrubbing IS the lesson. The autoplay walks layer 0 → 27 and the grid
reshuffles under your eyes: heads snap onto “ France”, fall back to the sink,
go local. A second interaction: click a head cell → that layer+head feeds the
worked-dot drawer's controls story (kept simple: the cell's title carries the
numbers; deep-diving a head stays in the dot drawer).

## Honest by construction

Everything comes from `trace.steps[prod].attn[layer][head]` — the top-k
attention edges the engine already recorded for every layer and head. Zero
fetches; `headGlance()` (lib.ts) already computes per-head top target + share.
Red marks only the layer's single strongest head-read. The sink (pos 0 with
nothing to find) renders dim with its own tag, matching the expert stack's
vocabulary.

## Files

- new: `web/src/components/HeadGrid.tsx` (flow-native, ~80 lines, pure over
  the trace; reuses `useAutoplay`, `Stepper`, `headGlance`, `litToken`).
- Flow.tsx: `DIVES[2]` += heads; drawer body.

## Done when

The grid renders 16 real cells per layer; the scrubber + autoplay work
(reduced-motion lands on the attention-lock layer... on the final layer per
useAutoplay's contract); spot-check one cell against the worked-dot drawer's
source options at the same layer/head. Gate green.

## Commit

"lab: the sixteen readers — heads grid with layer scrubber". Claude commits.
