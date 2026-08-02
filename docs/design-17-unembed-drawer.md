# design-17 — "how a direction becomes scores" (draws one drawer 3)

## Goal

The bridge the flow hand-waves: sharpens ends with a direction, draws one
begins with percentages. `UnembedDemo` (re-homed unchanged) shows the actual
conversion — the final normalized vector dotted against each candidate's row
of the TIED embedding table, each dot product equal to the engine's logit.
The same matrix that read the words writes the guesses.

## The teachable moment

UnembedDemo already steps (it walks the dot products against the real top
candidates and checks each against the engine's logits). The framing line
carries the one fact worth keeping: in-table = out-table (tied embeddings),
which the meaning drawer (design-14) makes tangible — the row you looked up
on step 1 is the same table the score comes from on step 4.

## Done when

The drawer computes live at the current token's producing pass, the dot
products match the engine's logits on screen, and it works for any inspected
token. Gate green.

## Commit

"lab: unembed drawer — how a direction becomes scores". Claude commits.
