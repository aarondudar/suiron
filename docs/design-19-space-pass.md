# design-19 — the space pass

## Goal

Use the viewport honestly: the spine stays intimate (700px, the prototype's
measure), but the instrument OPENS UP when a drawer opens — the frame widens
to 940px for the dense work (grids, woven code, worked demos) and returns on
close. Vertically, the frame grows into tall screens instead of forcing
drawers to scroll inside a fixed 560px box.

## Design

- `.flow-wrap` gains `.wide` while a drawer is open: max-width 700 → 940,
  animated (reduced-motion: instant). Step content is already measure-capped
  (44ch headlines, centered rows), so the widening only benefits the drawer;
  closing contracts back — the expansion itself reads as "deep work mode".
- Frame min-height: 560px → `clamp(560px, 100svh - 200px, 800px)` (with a
  560px fallback line for older engines) — taller screens get a taller
  stage and drawers that barely scroll.
- The heads grid drops its 560px cap (it was sized for the old frame); other
  drawer content widths ride along automatically. Inline step elements
  (climb 400px, dist 360px) keep their deliberate narrow measures.

## Done when

Desktop: opening any drawer widens the frame smoothly and closing returns
it; the 16-head grid uses the width; tall screens show taller frames; mobile
unchanged (both caps ≥ 100%). Gate green + screenshots.

## Commit

"lab: space pass — the frame opens up for drawers". Claude commits.
