# audit-fresh — a cold walk of the guided tour

Walked 2026-08-10 against the live engine (`suiron lab` on :4117 + `npm run dev`
on :5173, real Qwen3-0.6B Q8_0 weights — not the recorded demo). Two full walks:
the default `The capital of France is`, then `My cat likes to`. Every deep-dive
opened on both.

**Two limits on this audit, stated up front.** (1) The heroes are `<canvas>`, and
in the audit browser `requestAnimationFrame` never ticks (the pane does not
composite), so every canvas rendered blank and screenshots were unavailable. I
verified this is an environment artifact and have therefore judged **nothing**
about the drawn graphics — no finding below is "the picture is empty." This is a
copy, structure, ordering, and interaction audit. (2) `docs/finish-line.md` does
not exist in the tree and never has (no git history for it); `docs/v2.md` records
that a previous audit session hit the same absence. I read storyboard, copy-script
(+ addendum), and design instead.

---

## 1. Verdict

A beginner can genuinely learn from this tour, and in two places — the BPE merge
stepper and the fork — they will learn something they could not have learned from
a diagram, because the thing is demonstrated on their own words rather than
asserted. But the tour keeps breaking its own rule that a word is introduced
before it is used: "logit," "layer," "head," "rank," "rms," and "channel" all
arrive as bare instrument text, and the one screen a learner most needs to trust
— step 4, the draw — shows the same token holding 100% and 65% of the odds at the
same moment. The spine copy is excellent and the discipline of the copy-script is
real; almost every failure below is text the instruments print *outside* that
script, plus one dead button on the very first screen.

---

## 2. Bucket A — broken or confusing, severity-ranked

### A1. Step 4 shows two (sometimes three) different odds for the same token, at once

**What I experienced.** On step 4 the instrument reads *"at temp 0.00, ' Paris'
holds 100% of the odds"* and, directly beneath it, *"' Paris' holds 65% of the
tickets · the draw landed on ' Paris'."* On the second walk it was starker:
*"' eat' holds 100% of the odds"* over *"' eat' holds 17% of the tickets."* I
dragged the temperature slider through its whole range looking for the number
that would reconcile them — 0.00→100%, 0.50→99%, 1.00→81%, 1.50→54% — and 65%
never appears at any temperature. Opening "bend the odds" puts a *third* Paris
figure on the same screen (100.0% in the drawer's own list, while the spine still
reads 54%).

**Why it breaks the goal.** This is the screen where the learner is asked to
believe the model is uncertain and draws from a weighted hat. Two numbers for the
same word, neither derivable from the other, is exactly the "two things competing
at once" that `design.md` calls the broken state. A learner cannot tell which
number is the model's real confidence, and the honest one (65%) looks like the
typo.

**Proposed edit.** `docs/copy-script.md`, step 4, the C slot. The instrument's
read line is I-slot text that is live-tied to the dial, so C is the redundant
one, and rule 6 ("Silence is a valid state") already licenses cutting it.

- current: `C (under the bar): "'{top}' holds {p_top} of the tickets · the draw landed on '{chosen}'"`
- replace with: `C (under the bar): "the draw landed on '{chosen}'"`

(If the ticket share must stay on the spine, then the DrawField read line and C
have to be computed from one source; as shipped they are not.)

### A2. The outro (steps 6–7) is written for the expert view and gives the tour-walker directions that do not exist

**What I experienced.** The first line of step 6 is *"written beside the full
instrument — where it says 'above', it means the expert view."* I had never
opened the expert view. Step 7 then says *"Turn on chat in the controls above…"*,
*"(You can see this now, in the instrument above.)"*, *"↑ try it: chat with the
model"* and *"or run another experiment ↑"*. There is no "above" in the tour.
Clicking the chat CTA navigated me out of the guided view entirely into a page
opening `qwen3 0.6b instruct · q8_0 · 28 layers · 16h/8kv`. Also on step 6: under
a banner reading **MEASURED, NOT DESCRIBED**, the f32 card shows `2.0 tok/s` and
the q8 card shows **"run it to measure"** — the one claim on the screen that
promises a measurement is the one with no number in it.

**Why it breaks the goal.** The last two screens of a beginner tour issue
instructions the beginner cannot follow, and the final call to action ejects them
into the expert instrument. The disclaimer line concedes the problem rather than
fixing it.

