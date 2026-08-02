# design-14 — "what a word means to the model" (tokens drawer 2)

## Goal

The flow stops at token ids; the model doesn't — every id is a row in the
151,936 × 1,024 embedding table with real geometry. New drawer on **tokens**:
pick any word of the sentence and see (a) its actual table row (`EmbeddingRow`
— an identity read, works even at the seed) and (b) its nearest real
vocabulary neighbors by cosine on the compact radial (`GeometryCard`
read="meaning").

## The teachable moment (the bar from Aaron, 2026-07-19)

Not an explanation — a picker. The drawer opens on the current token, and
every chip in the sentence is clickable INSIDE the drawer: pick " France",
the row and the neighbor ring recompute live; pick "。", watch a punctuation
token's neighborhood. The comparison between two picks IS the lesson.

## Mechanics

- Both modules re-home unchanged; the picker is flow-side state
  (`pickTok`), fed as a ctx override `{ ...flowCtx, cur: pickTok }`.
- `GeometryCard` calls `useExplainer()` → wrap in the existing no-op provider
  (same as the finale).
- Neighbors/inspect are cached+deduped in api.ts, so repeated picks are cheap.

## Done when

Picking different tokens live-updates the row slice and the neighbor ring;
the ring's cosines are real (hover titles); gate green.

## Commit

"lab: meaning drawer — pick a word, see its geometry". Claude commits.
