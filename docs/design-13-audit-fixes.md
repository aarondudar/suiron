# design-13 — expert-view audit fixes (presentation consistency)

## Goal

Fix the seven inconsistencies from the 2026-07-19 audit, approved by Aaron in
full. The law being enforced: red means the model's choice/attended — exactly
one thing; one vocabulary; one register; two-way navigation.

## The fixes

1. **Red = the model's choice only.** `.tok.cur` (the inspected token) moves
   from red to an ink emphasis (matching ForkDiff's `.fd-tok.cur` and the
   flow's inspect treatment). `src-top` / `cand-match` stay red — those mark
   real attention/candidacy.
2. **Vocabulary bridge.** Band headers carry their flow-step word as a quiet
   tag: 01 tokens · 02 looks back/sharpens · 03 sharpens · 04 sharpens ·
   05 draws one. `BandHeader` gains an optional `step` prop.
3. **Flow finale framing.** One line above the epilogue: where its copy says
   "above", it means the expert view (one click away).
4. **Seed-note register.** Lowercase, like every other line of instrument copy.
5. **Two-way nav.** The expert header gains a "guided view" link beside
   "about"/"share".
6. **The box reflects the resident run.** Both views prefill the prompt input
   once from `residentPrompt()` when they load over an existing run (never a
   chat-wrapped one, never clobbering typed text).
7. **Header spec wrap.** "N prompt + M generated" becomes non-breaking so the
   spec wraps between phrases, not inside one.

## Done when

Each fix verified live in both views; gate green; the audit re-run shows no
red on an inspected prompt token and a visible bridge tag on every band.

## Commit

"lab: expert audit fixes — one red, one register, two-way nav" +
"lab: step-vocabulary tags bridge the flow and expert views". Claude commits.
