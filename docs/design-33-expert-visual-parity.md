# design-33 — expert visual parity

Aaron (2026-07-26): "there is now a large discrepancy between the explanations
between the guided tour and expert mode, especially the visuals. Since the
guided tour's visuals are newer, update the expert view to match the visuals
from the guided tour where applicable."

Principle: the tour's design-31 instruments become the expert bands' HEROES;
the expert's dense per-layer/per-candidate readouts stay below them — density
is what "expert" means. One component, both views: no forks of the visuals.

## Adopted (this pass)

| tour instrument | expert home | how |
|---|---|---|
| AttnSpace (the pulls) | band 02 top | hero above the 28 rows; label "the read, drawn" |
| LensSpace (the climb) | band 02 top, lens read open | swaps in for AttnSpace while `lensActive` (shares the useLens cache) |
| HeadField (16 gaze dials) | band 02, open layer detail | new `fixedLayer` prop pins the dials, hides the scrubber; DotStrips stay below |
| DrawField (the weighted hat) | band 05 selection | hero above the params/table; renders in the forced branch too (it states the forcing itself) |

The `.fl-*` canvas styles are global, so the instruments carry their look.

## Skipped, and why

- **Geometry (band 04)** — already the honest radial instrument; it encodes
  MORE real quantities than the tour's TokenSpace (radius = logit deficit /
  cosine distance). Replacing it would lose information for looks.
- **LoopChain** — band 01's TokenStrip is denser and interactive (confidence,
  arcs, read head, click-to-inspect); the chain would duplicate it weaker.
- **MachineMap** — its `at` highlight and "rounds→layers" relabeling are
  step-bound (script-owned); rendering it un-anchored in the expert lifecycle
  lead would fake a position. Revisit only with a real anchor (scroll spy?).
- **Copy** — the tour's lines are copy-script verbatim; the expert register
  stays its own. Only the two new hero labels were written (expert register).

## Pitched alongside (approve or strike)

- The expert band subtitles (SUB.*) predate the tour's plain-language pass;
  a light one-pass rewrite toward the tour's register (without stealing its
  script) would close the *explanation* half of the discrepancy.
- Band 03's Logits bars could adopt the tour's staggered-entrance timing
  (fl-enter delays) for visual continuity without changing the instrument.
