# design-35 — the instrument language: cohesion and argument

**Plan only. No code until Aaron approves.** (Aaron, 2026-08-10: scope it; and
separately, "let's just fix the visuals — a few of these issues revolve around
the visual instruments and whether we should make them both more cohesive and
more educational.")

## What this is

design-31 turned the tour's readouts into instruments. That pass succeeded at
making them a family. This one corrects what the family resemblance cost: the
instruments now look so alike that the reader cannot tell which of them means
anything by position, and in most of them the loudest thing on screen is the part
that carries no data.

This is not a new skin and not the visual-world prototype (design-30). It governs
what the existing canvases ENCODE, not what they are dressed in.

## The evidence

Every instrument's own header comment names the channel it fakes. Collected:

| instrument | step | position encodes | the real number lives in |
|---|---|---|---|
| TokenSpace | 1 drawer | "only the angle is layout" | distance = real cosine |
| AttnSpace | 2 hero | "reading-order layout" | pull strength |
| LensSpace | 3 hero | "an illustration" | the motion (Σ pₖ·dirₖ) |
| DrawField | 4 hero | `sphereDirs` — not stated anywhere | disc area |
| HeadField | 2 drawer | **angle = the token's place in the sentence** | needle length = share |
| LoopChain | 5 hero | honestly nothing; a chain is a chain | — |
| DotProduct | 2 drawer | no geometry at all | a running scalar |

Mechanical root cause of the resemblance: `TokenSpace`, `LensSpace` and
`DrawField` all call the same `sphereDirs(n)` from `spaceCanvas.ts` — points
distributed on a sphere, rotated by `rotY`. Three different concepts, one layout
function, and in all three that function encodes nothing.

Two findings fall out, and they are opposites:

1. **Over-cohesion.** The instruments do not merely rhyme; three of them are the
   same picture. Step 1 explicitly teaches "nearby points mean similar things",
   and then steps 3 and 4 reuse that exact picture with position meaning nothing.
   A reader who learned the grammar imports it and is wrong. The cohesion problem
   is not too little shared language — it is shared language with no dialect.
2. **Inverted salience.** In TokenSpace, LensSpace and DrawField, the dominant
   visual signal is a rotating 3-D point cloud, which is noise; the argument sits
   in a secondary channel (distance, motion, area). The most salient thing on
   screen should be the thing being taught. DotProduct is the extreme case: a
   128-dimensional relationship rendered as a bar filling up, so the brightest
   element in the drawer is a progress indicator.

Corroboration from the fresh walk (`audit-fresh.md`): the two instruments singled
out as working — LoopChain ("the best composition in the app") and HeadField —
are precisely the two where position is either honestly nothing or honestly real.

## The working test (NOT yet an invariant)

Offered first as a `design.md` invariant — "the loudest channel carries the
argument". Aaron, 2026-08-10: sounds right on paper, too abstract to commit to.
That is a fair verdict and a useful one: a rule you cannot apply in seconds does
not work as a guardrail, it just sits in a doc. So it is demoted to a working
test for the duration of this track, in a form that needs no vocabulary:

> **The squint test.** Squint at an instrument until the detail blurs. Whatever
> you can still see — the biggest, brightest, most-moving thing — point at it and
> say which number it is. If you cannot name one, the instrument is decorating.

Applied to what ships today:

- **DrawField** — you see a big red circle somewhere in a field. Its SIZE is a
  real share (passes); its POSITION is `sphereDirs` and means nothing (fails).
- **DotProduct** — you see a bright full-width bar. It is a progress indicator.
  Fails hardest, which is why this drawer reads as unparseable.
- **HeadField** — you see needles pointing. Direction is the token's real place
  in the sentence, length is the head's real share. Passes cleanly.
- **LoopChain** — you see a chain with an arrow curving back. The arrangement
  means sequence, which is true. Passes.

The last two are the instruments the cold walk singled out as working, before the
test existed to explain why.

**Promotion rule.** Every law in this project was written after its evidence, not
before it — storyboard law 7 exists because six of seven steps overflowed. So:
use the squint test through this track and record what it catches. If it flags
real problems and never blocks something Aaron likes, it earns a line in
`design.md` afterwards, with these examples attached. If it turns out fussy, it
dies here and costs nothing. Nothing below depends on the ruling.

One corollary is worth keeping either way, because it is the specific defect this
plan exists to fix:

> **Position is real or it is absent.** Within one instrument, spatial position
> either encodes a real quantity throughout or is visibly not a data channel —
> and the frame says which, once, in its corner context.

## Status: track B built (2026-08-14)

Three passes, one instrument each, all verified live and committed separately.

- **pass 1 — DotProduct.** Progress bar → one column per component, up for
  agreement, down for disagreement. First cut also drew q and k as their own
  lanes to show WHY a product spikes; measured it and 116 of 128 key bars came out
  sub-pixel, because these are heavy-tailed real vectors and rescaling to fix that
  would break "radius = real value". Cut them; the product took the full height.
- **pass 2 — DrawField.** Disc cluster on `sphereDirs` → one bar divided by real
  full-vocabulary share, with everything the model did not shortlist as its own
  slice, so the bar sums to 1. At temp 1.5 the favourite holds 15% and 72.5% of
  the draw belongs to tokens that were never candidates — the step's aside has
  always claimed the long shots get a real chance, and this is the first version
  of the picture that shows it. The client-side softmax that sized the discs is
  gone with them.
- **pass 3 — LensSpace.** Swinging vector on a sphere → layer across, probability
  up. Both axes real, the lock-on layer marked on the axis it belongs to. Shows
  what the sphere could not: the answer is worth nothing for twenty-two layers,
  then erupts past 90% and settles at 65%, and the grey rival leading early is the
  caption's "its guess so far" rather than a fault.

**Inventory correction.** The plan's table listed a `TokenSpace` row for step 1's
map. Wrong on two counts: nothing mounts `TokenSpace` (only `pickAnchor` is
imported from it — dead component, worth removing), and the map that DOES render
is `GeometryCard read="meaning"`, which was already 2-D, already SVG, and already
documents "distance from the focus is the only such claim… angle is LAYOUT ONLY.
No projection, ever." It needed no pass. So the sphere problem was three
instruments, one of them dead — not four.

**Verified after the track:** all 7 steps and all 9 drawers walked at 1280x720
with an installed error trap — zero runtime errors, nav on screen at every step,
no page scroll. New SVG text checked against law 8: effective sizes 9–11.8px at
4.67–7.56:1 (SVG text scales with the viewBox, so the small font-size values are
not the rendered ones). The ticket bar's won slice moved to `--red-deep` so its
label clears the text bar.

**Not done by this track:** the score drawer is still the longest thing in the
tour (~3.4 screens). That is Track C, not a picture problem.

## Track A — cohesion: one language, distinct dialects

The goal is NOT to make the instruments look more alike. It is to make the
difference between them legible, so recognition transfers correctly.

- **Name the channel, once, per instrument.** Each instrument's corner context
  already exists as an I-slot ("suiron · tokens · meaning space"). Extend it to
  state what position means there: real distance, reading order, or layout only.
  Cheapest possible differentiator; copy-script owns the strings.
- **Retire `sphereDirs` as the shared default.** Where position is decorative,
  stop spending the screen's dominant channel on it. Candidates per instrument in
  Track B.
- **Let the frame differ where the concept differs.** A neighbourhood (step 1) is
  a map; a climb (step 3) is a sequence; a draw (step 4) is a partition of one
  whole. Those are three different diagram families, currently drawn as one.
- **Keep the family in the skin, not the geometry** — hairlines, dot-matrix
  figures, the one red, the corner context. Those already unify the app and cost
  nothing in meaning.

## Track B — argument: instruments that teach

Per instrument, the disposition to decide. Each keeps every number live.

- **DotProduct (the worst, and the one Aaron flagged).** The drawer already
  computes the punchline — "components 60, 124 alone give 46.097 of the 72.566, a
  few coordinates carry the match" — and then draws a loading bar over it.
  Proposed: replace the running bar with a **signed per-component strip** — q's
  128 components, k's 128, and their product — so the match is visibly a field of
  noise with a few spikes doing the work. Same data, exact, no new engine call.
  The accumulation becomes the area under the product strip rather than a scalar
  ticking up.
- **DrawField.** Area is already the real channel and it works. Proposal: drop
  the sphere; lay the discs out as a partition of one field (a weighted packing or
  a single bar), so "the odds" reads as shares of one whole rather than objects
  floating in space. Also decide the opening temperature — it currently opens at
  the run's temp 0, where one disc swallows everything and the step's own message
  ("it gives every token a probability") is invisible.
- **LensSpace.** The motion is the data and that is genuinely good. Proposal:
  keep it, but make the depth axis explicit rather than implied by a slider, so
  "the guess climbs" has somewhere to climb.
- **TokenSpace.** Distance is real; only direction is not. Proposal: constrain to
  2-D with distance-from-anchor as the sole spatial channel, so the map reads as a
  map and stops rhyming with the two instruments where position is decorative.
- **AttnSpace.** Closest to correct already (reading order is a real ordering).
  Proposal: no geometry change; carry the sink disclosure now in the caption into
  the instrument's own honest line.
- **HeadField, LoopChain.** No change. They are the reference for the rest.

## Track C — one thing at a time INSIDE a drawer (Aaron, 2026-08-10)

Raised as "intelligently surfacing some of the other information on screen in any
one drawer, so it is less overwhelming and more visually minimalist — I am not
sure there is any way to do that." There is, and it is already in the codebase:

```
/** the sampling drawer shows one knob at a time — the flow's own law applied
 *  inside the drawer (three stacked demos would bury the idea) */
export const KNOBS = ["temperature", "top-k", "top-p"] as const;
```

That is the single-drawer rule applied one level down, and it is why the sampling
drawer reads at 1.3 screens while the score drawer reads at 3.45. The score drawer
stacks four sections — the component strip + its stepper, the blend + its stepper,
the head attribution, and the woven source — which is exactly what the comment
above says not to do.

**BUILT (2026-08-14).** The segmented pattern now runs the score drawer: `the
score` / `the blend` / `the source`, in the order the arithmetic happens, defaulting
to the score. No new mechanism and no new component — `.seg` / `.seg-opt` were
already there and already styled.

| | words | screens |
|---|---|---|
| before, one stack | 517 | 3.45 |
| the score (where you land) | 182 | 1.63 |
| the blend | 258 | 1.98 |
| the source | 298 | 2.54 |

The landing segment is now in line with its siblings (median ~146 words, ~1.3
screens). The source segment is still the tallest because 28 lines of Rust are 28
lines of Rust — but it is opt-in, which is the whole point. The expert view keeps
the full stack, verified: spinners, strip, blend and source all present, no
segmented control.

Still to audit against this pattern: the other multi-section drawers (`kept
steady`, `reworked`, `the readout`) — none is near 3 screens, so none is urgent.

## Out of scope, explicitly

- **Manim, and pre-rendered video of any kind** (raised and rejected, 2026-08-10).
  It is Python + OpenGL + ffmpeg with no browser or WASM target, so anything it
  produces is baked for one prompt — which is the exact thing `design.md` forbids
  ("copying its fake numbers would quietly betray the project's core rule"), and
  a recording cannot fork. Recorded here so a later pass does not rediscover the
  idea and ship it. Using it privately to storyboard motion was offered and
  declined; if that changes it needs its own ruling.
- New engine work. Every proposal above reads data the instruments already have.
- A new palette, a second accent, or a component library.
- The storyboard's step order, copy, or the ledger. This pass changes pictures.

## Gate

Per `design.md`: one instrument per pass, never a global change. `tsc` strict,
`vite build`, `lib.test.ts` green, every flow step and wired drawer still live.
Plus, for this track specifically:

- Screenshot each instrument before and after at 1280x800 AND 1280x720; the
  storyboard's law 7 (the stage fits the window) must survive every change.
- State, in the pass's commit, which channel now carries the argument.

## Pitched alongside (approve or strike — none is a finding)

- A one-line legend on first encounter of each diagram family.
- Reduced-motion review: three of these instruments idle-rotate; under
  `prefers-reduced-motion` the rotation is the part that should go first.
- The candidate lists still show tokens that render as blanks, `...` and `____`
  with nothing saying they are real vocabulary entries.
- A cold re-walk after this track, on a real screen, by a person — the visual
  half of the tour has still never been judged that way.

## Aaron's rulings (2026-08-10)

1. **2-D is fine where it is more honest.** Settles the biggest open question in
   Track B: the three sphere instruments may flatten. A third dimension that
   carries nothing is not worth the grammar collision it causes.
2. **Step 4 keeps opening at the run's own temperature; the COPY has to reflect
   temp 0 accurately.** So the default view stays faithful to what the run
   actually did, and the fix is in words, not in the dial's starting position —
   the reader must not read "100%" as the model's confidence when it is the
   dial collapsing onto the top pick. Landed ahead of this plan (see design-34).
3. **No ruling needed yet.** The invariant is demoted to the squint test above
   and earns its place, or doesn't, from what the track actually catches. Nothing
   in this plan waits on it.
