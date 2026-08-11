# design-34 — the fresh-walk fixes

## What this is

The fix track for `docs/audit-fresh.md` (cold walk, 2026-08-10). All ten bucket-A
items, sequenced one step per pass per `design.md`. Aaron's calls on 2026-08-10:
make the odds **genuinely true** (not merely disclosed), CC **drafts** the new copy
as clearly-marked proposals for Aaron to edit, and **all ten** items ship.

## Two amendments to the law (deliberate, not drift)

1. **`design.md` → "Out of scope (whole track)" currently reads "No new engine
   work; `web/` composition only."** Item A1 breaks that line on purpose: the
   step-4 odds cannot be made true from the client, because the softmax
   normalizer depends on the temperature the reader is dragging. Amend the
   out-of-scope ruling to carve out the odds endpoint, rather than leaving the
   doc contradicted by the code.
2. **`copy-script.md` does not own the outro.** Today it says `D (epilogue):
   copy lives with the epilogue band`. That is precisely why the outro drifted
   into addressing the expert view (A2). The script takes ownership of the outro
   slots; the epilogue band renders script text like every other surface.

## The audit's A1 is superseded — read this before touching step 4

The audit filed A1 as a copy conflict and proposed cutting the step-4 caption.
**That was backwards.** Diagnosis (2026-08-10):

- `DrawField.tsx:21-36` — takes candidates surviving top-k/top-p, slices to
  `MAX = 14`, softmaxes over **those 14 only** (`z` sums `surv`). "holds 81% of
  the odds" is a share among 14 discs.
- `TemperatureDemo.tsx:22-26` — same shape, top 8 rows.
- `FlowSteps.tsx:195` — `pTop = top0[2]`, the engine's **true full-vocabulary**
  probability. This is the 64.9%/65% figure.

So the caption was the only honest number in the cluster, and cutting it would
have deleted the truth and kept the artefact. The disc *areas* are defensible
(relative sizing must normalize to something); the **language** is not — "holds
N% of the odds" and the sampling drawer's proof line ("the engine's probabilities
recomputed at each setting, not an illustration") both claim full-vocabulary
shares that are not being computed.

## Status (2026-08-10): all ten shipped, plus the layout track

Aaron asked for the layout findings to be folded in and the whole thing executed.
Both landed. Passes below are recorded as built; the layout track (L1/L2) was
added after the first walk could finally be SEEN — the earlier audit could not
judge the canvases because `requestAnimationFrame` never ticked in the audit
browser. Its two rulings are now laws 7 and 8 in `storyboard.md`.

- **L1 — the stage fits the window.** `.flow` gains `max-height`, `.fl-stage`
  scrolls internally with `min-height:0` + `justify-content: safe center`, hero
  clamps stop overshooting on short windows, and a `max-height: 780px` query
  takes height off padding and leading first. Was: nav off-screen on 6/7 steps at
  1280x720 (by up to 156px) and 4/7 at 1280x800. Now: 0/7, no page scroll, and
  the aside stays on screen on every step.
- **L2 — text tiers.** `--faint` was carrying words at 3.38:1 on the strength of
  WCAG's 3:1 GRAPHICS bar, which does not apply to text. Inside `.flow` the two
  grey tiers move up one step (`--dim` 6.30:1, `--faint` 4.67:1); `--red-text`
  and `--red-deep` added for red words and red-behind-words. Verified by sweeping
  95 text elements across every step and drawer: none below 4.5:1.

Still open, deliberately, and NOT silently fixed:

