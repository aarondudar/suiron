# design-07 — the fork on "draws one" + the epilogue as the finale

## Goal

The last two map entries. (1) A "what if it had picked differently?" drawer on
step 4: the real alternative candidates, one click forces one via the existing
`fork` API, and the flow lands on **loops** so the changed sentence is the
payoff. (2) The epilogue becomes an optional sixth beat — a finale screen
reached from step 5 — not a drawer: it reads as an ending, and that is what
it is.

## Decisions (approved by Aaron: "go with your leans")

- The fork **is** in the guided flow; the post-fork landing is step 5.
- The epilogue is a **finale screen** (phase 6), opt-in from step 5, rendered
  by the unchanged `Epilogue` module inside a no-op `ExplainerProvider` (its
  `<Explain>` anchors need the context; the flow has no concept cards, so the
  anchors quietly do nothing here).
- `onRun` (the epilogue's experiments) runs LIVE in the flow: set the prompt,
  `generate`, land on step 1 — the finale loops the learner back into the
  spine with a curated prompt. `onTryChat` routes to the expert view, where
  chat lives.

## In scope

- `DIVES[4]` += fork. Drawer body: top candidates from the producing step
  (the same numbers as step 4's bar), the picked one marked and disabled,
  click → `fork(cur, id, params)` → close drawer → `setPhase(5)`.
- Step 5, after a fork: one quiet line — the road not taken
  (`trace.fork.prev`, truncated) — so the counterfactual stays visible.
- Phase 6 (the end): `<Epilogue>` unchanged, flow-side handlers as above; a
  quiet "→ the end" link on step 5; back returns to 5; rail shows all-reached.

## Out of scope

- No `Epilogue`/`ForkDiff` edits; no chat in the flow; the full ForkDiff
  comparison band stays expert-only (the flow shows the one-line payoff).

## Done when

- Forcing a candidate really re-runs the engine (the sentence changes, the
  road-not-taken line shows the discarded tail), landing on loops.
- The finale renders the unchanged epilogue; its experiment buttons start a
  real run and drop you on step 1; zero-line module diffs; gate green.

## Commit

"lab: fork drawer live on draws-one", "lab: epilogue finale ends the flow".
Claude commits.
