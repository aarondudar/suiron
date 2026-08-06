# storyboard — the stage directions, all of them, in order

## What this is

`copy-script.md` owns every word in the guided flow. This document owns
everything else you can SEE: what is on stage at each step, at what size, in
what order it appears, and, above all, what is NOT shown. Together the two
documents own the screen. CC composes to this storyboard; it does not invent
stage business. If a visual idea has no home here, that is a gap in this
storyboard — flag it, do not improvise it.

Why this exists: the copy transplant proved that governing the words is not
enough. Instruments, chrome, and docks each grew independently; every design
pass ADDED to the screen and none removed anything; the result is a stage where
everything performs at once. A lesson is the opposite of that: one performer,
everyone else in the wings.

## The law of the stage

1. **One hero per step.** Each step has exactly one hero element: the largest
   thing on screen, centered, and the only thing that animates on entry.
   Everything else is cast or chrome.
2. **The tiers.** hero (largest, center) → text slots (H above the hero, C
   directly under it, A below that) → cast (at most ONE supporting element,
   visually subordinate to the hero) → chrome (the step rail, the map strip,
   the dock handles: smallest, at the edges, never animated).
3. **The entrance order.** On step entry: H appears → one beat → the hero
   enters and plays its motion once → C fades in → A fades in → dock handles
   last. Under prefers-reduced-motion: everything at once, nothing plays.
   Nothing enters mid-step unprompted.
4. **The displacement rule.** Nothing is added to any step's stage without
   naming what it replaces or demotes. "It fits" is not a reason. This binds
   all future design passes; a plan that only adds is rejected by default.
5. **Silence between steps.** The transition clears the stage: the old hero
   exits before the new H appears. No element persists across steps except
   chrome.
6. **Instruments speak only script.** An instrument may render only the
   I-slot strings in `copy-script.md`. Everything else it currently prints is
   removed.

## The stage, step by step

### step 0 — begin
- hero: the sentence with the blank + the prompt box.
- cast: none. map: absent. dock: HIDDEN (no drawers exist here).
- chrome: the step rail only.
- entry: H, then the blank pulses once. The quietest screen in the app.

### step 1 — tokens
- hero: the text BREAKING into token chips (one motion: your words split
  apart into the pieces).
- cast: none. map: absent.
- chrome: rail; dock handles ("how pieces form", "the map of meaning") enter
  last.

### step 2 — looks back
- hero: the AttnSpace ring, pull-lines drawing once from '{cur_token}'.
- cast: THE MAP, first appearance. It gets its own intro beat, once: it draws
  itself left to right, then shrinks to the chrome tier, where it stays
  through step 4.
- chrome: rail; dock ("score one look", "16 readers", "word order").

### step 3 — sharpens
- hero: THE CLIMB (LensSpace), autoplaying once to the lock-on layer. This is
  the signature of the entire application; nothing else on this step moves.
- cast: the map, marker on the ×N rounds, relabeling "rounds" → "layers" at
  the moment the aside lands (per the script addendum).
- chrome: rail; dock ("kept steady", "reworked", "guess by depth").
- RULING: the "guess by depth" drawer (residual) docks the lens-depth module
  (the layer slider reading the guess at each depth). SignalField retires to
  the expert view; its copy never matched it.

### step 4 — draws one
- hero: the ticket bar + the draw landing.
- cast: the map, marker at "→ a guess".
- chrome: rail; dock ("bend the odds", "fork it", "the readout").

### step 5 — and again
- hero: the sentence, whole, with '{chosen}' joining it; "run it again" is
  the primary action.
- cast: none. The map completes and fades out here: the machine has been
  walked; retire the diagram.
- chrome: rail; dock ("why it's fast", "two worlds"). No "at scale" handle
  here (superseded — see outro, below): continue carries the reader straight
  past step 5's dock into the outro instead.
- (Aaron, 2026-07-24) the experiments are re-pitched under "run it again":
  "or try one of these experiments:" + the five curated buttons, same row as
  the front door's. The loop step is where a reader decides what to do next;
  the finale keeps its own pitch too.

### the outro — phases 6–7 (Aaron, 2026-07-26: "make it easier to reach from
the end of the guided tour")
- superseded ruling: the epilogue was originally a single finale screen
  reached by a text link off step 5 ("how this scales up"). It is now two
  stops on the SAME continue path as steps 1–5, immediately after step 5's
  last drawer, so the reader never dead-ends. The link is removed; continue is
  the one way in.
- rail: the five tour dots, a separator, then two HOLLOW dots for phases 6–7
  — visibly past the loop, but reachable exactly like any step dot.
- phase 6, "how it scales": hero is the epilogue's first half (the verified
  boundary, the measured f32/q8 SpeedRace panel, the six-entry glossary).
  entrance order applies (note fl-enter below).
- phase 7, "an agent": hero is the epilogue's second half (chat template,
  harness, the "model never runs a tool" line, the chat CTA, the experiments
  row) plus a closing "run it again" action — the tour's last action loops
  back into the machine, same as step 5's.
