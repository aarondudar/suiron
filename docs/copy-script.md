# copy-script — the tour's words, all of them, in order

## What this is

The single source of truth for every sentence in the guided flow. The words ARE
the design: this document owns them, Aaron edits them here, and CC transplants
them verbatim into the named slots. CC does not write, reword, expand, or
reposition tour copy. If a needed sentence is missing, that is a gap in this
script — flag it, do not improvise it.

Why this exists: copy written locally, component by component, produced forward
references, register drift, and screens that say too much. The cure is one
document with a hierarchy (where text may live), a ledger (when a word may first
appear), and the script itself (what the text says).

## The hierarchy — four slots, four jobs, four registers

Every piece of text in the flow lives in exactly one of these slots. A screen may
use each slot at most once (D repeats inside a drawer's own structure). If a
sentence does not fit a slot, it does not ship.

- **H — the headline.** One sentence. The single idea of this step, stated so a
  person with zero background gets it. Warm, plain, may address the reader.
  Nothing technical that the ledger has not unlocked. Largest text on screen.
- **C — the caption.** One short line under the live element. Its only job is to
  point: tell the reader what they are looking at right now, using this run's
  real values. Never explains mechanism, never introduces a term. Small, dim.
- **A — the aside.** At most one per step, and only when this step must
  introduce a new term. One or two sentences: name the term, define it in plain
  words, tie it to what is on screen. This is the ONLY slot allowed to introduce
  vocabulary. Visually subordinate to H (smaller, dimmer, below the element).
- **D — drawer copy.** Inside a deep-dive only. Fixed three-part shape:
  **what** (one or two sentences: what this drawer shows, in ledger-legal terms),
  **do** (one line: the action to take), **proof** (one line: what the result
  demonstrates, citing the live agreement with the engine where one exists).
  Drawers may go one ledger row deeper than the spine (see ledger), because the
  reader opted in.

Register summary: H teaches, C points, A defines, D demonstrates.

## The rules

1. **Introduce before use.** No word appears anywhere before its ledger row.
   This applies to H, C, A, D, button labels, and drawer titles.
2. **One new concept per step, maximum.** If a step needs two new terms, the
   step is overloaded — split it or push one term into a drawer.
3. **The spine stays plain.** H and C never contain a term the reader could not
   have met yet. Depth vocabulary lives in drawers.
4. **Every number shown is live.** Copy refers to values via slots like {top},
   {p}, {n_ctx}; components fill them from the real run. No hardcoded example
   values in shipped copy (faithful or nothing applies to words too).
5. **No em-dashes. Canonical terms only** (token, vocabulary, attention, query,
   key, layer, probability, temperature, sample, cache). Sentence case,
   textbook-clear; second person only for actions ("drag the slider"), third
   person for mechanism ("the model scores every token").
6. **Silence is a valid state.** Not every element needs a caption. If C would
   restate H, cut C.

## The concept ledger

A term may first appear at its step, in the listed slot. Before that step, use
the plain-language stand-in. Drawers at a step may also use terms from that
step's "drawer-only" row.

| step | spine unlocks (slot) | drawer-only unlocks | plain stand-in before unlock |
|---|---|---|---|
| 0 begin | model, guess / predict | — | — |
| 1 tokens | token (A), vocabulary (A) | byte pair, merge, rank, token id | "pieces", "the list of pieces it knows" |
| 2 looks back | attention (A) | vector, query, key, dot product, score, head | "looks back", "how much it listens to each earlier word" |
| 3 sharpens | layer (A) | logit lens, normalize / RMSNorm, residual | "rounds of the same arithmetic", "its guess so far" |
| 4 draws one | probability (A), temperature (C/A) | top-k, top-p, distribution, seed, logit | "how sure it is", "the odds" |
| 5 loops | (none new on spine) | cache / KV cache, context window | "remembers its work" |

Notes: "logit lens" is a drawer-only term; the spine calls it "its guess so far,
read out early." "Embedding" is not used anywhere in the tour spine or drawers;
the unembed drawer says "the model's own list of token directions" (revisit if an
embed drawer ships). The epilogue (after step 5) may use any ledger term, since
everything is introduced by then.

## The script

Slot values marked {like_this} are filled live by the component. Copy is final
unless Aaron edits it here.

### step 0 — begin

- H: "A language model does one thing: it guesses the next word. Let's watch one
  guess happen, from the inside, one step at a time."
- C (under the prompt box): "type a few words, or use this one"
- A: none.
- button: "begin"

### step 1 — your words become tokens

- H: "First, your words are broken into the pieces the model actually reads."
- C (under the token chips): "{n_tokens} tokens · this is exactly what the model
  sees"
- A: "Each piece is called a token. The model knows a fixed list of
  {vocab_size} of them, its vocabulary, and every token has a number in that
  list."
- drawer button: "watch the text become tokens"
- D.what: "The tokenizer builds tokens by merging, over and over, the pair of
  neighbouring pieces it has seen together most often. These are the real merges
  for your text, in the real order."
- D.do: "Step through the merges."
- D.proof: "The pieces you end on are exactly the tokens the model reads. Same
  ids, same order, checked against the engine."

### step 2 — it looks back

- H: "To guess what comes next, the model looks back over everything written so
  far, and it does not look at every word equally."
- C (under the ring): "reading from '{cur_token}' · the stronger the pull, the
  harder it looks"
- A: "This looking back is called attention. It is the only part of the whole
  process where words exchange information."
- drawer buttons: "watch one look get scored" · "see all 16 ways it looks"
  (heads drawer) · "how it knows word order" (RoPE drawer)
- D (score drawer) .what: "How hard to look is a single number, and here is the
  arithmetic that makes it. Each token carries a list of numbers called a
  vector. The current token asks with one vector, the query; each earlier token
  answers with another, the key. Multiply them piece by piece, add it up, and
  that is the score."
- D (score drawer) .do: "Step the multiply-and-add to the end."
- D (score drawer) .proof: "Your sum, scaled, is {score} — the engine's own
  number for this pair, to the digit."
- D (heads) .what: "The model looks back 16 different ways at once. Each is
  called a head, and each learns its own habit: some watch the previous word,
  some hunt for repeats, some track grammar."
- D (heads) .do: "Hover a head to see where it looks in your sentence."
- D (heads) .proof: "These weights are read from the run, not drawn for effect."
- D (RoPE) .what: "Word order matters: 'dog bites man' is not 'man bites dog'.
  Before the scores are made, each query and key is rotated by an angle that
  depends on its position, so the same word asks a different question from a
  different place."
- D (RoPE) .do: "Slide the position and watch the rotation."
- D (RoPE) .proof: "The rotated values match the engine's, which is how it
  knows where each word sits."

### step 3 — the guess sharpens

- H: "The model does not decide all at once. Its guess sharpens across
  {n_layers} rounds of the same arithmetic, and you can watch it happen."
- C (under the climb): "its guess so far: '{lens_top}' · it locks on at layer
  {lock_layer}" ({lock_layer} is the decision layer already derived in lib.ts
  moments(); {lens_top} is the lens top-1 at the shown depth, which the
  instrument must expose to the caption)