- **Step 4 now shows two true numbers** ("holds 100% of the odds" at temp 0, and
  the caption's "65% of the tickets"). Both are correct and they mean different
  things — the dial collapses to the argmax at temp 0; the caption is the model's
  raw confidence. Whether C survives rule 6 now that nothing contradicts is a
  copy call, flagged not taken.
- **The visual-grammar collision** (steps 1, 2 and 3 all draw dim dots in 2D with
  one red dot, meaning three different things) is a redesign, not a fix. Bucket B.
- **`EmbeddingRow` still says "layer"** in a step-1 drawer. Outside C1-C12, so
  left for a ruling rather than expanded into.
- **The q8 SpeedRace card** still reads "run it to measure" until both backends
  have been run; the badge now hides itself rather than the panel lying.

## The passes

Gate for every pass (from `design.md`, plus the engine gate for pass 4):
`tsc` strict · `npm run build` · `lib.test.ts` green · every flow step and wired
drawer still runs live · `cargo test --workspace --release` for pass 4.

### pass 0 — docs only (this file + the copy proposals)
Lands this plan, the two amendments above, and the PROPOSED copy block below.
No code. Aaron edits the proposed lines; passes 1-6 transplant whatever survives
his edit, verbatim.

### pass 1 — step 0 and step 1  (A3, A9, A6-i)
- **A3** `storyboard.md` step 0: the prompt box arrives pre-filled with the
  default prompt (text selected, so typing replaces it); `begin` is live on
  arrival and never renders disabled. Makes the existing C line true as written.
- **A9** `storyboard.md` step 1: the token row on step 1 and in its drawers
  shows the prompt's tokens only; the drawn token does not join the strip until
  step 4. The meaning drawer opens on the **last prompt token**, not the
  prediction.
- **A6-i** merges-drawer and meaning-drawer instrument strings into the addendum
  I-slot inventory (see PROPOSED C1-C5).

### pass 2 — step 2  (A4, A5, A8, A6-ii)
- **A5** `storyboard.md` step 2: the score drawer opens on the run's own layer
  and head and prints **no layer/head selectors** in the flow; arbitrary
  layer/head selection stays an expert-view affordance. (`layer` does not unlock
  until step 3; `head` not until the next drawer along.)
- **A4** head-attribution line drops `logit` (PROPOSED C6).
- **A8a** restore `D (score drawer) .proof` into its slot under `.do`. **Not
  blocked** — the sentence already exists in the script, it simply never reached
  the screen. Every other drawer states its proof in words.
- **A8b** per the displacement rule, the second explanatory paragraph ("the score
  compares two vectors…") comes off: it restates `.what`.
- **A6-ii** RoPE readout `θ`/`r` → plain words (PROPOSED C7).

### pass 3 — step 3  (A6-iii)
- RMSNorm's "channel" → the tour's own vocabulary (PROPOSED C8). One string;
  small pass, kept separate so the step-3 climb is re-verified on its own.

### pass 4 — step 4, the true odds  (A1)  ← the only engine pass
- **engine**: expose the exact share at an arbitrary temperature. The recorded
  candidates plus a requested `t` in, exact full-vocabulary probabilities out,
  computed against all 151,936 logits. Mirror it on the WASM binding so the
  static lab keeps working offline. Zero-dependency rule unaffected (std only).
- **client**: `DrawField` and `TemperatureDemo` stop renormalizing over `surv`.
  At the run's own temperature no call is made at all — the true `p` is already
  in the trace, so the default screen stays instant; the call is debounced and
  fires only while the dial is off the run's temperature.
- **test**: pin the endpoint to a direct full-vocab softmax at several
  temperatures, in the project's existing "worked demo equals the engine" habit.
- **copy**: once the numbers agree, the read line and C say the same thing about
  the same set. Whether C then survives rule 6 ("if C would restate H, cut C") is
  Aaron's call — flagged, not assumed. The sampling drawer's proof line becomes
  true as written and needs no edit.

### pass 5 — step 5 and the fork  (A7, A10)
- **A7** `storyboard.md`, the fork ruling: its point (1) already says the fork
  continues at least 6 tokens; extend it to **both sides** — `WorldsPair` runs
  the model's own world forward to the same token count as the forced world,
  using the continuation call the fork already makes. Today it is 7 tokens
  against 1, under copy that says "compare the two sentences token by token."
- **A10** a line beside "run it again" naming the restart as the loop
  (PROPOSED C9). Script gap: step 5 declares `A: none` and has no slot for it.

### pass 6 — the outro  (A2)
- `copy-script.md` takes ownership of the outro slots (amendment 2). The three
  "above"/"↑" sentences and two button labels become flow-true (PROPOSED
  C10-C12); the apologetic header line ("where it says 'above', it means the
  expert view") is **deleted**, not reworded.
- `storyboard.md` outro phase 6: the q8 SpeedRace card carries its measured
  figure on arrival, or the **MEASURED, NOT DESCRIBED** banner comes off that
  panel. As shipped, the one card promising a measurement reads "run it to
  measure."
- The chat CTA keeps carrying the moment-link (already correct per the
  2026-07-26 ruling); only its label loses the `↑`.

---

## PROPOSED copy — Aaron edits, CC does not ship these unedited

Per `copy-script.md`'s CC contract, CC flags gaps rather than authoring tour
copy. These are drafts to react to. Strike, rewrite, or approve.

**C1** merges, first frame: `"{word} · every character starts as its own piece."`
(drops "byte-level")
**C2** merges, a merge frame: `"{word} · merge {a} + {b} → {ab} · the {rank}th most common pair the tokenizer learned"`
(today: bare `rank 127`)
**C3** merges, finished word: `"{word} · done · {word} is entry {id} in the model's list"`
(today: a bare number, e.g. `785`)
**C4** merges strip, once: `"␣ marks a space."`
(the glyph is used throughout and never explained)
**C5** meaning drawer: `"showing the first 16 of 1024 numbers."`
(cuts `rms {x}` — undefined on a step-1 drawer)
**C6** head attribution: `"{tok}" — this head {a}, the layer's whole attention {b}, of its final score {logit}`
(today says "of the full {logit} logit"; `logit` is a step-4 term)
**C7** RoPE readout: `"pair {i} · angle {deg}° · length {len}"`
(today: `θ` / `r`)
**C8** RMSNorm: `"each of the 1,024 numbers re-scaled by its own learned weight"`
(today: "each channel…"; "channel" appears once in the whole tour)
**C9** step 5, beside "run it again": `"same five steps, one word longer."`
**C10** outro, chat template: `"A chat template formats the conversation into tokens with role markers. The markers <|im_start|> and <|im_end|> are ordinary vocabulary entries with their own token ids, drawn by the same step as any word."`
(drops "Turn on chat in the controls above" and "(You can see this now, in the instrument above.)")
**C11** outro button: `"try it: chat with the model"`
**C12** outro experiments: `"or run another experiment"`

Also for a ruling, not drafted here: the step-2 "component 60 rides rotation pair
60, turning once in ~2.6M tokens" sentence. The audit recommends cutting it from
the flow entirely rather than rewording it.

## Pitched alongside (approve or strike — none is an audit finding)

- A closing recap screen restating the five steps in one place before the outro.
- Label the Rust source panels inside beginner drawers as skippable.
- A note where candidate lists show `...`, `____` and blank-rendering tokens, so
  they read as real vocabulary entries rather than broken rows.
- State the `continue ↓` (next drawer) vs `continue →` (next step) distinction
  once, on first encounter.
- Call out the 巴黎 / 法国 / フランス neighbours as the teaching moment they are.
- Re-walk on a narrow viewport; the audit ran desktop-only at 1280×800.

## Known gap in the audit itself

`audit-fresh.md` could not judge the canvas heroes: `requestAnimationFrame` never
ticks in the audit browser, so every canvas rendered blank and screenshots were
unavailable. Nothing in this plan rests on the drawn graphics. A sighted re-walk
after pass 6 is worth scheduling — the visual half of the tour is still unaudited.