**Proposed edit.** `docs/copy-script.md` — this is a genuine *gap*: the script
explicitly disclaims the outro (`D (epilogue): copy lives with the epilogue
band`), and it is the only part of the tour with no slot ownership. Bring it
under the script with flow-side variants; the disclaimer line is then deleted,
not reworded. Concretely, in the flow the three "above" sentences become:

- `"A chat template formats the conversation into tokens with role markers. The markers <|im_start|> and <|im_end|> are ordinary vocabulary entries with their own token ids, drawn by the same step as any word."` (drop "Turn on chat in the controls above" and the "(You can see this now…)" parenthetical)
- button: `"try it: chat with the model"` (drop the `↑`)
- `"or run another experiment"` (drop the `↑`)

And `docs/storyboard.md`, the outro, phase 6: the q8 SpeedRace card must carry
its measured figure on arrival, or the **MEASURED, NOT DESCRIBED** banner comes
off that panel.

### A3. The first screen's button is dead, and the copy says it should not be

**What I experienced.** Step 0 says *"type a few words, or use this one"* with
`The capital of France is` sitting in the box. I read that as the prompt being
filled in, clicked **begin** — nothing. Pressed Enter — nothing. The grey text is
a placeholder and `begin` is `disabled` until you type. There is no error, no
hint, no focus jump. My only way forward was to type the sentence that was
already displayed in front of me.

**Why it breaks the goal.** It is the first interaction in the product and it
fails silently on the path the copy recommends. A learner who does not guess
"placeholder vs value" never starts the tour at all.

**Proposed edit.** `docs/storyboard.md`, `### step 0 — begin`, hero line. Add:
`the prompt box arrives pre-filled with the default prompt (text selected, so
typing replaces it); `begin` is live on arrival and never renders disabled.`
This keeps the C line "type a few words, or use this one" true as written.

### A4. "logit" is used at step 2 and step 3, and defined at step 4

**What I experienced.** In step 2's first drawer, the attribution block reads
*"'␣Paris' — this head +0.006, the layer's whole attention +0.035, of the full
17.40 logit."* I had no idea what a logit was. Step 3 then names "the logit lens."
Only at step 4's "the readout" was I finally told: *"Each comparison is one
number, a logit."*

**Why it breaks the goal.** The copy-script's ledger puts `logit` at **step 4,
drawer-only**, and rule 1 is "Introduce before use… This applies to H, C, A, D,
button labels, and drawer titles." The step-2 attribution line is a straight
ledger violation, two steps early.

**Proposed edit.** `docs/copy-script.md`, addendum I-slot inventory, the step-2
head-attribution strings:

- current: `"{tok}" — this head {a}, the layer's whole attention {b}, of the full {logit} logit`
- replace with: `"{tok}" — this head {a}, the layer's whole attention {b}, of its final score {logit}`

### A5. "layer" and "head" spinners sit on top of step 2's first drawer, before either word exists

