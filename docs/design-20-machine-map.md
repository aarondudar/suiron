# design-20 — the machine, at a glance

## The flaw (Aaron, 2026-07-20)

The machinery appears before the machine: vectors show up without a why,
attention shows up before "the model is a stack of 28 identical layers" is
ever stated, and the dot products have no stated purpose. Structure must be
introduced at the moment it becomes necessary — the top of step 2 — not one
step later.

## The fix (no new step; the five-step vocabulary is untouched)

1. **Step 1 bridge**: one quiet line — each piece is looked up as a vector,
   the only thing the machine computes with. The meaning drawer lands on
   prepared ground.
2. **The machine map** (new flow component, live figures): `N vectors →
   [read → think] × 28 layers → 151,936 scores`, with a "you are here"
   emphasis. N and 28 from the trace; the vocab count is the same constant
   the embedding drawer already ships. Rendered on steps 2–4 with the marker
   moving: read (2) → the ×28 climb (3) → scores (4).
3. **Step 2 headline rewrite**: "each layer starts by looking back: every
   word's vector pulls in what it needs from the words before it" — attention
   is situated inside a layer, and the scores get their purpose before any
   drawer opens.

## Done when

The map renders live on 2–4 with the marker moving; step 1 carries the
bridge line; no numbers are canned; gate green.

## Commit

"lab: the machine map — structure before machinery". Claude commits.
