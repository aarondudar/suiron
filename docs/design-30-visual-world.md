# design-30 — the visual world (experimental branch)

Branch: `experiment/visual-world`. Main keeps the current guided tour intact;
this may or may not ship. This doc supersedes design-01's shell *on this branch
only* — it is a different answer to the same question ("show text inference to
someone who's never seen it"), not a refinement of the old one.

## Why we're here (the honest diagnosis)

The stepper/drawer tour reached a ceiling. Two founding rules turned out to be
capping it:

1. **We visualize DATA, not the MECHANISM.** Bars, scores, grids, a probability
   line chart — competent, honest, but they *plot outputs*. 3blue1brown /
   Veritasium *model the thing itself*: a token is an object with a position and
   a direction; you watch it get transformed. That's the leap we kept missing.
2. **`docs/geometry-view.md`'s "no projection, ever · angle is layout only"**
   forbids exactly the spatial metaphors that make transformers click, and
   **"monochrome + one red"** starves us of the ability to track distinct
   objects in motion. Principled, but they structurally prevent the visual we
   want.

Aaron's framing: a more *premium, Apple-product-page* feel — the steps flowing
into each other organically (scroll-driven), not clicked through.

## The vision

**One continuous "space of meaning." One traveling object — the token's
vector. Five acts, experienced as a scroll-driven camera moving through that one
world.** Continuity is the thing 3b1b has and our five disconnected widgets
never did: the same object, followed from input to output.

### Positioning (the novel claim)

**"3blue1brown, except every frame is computed from a real running model, not
hand-animated."** 3b1b hand-draws an idealized transformer; we generate the same
*class* of illustration from actual Qwen3 weights, with the verified numbers one
hover/click underneath. Nobody has that.

## The five acts (visual metaphors, not charts)

1. **tokens →** the word *falls into* the space and settles among its real
   nearest neighbors (Paris drifts beside France, Tokyo, capital). Position =
   meaning, shown.
2. **looks back →** earlier words physically **tug** the current vector; each
   pull's strength is the real attention score. You watch the vector get
   *assembled* from its context.
3. **sharpens →** the vector **rotates through the space and locks onto the
   "Paris" direction** over the 28 layers; the logit lens becomes literal —
   "which word-direction is it pointing at right now?" — with the lock-on at
   layer 22 marked in the world. *(Prototype this act first.)*
4. **draws one →** the surviving candidates as a weighted field / spinner; the
   draw lands; temperature visibly loads the dice.
5. **loops →** the camera pulls back to reveal the whole sentence as a chain,
   each link having travelled the same machine. "You just watched this happen."

## Honesty contract v2

The thesis evolves from *"every pixel is a verified number"* to **"every
illustration is generated from real numbers you can check."**

- Projections are allowed, but **labeled as projections** ("a 2-D shadow of
  1,024-D space") and **computed from the real vectors** (e.g. PCA/MDS of the
  actual returned neighbor set / residual), never hand-placed.
- The **real numbers stay one hover/click away** on every visual.
- The **expert view remains the rigorous instrument** (raw values, no
  projection) — the world is the intuition layer, the expert view is the proof
  layer. Keep both; link between them.
- Every claim still traces to the engine (neighbors, lens, inspect, trace).

## Departures from design.md (deliberate, branch-only)

| design.md (main) | design-30 (this branch) |
|---|---|
| stepper + single-drawer, click-through | scroll-driven acts, flowing |
| no projection, ever | honest labeled projections of real vectors |
| monochrome + one red | dark base + a small *tracked* palette (objects keep their colour) |
| motion spent only on the spine | motion is the medium |
| visual accompanies text | visual leads; text is caption |

## Tech approach

- `web/` may take runtime deps (CLAUDE.md exempts the frontend; only the Rust
  crates are zero-dep). So a rendering/animation lib is on the table.
- **Rendering:** likely Canvas or WebGL (three.js / regl / ogl) for a smooth
  spatial world with depth + camera; SVG is probably not enough for the motion
  budget. Evaluate on the prototype.
- **Scroll:** IntersectionObserver / scroll-progress driving the camera and act
  transitions (the Apple-page pattern). A thin scrollytelling helper or hand-
  rolled.
- **Data:** the existing engine APIs already serve everything the acts need —
  `neighbors` (act 1), `inspect`/attn weights + q/k/v (act 2), `lens` per-layer
  tops + residual (act 3), `trace` sel/cand (act 4). Projections computed
  client-side from the real vectors (PCA/MDS). One possible new engine read: the
  residual vector per layer for act 3's rotation (lens already returns the
  decoded tops; we may want the raw direction too).
- Reuse the demo-recording mechanism so the static build still runs.

## Staging (prototype-first, to avoid another months-long spiral)

1. **Prototype act 3 only** ("sharpens" = the rotating vector locking on),
   static/one-off data if needed, real motion. Judge the direction on ONE
   finished act before committing to the world. **This is the go/no-go.**
2. If it lands: build the shared world + camera + scroll spine.
3. Port the other four acts into it, wired live.
4. Keep the expert view; decide the old guided flow's fate (it survives on
   `main` regardless).

## Open questions / risks

- Performance: WebGL + the wasm engine on a phone tab.
- Projection honesty: PCA of a small neighbor set can mislead; label carefully,
  and let the expert view carry the un-projected truth.
- Scope: this is a genuine new build, not a polish pass. The prototype gate
  exists to fail fast if the direction is wrong.

## Commit / branch discipline

Work lands on `experiment/visual-world`. `main` is the fallback (the working
guided tour). Nothing here overwrites main until Aaron says so.