- A: "Each round is called a layer. A layer does two things: it looks back over
  the earlier words, the attention you just watched, then it reworks each token
  on its own and hands the result to the next layer." (amended 2026-07-24: the
  earlier line claimed both moves had been seen when the rework drawer comes
  after this step, and never said what the moves were)
- inline element: the climb (the signature; plays once, replayable).
- drawer buttons: "how a layer keeps the numbers sane" (RMSNorm) · "why early
  guesses exist at all" (residual)
- D (RMSNorm) .what: "Twenty-eight rounds of arithmetic would blow the numbers
  up or shrink them to nothing. Before each move, the layer rescales the token's
  vector to a steady size. That rescaling is called RMSNorm."
- D (RMSNorm) .do: "Watch one real vector get rescaled."
- D (RMSNorm) .proof: "The rescaled values equal the engine's, and the size
  after is the same at every layer."
- D (residual) .what: "Each layer does not replace the token's vector, it adds
  to it. The running total is called the residual, and because it exists, you
  can stop at any layer and read out what the model would guess so far. That
  readout is the climb you just watched; its formal name is the logit lens."
- D (residual) .do: "Drag the layer slider and read the guess at each depth."
- D (residual) .proof: "At the last layer the readout equals the model's real
  answer exactly. That is the test that keeps this honest."

### step 4 — it draws one

- H: "The model does not pick a word. It gives every token a probability, and
  then it draws, like pulling a ticket from a weighted hat."
- C (under the bar): "'{top}' holds {p_top} of the tickets · the draw landed on
  '{chosen}'"
- A: "A probability is just the share of tickets. A setting called temperature
  reshapes the shares: low and the favourite almost always wins, high and the
  long shots get a real chance."
- drawer buttons: "bend the odds" (sampling) · "take the road not taken" (fork)
- D (sampling) .what: "Three dials shape the draw. Temperature sharpens or
  flattens the shares. Top-k throws away all but the k likeliest tickets. Top-p
  keeps just enough tickets to cover a share p."
- D (sampling) .do: "Drag each dial and watch the odds redraw, live."
- D (sampling) .proof: "These are the engine's probabilities recomputed at each
  setting, not an illustration."
- D (fork) .what: "The draw could have landed elsewhere. Pick any candidate the
  model did not choose and make history go that way instead; the model continues
  for real from there."
- D (fork) .do: "Click a grey candidate."
- D (fork) .proof: "Both futures ran through the same engine. At the fork the
  odds were identical; only the draw differed."

### step 5 — and again

- H: "The drawn token joins the sentence, and the whole thing runs again. That
  is all a language model does, one token at a time, for every word it has ever
  written."