- entrance order (added 2026-07-26, this pass had been missed on ship): the
  outro note enters at H's beat, the epilogue half at hero's beat, the
  closing action (phase 7 only) at C's beat. Same tiered timing as steps 1–5.
- the SpeedRace panel is the one epilogue entry that PROVES itself rather
  than describing itself: it renders only in the flow's outro (module 06 in
  the expert view already shows the identical f32/q8 cards directly above
  the epilogue there, so the expert epilogue does not repeat them).

## Rulings on the open reports (from the copy-transplant session)

- **MachineMap**: kept, demoted to chrome, script-owned strings only, steps
  2–4, absent at 0–1, gone by 5. Its former step-1 appearance is removed; the
  gap design-20 identified is now covered by the meaning drawer plus the map's
  step-2 entrance beat.
- **The four orphan drawers** (meaning, rework/ffn, readout/unembed, two
  worlds): adopted; their copy is in the script addendum.
- **Homeless instrument text**: removed, or replaced by the addendum's I-slot
  strings. Zero ledger violations is the bar, including instruments and
  chrome.
- **Dock handles**: the addendum owns them, verbatim.
- **heads drawer .do**: "Hover a head" is fine on desktop; on touch the same
  line reads naturally for tap. No copy change.
- **rework drawer (built post-audit, Aaron's finish order)**: the drawer's
  element is the FIRING STRIP — the ffn's 3,072 gate activations folded into
  128 buckets (max |activation| per bucket), served by the engine
  (`gate_profile` on `/api/v1/inspect`), rendered silent above the woven
  source. Bright, tall columns are the filters that fire. This closes the gap
  between the adopted D.do ("Watch which of the 3,072 filters fire") and the
  screen.
- **fork drawer (Aaron, 2026-07-24: "not landing — appends to the prompt and
  skips the rest of the tour")**: three changes. (1) The fork continues for
  at least 6 tokens so the forced history visibly diverges instead of reading
  as a one-word append. (2) The two-worlds comparison renders INLINE in the
  fork drawer the moment the fork lands (shared `WorldsPair` component; the
  step-5 "two worlds" handle keeps using it, copy unchanged). (3) No more
  teleport to step 5: the view pins to the fork point (the engine preserves
  the model's candidates there, so the same buttons stay up and "picked"
  moves to the forced token — the model's original choice becomes clickable,
  a fork back), and the tour resumes from "fork it" via continue as normal.
- **forced-token honesty sweep (same session, Aaron: "ensure there are no
  other incorrect assertions within the copy")**: a forced token was never
  drawn, and its trace keeps the model's real shares but stamps the logits 0,
  so anything that softmaxed logits or said "drew" was false there. Fixed:
  step-4 C gains a forced variant ("no draw here, you forced X"); DrawField
  in forced mode sizes discs by the real shares, rings the forced token in
  INK (red stays the model's colour), retires the temp dial, and its honest
  line says nothing was drawn; the sampling drawer refuses with "you forced
  this token, so there was no draw to bend"; the fork tag reads "forced" not
  "picked"; LoopChain counts "+ N you forced" apart from drawn and ink-rings
  forced links; WorldsPair's other-world tag checks what the replaced token
  really was ("the model chose" / "you forced earlier" / "your prompt had").
  The sampling drawer's prompt-token stub also stops advising "run a step
  first" (a prompt position never gets a draw).
- **"new prompt" chrome (Aaron, 2026-07-24)**: a share-styled link button in
  the brand row, visible on every phase past the front door, jumps straight
  back to step 0 and focuses the prompt field — the reader can bail into a
  new prompt from anywhere in the tour without walking back.
- **view-switch links carry the moment (2026-07-26 nav audit)**: "expert
  view" (flow footer + outro note) and "guided view" (expert header) now
  build a deep link from the CURRENT run + inspected token via the existing
  link machinery, instead of a bare `?view=` switch. The two views are one
  lab; switching between them no longer discards the run.
- **the expert view adopts the tour's instruments (design-33, 2026-07-26,
  Aaron: "update the expert view to match the visuals from the guided
  tour")**: this storyboard governs the FLOW only, but the ruling is recorded
  here since it reuses these exact components. AttnSpace + LensSpace become
  band 02's hero (swapping on the lens read); HeadField pins to the open
  layer's detail via a new `fixedLayer` prop; DrawField hero above the
  selection table, including the forced-token branch. The expert view's own
  dense per-row/per-candidate readouts are kept below each — density is what
  "expert" means there. Skipped, deliberately: Geometry (already encodes
  MORE real quantities than the tour's meaning space), LoopChain (TokenStrip
  is denser and interactive), MachineMap (its highlight is step-bound; an
  un-anchored render in the expert lifecycle lead would fake a position).

## What this storyboard is NOT

It is not the visual-world (design-30) and not the sci-fi skin (design-31).
Both are downstream of this: the skin dresses THIS stage after the stage is
right, and the visual-world prototype competes with this stage only if its
act-3 go/no-go gate is passed. Neither runs before this lands.
