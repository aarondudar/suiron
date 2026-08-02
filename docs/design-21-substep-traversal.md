# design-21 — drawers as sub-steps (the spine walks through the depth)

## The change (Aaron, 2026-07-20)

Drawers are too easy to skip: continue jumps step→step and a first-time
visitor can walk the whole flow without opening one. Drawers become full
SUB-STEPS: continue traverses step 2 → one score → 16 readers → word order →
step 3 → …, so the default path goes through the depth. The dock remains as
random access; the rail still jumps to bare steps; Esc/close still returns
to the step.

## Law amendment (docs/design.md)

The single-drawer rule is unchanged — one drawer open at a time, closing
returns to the step. What changes: the drawers are no longer OPTIONAL side
quests; they are the spine's own path, addressable both linearly (continue/
back/arrows) and randomly (dock handles, rail).

## Mechanics

- The linear path is derived per render: for each step 1–5, the bare step
  then its docked drawers in dock order ("two worlds" only while a fork is
  resident). back/continue/arrow keys walk this path; opening via continue
  applies the same per-drawer resets as a handle click.
- The footer meta names the sub-step while one is open ("2 / 5 · looks back
  · 16 readers").
- Continue hides only when the path is exhausted (step 5's last drawer);
  the finale stays opt-in via the end link.
- Demo mode: the frontier walk's drawers are all recorded, so the traversal
  works on the recording end to end.

## Done when

Continue from step 2 opens "one score", then "16 readers", then "word
order", then lands on step 3; back reverses exactly; rail/dock/Esc behavior
unchanged; deep links still restore step+drawer; gate green.

## Commit

"lab: drawers are sub-steps — continue walks through the depth". Claude
commits.
