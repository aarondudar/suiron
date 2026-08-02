# design-01 — the guided-flow shell + the single-drawer mechanism

## Goal

Stand up the new default experience: the five-step guided flow (the spine) and the
drawer mechanism that opens one deep-dive over a step and returns the user to
place. Prove the rhythm with **one real, live drawer** (the worked dot product,
which already exists and already runs live). Stub the other dive points. Keep the
old everything-at-once stack reachable so nothing is lost. This is the foundation
every later re-homing pass builds on, and the largest single design pass.

**Read first:** `docs/design.md` (the architecture and the law), and open
`docs/prototype/core-loop.html` in a browser to feel the target — the step pacing
and the open/return drawer rhythm are what you are matching.

## The critical rule (do not violate)

The prototype uses **canned numbers**; the real app must not. Every step and drawer
reads **live** from the engine on the user's own prompt, through the same
`generate` / `getTrace` / `getLens` / inspect machinery `App.tsx` already uses. The
prototype is the shape and pacing to match, never a data source. Do not port its
fake values.

## In scope

- A **flow shell**: a default mode that walks the five steps (tokens → looks back →
  sharpens → draws one → loops), one per screen, with step nav (a rail + back /
  continue), driven by a real run. Step 0 takes/confirms a prompt and calls
  `generate`; each step reads the real trace / step data for the current token.
- The **single-drawer mechanism**: a step can open exactly one drawer, shown over
  the step (the step recedes, not unmounts), dismissed back to the same step. Only
  one open at a time; opening another closes the first. Reduced-motion safe.
- **The inline signature**: on "sharpens", render the real logit-lens climb inline
  (reuse `getLens` + the existing lens rendering), not as a drawer. It is the one
  full-real-estate moment in the spine.
- **One live proof drawer**: wire the existing worked dot product (`DotProduct` /
  the attention interactive) as the drawer on "looks back", running live on the
  current token. Prove open → live compute → close → back to place.
- **Stub the other dive points** (tokens, draws one, loops) as labelled buttons
  that open an empty "coming soon" drawer — placeholders for later re-homing.
- **Keep the expert stack reachable**: the current stacked-bands view stays
  available behind a toggle/route (e.g. `?view=expert` or a header switch). Do not
  delete it; do not change its internals.

## Out of scope (do not)

- Do not re-home the other modules yet (merges, RoPE, RMSNorm, sampling, KV cache,
  epilogue). Those are one plan each, after this. Stubs only here.
- Do not change any module's internals, props, engine calls, the geometry math, or
  the registry. Composition and new shell components only.
- Do not delete or restyle the expert stack beyond making it a non-default route.
- Do not add a new palette, a second accent, or a gradient. Hold every visual
  invariant in `docs/design.md`.
- Do not build the whole thing in one giant edit — land the shell, then the drawer
  mechanism, then the one live drawer, verifying each renders live before the next.

## Files (confirm against the tree)

- new: `web/src/components/Flow.tsx` (the spine + step nav), `web/src/components/
  Drawer.tsx` (the single-drawer host), and small step components as needed.
- `web/src/App.tsx`: choose flow (default) vs expert stack (toggle/route); the flow
  drives the existing `generate`/trace state that already lives here.
- reuse as-is: `DotProduct` / attention interactive (proof drawer), the lens read /
  `getLens` (inline climb), `TokenStrip`-style rendering for the token step.
- `web/src/styles.css`: the flow layout, the step rail, the drawer (slide-over-the-
  step), all within the existing token system.

## Build sequence

1. Flow shell: five steps, real prompt → `generate` → steps read the live trace for
   the current token. Step transitions paced, reduced-motion safe.
2. Inline climb on "sharpens" from real `getLens`.
3. Drawer mechanism: open-one / show-over / close-to-place; enforce one at a time.
4. Wire the worked dot product as the live "looks back" drawer; stub the rest.
5. Expert-stack toggle/route; confirm the old view still works untouched.

## Done when

- Default load is the guided flow; entering a prompt runs the real engine and the
  steps show that run's real data for the current token.
- "sharpens" shows the real lens climb inline (the winner climbing across layers),
  matching the engine's final logits.
- Opening "watch one score compute" on "looks back" runs the **live** worked dot
  product for the current token, agrees with the engine, and **close returns to the
  same step**. Only one drawer is ever open.
- The other dive buttons open a single stub drawer and close cleanly.
- The expert stack is still reachable and unchanged.
- `tsc` strict, build, and `lib.test.ts` all clean. Screenshot the five steps + the
  open drawer at desktop and mobile widths and confirm they match the prototype's
  pacing.

## Verify

`npm run build` + `tsc` clean; `lib.test.ts` green. On `make dev`: a real prompt
walks all five steps live; the proof drawer computes live and returns to place;
only one drawer opens at a time; the expert route still renders. Compare the
captured steps against `docs/prototype/core-loop.html`.

## Commit

Stage it: "lab: guided-flow shell + step nav (default view)", "lab: single-drawer
mechanism + live worked-dot drawer on looks-back", "lab: keep expert stack behind a
route". User commits.
