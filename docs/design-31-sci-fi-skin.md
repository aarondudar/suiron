# design-31 — the sci-fi premium re-skin

Branch: `feature/sci-fi-skin` (off main). LOOK only — no functional, flow, or
data changes. Keep everything main does; change how it feels.

## The decision (Aaron, 2026-07-20)

The galaxy rewrite was straying. But the **space / sci-fi premium aesthetic** we
found in `proto-starfield` is worth keeping. So: re-skin the *existing* app in
that aesthetic. Three surfaces: (1) the guided tour, (2) the demos' visuals,
(3) the expert view. No galaxy, no WebGL, no rebuild.

## The aesthetic system

- **Starfield backdrop** — one shared, subtle drifting star layer behind the
  whole app (replaces the dot-grid). Barely-there; readability first; static
  under reduced-motion.
- **Nav-HUD chrome** — thin corner brackets on frames; monospace, letter-spaced
  console labels; hairlines. The starship-console framing.
- **Frosted frame** — the flow/expert panels go slightly translucent with a
  subtle backdrop blur, so the starfield reads faintly through (depth).
- **Palette discipline stays** — dark + the one red (still the model's choice).
  HUD chrome in the faint/steel grays. No second data-accent.
- **Type** — Doto for figures (unchanged), mono for HUD/labels, generous
  letter-spacing on console text.
- **Motion** — a calm starfield drift; everything else unchanged. Reduced-motion
  respected everywhere.
- **Honesty note (v2 idea)** stays available: framing projections/instrument
  readouts as a nav console is now on-brand.

## Method (no big-bang)

1. Shared layer: `Starfield` component + HUD-chrome CSS tokens.
2. Re-skin the **guided tour** first as the exemplar → confirm with Aaron.
3. Upgrade the **demos'** visuals to match (per drawer, light touch).
4. Re-skin the **expert view** (sections → console panels) to match.
Verify each stage live; gate (tsc/build/tests) stays green.

## Guardrails

- Contrast/readability is the veto — if the starfield or translucency hurts
  legibility, tone it down. It's a backdrop, not a feature.
- Don't touch component logic, props, engine calls, or the flow structure.
- Keep it tasteful — restrained console, not LCARS kitsch.

## Commit

Per-stage: "lab: sci-fi skin — starfield + HUD frame (tour)", then demos, then
expert. Claude commits; Aaron pushes/merges.
