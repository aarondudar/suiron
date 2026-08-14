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

## The principle to adopt

Proposed as a third visual invariant in `design.md`, beside "honest geometry
channels" and the one-red rule:

> **The loudest channel carries the argument.** In any instrument, the most
> salient visual property is the one holding the real number. A channel that
> encodes nothing may not be the dominant one.
>
> **Position is real or it is absent.** Within one instrument, spatial position
> either encodes a real quantity throughout or is visibly not a data channel —
> and the frame says which, once, in its corner context.

Everything below is an application of those two lines.

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
3. "The loudest channel carries the argument" — pending; question was unclear as
   first put, restated for a ruling.
