# design-12 — the front door: curated experiments on step 0

## Goal

Step 0 is a cold start: an empty input and nothing to react to. Surface the
five curated experiments (experiments.ts — every claim engine-checked) as
quiet one-click chips under the prompt row, including the Japanese prompt
(こんにちは。私の名前は — byte-level BPE at its most striking, and the
Kana-Master mission tie-in). Clicking one runs it live and enters the flow at
step 1, with the experiment's short `hook` line framing the run.

## Honesty constraint

`watchFor` texts reference expert-view surfaces ("the layer stack", "the
induction marker") that the flow does not have — showing them here would
point at nothing. The flow uses each experiment's `hook` (short and
surface-agnostic) instead; the full watch-for framing stays in the expert
view where its referents live.

## In scope

- Step 0: an "or try:" row of experiment chips (title; hook as tooltip).
- `exp` state: set by launching an experiment (front door or finale), cleared
  by begin(); while set, step 1 shows `experiment · {title} — {hook}` as a
  quiet mark.

## Done when

- Each chip launches its real run (params included — the repetition trap's
  n=16, the coin flip's temp 0.8) and the flow walks it; the Japanese run's
  merges drawer shows bytes assembling into kana. Gate green.

## Commit

"lab: curated experiments on the flow's front door". Claude commits.