**What I experienced.** Opening "score one look" — the *first* deep-dive of step 2
— the first controls are two number fields, `layer 14` (0–27) and `head 3` (0–15).
Nothing had told me what a layer was (that is step 3's aside) or what a head was
(that is the *next* drawer along, "16 readers"). I did not know what those numbers
meant, whether 14 and 3 were special, or whether I was supposed to change them.

**Why it breaks the goal.** `layer` unlocks on the step-3 spine per the ledger;
putting a control labelled "layer" on a step-2 drawer breaks introduce-before-use,
and gives the learner two dials whose only honest use requires knowledge the tour
has not handed over yet.

**Proposed edit.** `docs/storyboard.md`, `### step 2 — looks back`. Add to the
dock ruling: `the score drawer opens on the run's own layer and head and prints
no layer/head selectors in the flow — arbitrary layer/head selection is an expert
view affordance.` (Composition-only; the module keeps its props.)

### A6. Instrument text across the drawers introduces terms the script never defines

**What I experienced**, in order of meeting them:

- step 1 merges: *"byte-level: every character starts as its own piece"* — what is byte-level? — and *"merge h + e → he · rank 127"* — what is a rank? — and the finished words print bare numbers (`785`, `6722`) that are never named as token ids.
- the `␣` glyph is used throughout (`␣capital`, `merge ␣ + c`) and never once explained as "a space."
- step 1 meaning drawer: *"showing the first 16 of 1024 numbers, rms 0.026"*.
- step 2 RoPE: *"pair 0 · θ 286° · r 1.23"* — Greek letters, unglossed, while the caption below explains the same thing in words.
- step 3 RMSNorm: *"each channel re-scaled by its learned weight"* — "channel" appears once in the whole tour, for the thing called "numbers," "components," and "dimensions" elsewhere.
- step 2, after finishing the 128-step stepper: *"component 60 rides rotation pair 60, turning once in ~2.6M tokens — position barely touches it; it carries content."* I read that three times and gave up.

**Why it breaks the goal.** The storyboard's own bar is *"Zero ledger violations
is the bar, including instruments and chrome,"* and law 6 is *"Instruments speak
only script."* None of the strings above are in the addendum's I-slot inventory.
Individually small; together they are the texture of the whole tour, and they are
what makes a beginner feel the tour is not actually for them.

**Proposed edit.** `docs/copy-script.md`, addendum, I-slot inventory — add the
merges/norm/RoPE strings and set them in ledger-legal words:

- `"{word} · every character starts as its own piece."` (drop "byte-level")
- `"{word} · merge {a} + {b} → {ab} · the {rank}th most common pair the tokenizer learned"`
- `"{word} · done · {word} is entry {id} in the model's list"` (replaces the bare id)
- add once, under the merges strip: `"␣ marks a space."`
- `"showing the first 16 of 1024 numbers."` (cut `rms {x}` from the step-1 drawer)
- `"pair {i} · angle {deg}° · length {len}"` (replaces `θ` / `r`)
- `"each of the 1,024 numbers re-scaled by its own learned weight"` (replaces "channel")
- cut the "rides rotation pair … carries content" sentence from the flow.

*(Already known and parked: `docs/v2.md` notes the front-door tooltips surface
"attention" at step 0, before its step-2 row. I hit it too; it is on the same
list as the above and awaiting the same call.)*

### A7. "Compare the two sentences token by token" — but one side has one token

**What I experienced.** I forked " the" instead of " Paris" and got the best
moment in the tour: THIS WORLD ran on to *"the city of Paris. The capital."* Then
I looked left. THE OTHER WORLD read `The capital of France is` + `␣Paris` and
stopped. Seven tokens against one. The step-5 "two worlds" drawer repeats the
same view and says *"Compare the two sentences token by token."*

**Why it breaks the goal.** The whole claim is *"Both futures ran through the
same engine… only the draw differed"* — and the screen shows one future that ran
and one that did not. The proof is undercut by the layout at the exact moment it
should land.

**Proposed edit.** `docs/storyboard.md`, Rulings, the fork drawer ruling. Its
point (1) already says "The fork continues for at least 6 tokens" — extend it to
both sides: `WorldsPair runs the model's own world forward to the same token
count as the forced world, using the same continuation call the fork already
makes, so "token by token" has two sides to compare.`

### A8. The step-2 score drawer is the longest thing in the tour, and the one drawer whose scripted proof line is not on screen

**What I experienced.** "Score one look" delivered, in one scroll: an intro
paragraph; a second paragraph restating the same idea in different words ("each
is 128 numbers long — its 'components'"); layer/head spinners (A5); a formula
`score = ( q · k ) / √128`; a 128-step stepper; a softmax/value section; a
5-step stepper; the attribution block (A4); and 28 lines of Rust. This is where I
lost patience on both walks. Counting: vector, query, key, scale, softmax, value,
head, projection, logit — nine new ideas in one drawer.

Separately: the script's `D (score drawer) .proof` reads *"Your sum, scaled, is
{score} — the engine's own number for this pair, to the digit."* That sentence is
**not on screen**. Every other drawer states its proof in words right under `.do`;
this one substitutes instrument prose, and the actual agreement (`Σ q·k = 72.566 ÷
√128 = 6.414 engine score 6.414 · matches`) only appears after you drive the
stepper to 128 — which most readers will never do.

**Why it breaks the goal.** The strongest guarantee in the project — *this equals
the engine's own number* — is the one the learner is least likely to see, and the
drawer's length buries it.

**Proposed edit.** `docs/copy-script.md`, step 2, `D (score drawer)`: restore the
`.proof` line verbatim into its slot under `.do`, as every other drawer does. And
`docs/storyboard.md`, step 2: name what the score drawer *displaces* — per the
displacement rule, the second explanatory paragraph ("the score compares two
vectors…") is a restatement of `.what` and should come off the screen.

### A9. Step 1 shows the model's prediction before the learner knows a prediction happened

**What I experienced.** In step 1's "map of meaning," the token row is `The
capital of France is` **` Paris`** — and ` Paris` is the *default* selection, so
the panel opens on *"the starting vector for '␣Paris'."* I typed four words; a
fifth appeared and the tour was already inspecting it. On the second walk, `My cat
likes to` grew ` eat` the same way. Nothing on step 1 says the model has guessed
anything yet — that is step 4.

**Why it breaks the goal.** It quietly spoils the payoff the whole tour is
building toward, and for a beginner it reads as "where did that word come from?"
at the exact moment they are being told the strip is *"exactly what the model
sees."*

**Proposed edit.** `docs/storyboard.md`, `### step 1 — tokens`. Add: `the token
row on step 1 and in its drawers shows the prompt's tokens only; the drawn token
does not join the strip until step 4. The meaning drawer opens on the last prompt
token.`

### A10. Step 5 is called "loops" and, by default, nothing loops

**What I experienced.** On the clean walk, step 5 said *"4 of your tokens + 1
drawn"* — the tour generates one token, so the "loop" is a loop that ran once.
The H promises *"the whole thing runs again."* I pressed "run it again" and was
dropped back on step 1 with `My cat likes to eat` — which *is* the loop, and is
rather good, but nothing says so; it just looks like the tour restarted and lost
my place.

**Why it breaks the goal.** The closing idea of the tour ("that is all a language
model does") is asserted on a screen that shows a single pass, and the one action
that demonstrates it is unlabelled.

**Proposed edit.** `docs/copy-script.md`, step 5 — a gap: there is no slot for a
line under the primary action (the step declares `A: none`). Add one line beside
"run it again": `"same five steps, one word longer."`

---

## 3. If only five things could be fixed

1. **A1** — the contradictory odds on step 4. One deletion, and it removes the
   only place where the tour visibly disagrees with itself about a real number.
2. **A3** — the dead `begin` button. It is the first click in the product.
3. **A2** — the outro's "above"/"↑" directions, written for a view the tour
   reader is not in, ending in a CTA that ejects them.
4. **A4 + A6** — introduce-before-use, enforced on instrument text. "logit" at
   step 2, plus rank / byte-level / ␣ / rms / θ / channel. This is one pass over
   the I-slot inventory and it lifts the register of the entire tour.
5. **A8** — restore the score drawer's `.proof` line and cut the duplicated
   paragraph. The best guarantee in the project should not be 128 clicks away.

---

## 4. Bucket B — would-design-differently

- A closing recap screen that restates the five steps in one place.
- Rust source panels inside beginner drawers, unlabelled as skippable.
- The five curated experiments do not say what makes each interesting before you run it.
- The 128-step and 1,024-step steppers as the default way to reach a payoff.
- Candidate lists containing tokens that render as blanks, `...`, and `____` with no note that these are real vocabulary entries.
- The `continue ↓` (next drawer) vs `continue →` (next step) distinction is never stated.
- The 巴黎 / 法国 / フランス neighbours are a teaching moment the copy walks past.
- A "what you now know" checkpoint between the sharpen step and the draw step.
- Narrow-viewport and touch behaviour (not exercised in this walk).
- Sonification or narration for the climb.

---

## 5. The one thing this tour does best

**The fork.** I clicked " the" — a 2.6% candidate the model did not choose — and
the engine continued from my edit for real: *"the city of Paris. The capital."*
The model still got to Paris, by another road. That single interaction does
something no diagram and no paragraph can: it proves the model is *continuing*
rather than reciting a stored answer, it proves the tour is running a live engine
rather than replaying a recording, and it makes the learner the cause of the
divergence. Everything else in the tour explains next-token prediction; the fork
is the only place where the learner *tests* it and gets a truthful answer back.
That is the moment it clicked, and it is worth protecting — which is exactly why
A7 (the one-token other world) is worth fixing rather than leaving.
