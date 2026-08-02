# design-10 — every flow moment is a URL

## Goal

Extend deep links (docs/20) to the guided flow: prompt + params + inspected
token + step + open drawer, all in the hash. Any moment — "the climb where
'.' takes the lead at layer 26", "the fork options for ' city'" — becomes a
link that rebuilds itself live in someone else's browser. Old links carry no
`view` field and keep routing to the expert stack, so nothing shared before
today breaks.

## Design

- **Codec (additive)**: `LinkState` gains `view?: "flow"`, `step?` (phase
  0–6), `d?` (open drawer id); `cur` is reused for the inspected token.
  `currentLink` gains an optional `flow` view field. Old encode/decode paths
  byte-identical; a round-trip test covers the new fields.
- **Routing**: hash links with `view=flow` land on the flow; all other hash
  links land on the expert stack (unchanged behavior).
- **Restore** (flow-side, mirroring App's): if the resident run already
  matches, apply the view; otherwise re-run the link's prompt at its fixed
  seed once and apply the view to whatever settles (engine truth wins).
  Forked runs restore as their unforced re-run — same one-level honesty as
  the expert view's links.
- **Write-back**: the hash mirrors the current moment (debounced
  replaceState), and a quiet `share` button in the flow header copies it.
- **Mechanism fix surfaced by this pass**: "changing step closes the drawer"
  moves from an effect on `phase` into the nav handlers themselves —
  otherwise restoring `step+drawer` together is impossible (the effect would
  immediately close the restored drawer). Same invariant, expressed where it
  belongs.

## Done when

- Share on any step/drawer → open the URL in a fresh tab → the engine re-runs
  the prompt and the exact moment reassembles (step, inspected token, open
  drawer). Old expert links still route to the expert view. Codec tests green.

## Commit

"lab: flow deep links — share any moment". Claude commits.
