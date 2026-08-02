# design-18 — the drawer dock

## Goal

The dive affordances move out of the stage (where 1–3 stacked ↓ buttons had
started crowding the lesson) onto the frame's bottom edge: a persistent dock
of drawer HANDLES between the stage and the nav. The metaphor becomes
literal — drawers pull up from the dock — and the stage returns to holding
exactly one idea. Approved by Aaron with the mock (2026-07-19).

## Design

- Handles are short ("think", "16 readers", "what if?"); the full sentence
  becomes the tooltip and remains the open drawer's title. No badges, no
  pulsing — the dock's constancy is its prominence.
- **The dock stays live while a drawer is open**: the active handle is
  marked (× to close, or tap it again); tapping another handle switches
  drawers in place. The single-drawer rule becomes visible mechanics, and
  related drawers (norm ↔ residual ↔ think) become one-tap comparisons.
- The drawer now overlays ONLY the stage: the frame is head / stage(+drawer
  overlay) / dock / nav, all chrome live. Navigation still closes the open
  drawer (goPhase); arrows now navigate even with a drawer open (typing
  fields still guarded). The drawer rises from the dock edge;
  reduced-motion: appear.
- The drawer's redundant "one drawer at a time" footer line is removed — the
  dock says it better. Conditional handles (two worlds needs a fork) carry
  over.

## Done when

Stage shows only the lesson on every step; handles open/switch/close
drawers in place; Esc + close + nav still work; deep-link drawer restore
still lands open; reduced-motion safe; gate green; desktop + mobile
screenshots.

## Commit

"lab: the drawer dock — handles on the frame's bottom edge". Claude commits.