- C (under the sentence): "'{chosen}' appended · {n_ctx} tokens now in play"
- A: none (nothing new; let the loop land).
- buttons: "run it again" (primary) · drawer: "why the loop is fast" (cache) ·
  "how this scales up" (epilogue, the finale)
- D (cache) .what: "Each pass, only the newest token is new; everything the
  model worked out about the earlier ones is kept in a cache and reused. That is
  why the loop does not slow down as the sentence grows."
- D (cache) .do: "Step a token and watch one column get added, not recomputed."
- D (cache) .proof: "The cached values are the ones the engine reads on the
  next pass."
- D (epilogue): copy lives with the epilogue band and its verified/described
  boundary; it may use the full ledger. Unchanged by this script except: it may
  not run before step 5.

## The CC contract

- Transplant this copy **verbatim** into the named slots. No rewording, no
  additions, no repositioning between slots.
- Wire every {slot} to the live value it names. If a live value does not exist
  for a slot, STOP and flag it (do not hardcode an example).
- If a screen has text today that has no home in this script, remove it (list
  what was removed in the report).
- If a slot's copy does not fit the layout, report it; Aaron edits the script,
  not CC.
- The hierarchy is visual too: H largest, C small and dim under its element, A
  subordinate below, D inside drawers only. One H, max one A per step.

## addendum — adopted drawers, instrument text, the map, the handles

This addendum has the same authority as the script above. It adopts the four
drawers that had no home, brings instrument-printed text and the machine map
under the ledger, and owns the dock handle labels.

### ledger amendments

- "vector" moves to step 1, drawer-only (the meaning drawer needs it; the step 1
  spine still says "a point on the model's map of meaning").
- step 4 drawer-only adds: softmax, unembed / "the readout".
- "cosine similarity" is drawer-only at step 1 (meaning drawer fine print only).

### the four adopted drawers

step 1 · meaning drawer ("the map of meaning")
- D.what: "Each token is looked up as a vector, a long list of numbers that
  places it on the model's map of meaning. Nearby points mean similar things."
- D.do: "Pick a token and see its closest neighbours on that map."
- D.proof: "These neighbours are computed from the model's own numbers, not a
  thesaurus."

step 3 · rework drawer (feed-forward)
- D.what: "After looking back, each token is reworked on its own: its vector is
  expanded, filtered, and compressed back. Unlike looking back, this step moves
  nothing between words."
- D.do: "Watch which of the 3,072 filters fire for this token."
- D.proof: "The activations shown are read from the run."

step 4 · readout drawer (unembed)
- D.what: "The final vector is compared against every token the model knows.
  Each comparison is one number, a logit; softmax turns the whole list into
  probabilities."
- D.do: "Scrub the list and watch scores become shares."
- D.proof: "The shares equal the engine's, and they sum to 1."

step 5 · two worlds drawer
- D.what: "You forked history earlier, or can now. Here both futures sit side
  by side: same model, same odds at the fork, different draw."
- D.do: "Compare the two sentences token by token."
- D.proof: "Both ran through the same engine; the divergence is only the draw."

### instrument text (I-slots)

Instruments may print ONLY the strings listed here or in the script. Any other
instrument-rendered prose, axis label, or term is removed.

- TokenSpace (step 1): labels use "closeness in meaning". The term "cosine
  similarity" may appear only inside the meaning drawer's fine print.
- LensSpace (step 3): the spine label is "its guess so far". The words "logit
  lens" may appear only inside the depth drawer.
- AttnSpace (step 2): pull-lines carry no text; the caption C does the talking.
- rework firing strip (step 3 drawer): silent — no printed text; hover
  tooltips carry the real bucket values ("filters a–b · peak |activation| x").
- step 1 experiment mark (adopted): "experiment · {title} · {hook}" — the
  curated experiment's framing line, shown only when one is running.

### the machine map (script-owned strings)

- Appears on steps 2–4 only, as the smallest chrome tier, one line, marker
  moving: looks back (2) → the ×N rounds (3) → the guess (4).
- Step 2 text: "{n_tokens} pieces → look back → rework · ×{n_layers} rounds → a
  guess"
- Step 3+: the word "rounds" relabels itself to "layers" at the moment step 3's
  aside introduces the term (the map visibly learns the word with the reader).
- The words "vectors" and "scores" never appear on the map. It is absent on
  steps 0–1 and gone by step 5.

### dock handles (short, ledger-legal, exact)

- step 1: "how pieces form" · "the map of meaning"
- step 2: "score one look" · "16 readers" · "word order"
- step 3: "kept steady" · "reworked" · "guess by depth"
- step 4: "bend the odds" · "fork it" · "the readout"
- step 5: "why it's fast" · "two worlds" · "at scale"

The long drawer-button phrases in the script above serve as each drawer's TITLE
once open; the handles above are the dock labels on the spine.
