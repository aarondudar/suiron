# design-09 — the token's story, computed (never narrated)

## Goal

Surface the trace-derived "moments" the expert view already computes
(`moments()` in lib.ts) as one-line captions inside the flow, so every
inspected token gets an honest story where each clause cites a real number:

- **looks back**: the attention lock — "layer 14 · attention locks onto
  “France” (38%)" — plus the induction marker when a head clears the bar.
- **sharpens**: the decision — "“ Paris” takes the lead at layer 20 and
  holds" — derived inside LensClimb from the lens it already fetched.
- **draws one**: the outcome — runaway / leads / near-tie, from the real
  top-2 gap.

No prose generation, no LLM voice, no heuristics beyond what `moments()`
already encodes. A marker that no real value supports simply does not render
(the function's own contract).

## In scope

- Flow computes `moments(trace, prod)` once per inspected token; steps 2 and
  4 render their markers as quiet `.fl-mark` captions.
- LensClimb adds the lead-layer clause to its existing settled line.

## Out of scope

- No changes to `moments()` itself; no new engine reads (the lens is already
  fetched; everything else is trace-local).

## Done when

- Each caption's numbers can be spot-checked against the drawers behind them
  (the attention lock layer matches where the worked dot finds the strongest
  edge; the lead layer matches the climb's own flip point). Gate green.

## Commit

"lab: computed story captions on looks-back/sharpens/draws-one". Claude
commits.
