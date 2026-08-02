# design-02 — re-home the BPE merge sequence onto "tokens"

## Goal

Turn the first stub live: the "watch the text become tokens" drawer on step 1
(**tokens**) becomes the existing merge-timeline module, running on the user's
real prompt. This is the first re-homing pass and the template for all the
rest: the module moves into its drawer **unchanged** — same component, same
props, same engine call — and only the flow-side wiring is new. It is
deliberately the smallest pass in the track; if the recipe feels heavier than
~20 lines of wiring, something is being rebuilt that shouldn't be.

**Read first:** `docs/design.md` (the law — single drawer, live or nothing),
and `docs/design-01-guided-shell.md` for the shell this docks into.

## The critical rule (do not violate)

`TokenizeDemo` already runs live over `/api/v1/merges` and already proves its
output against the engine (the flattened merge results ARE the prompt's token
ids). Re-homing must not touch its internals, its `ExplainCtx` prop, its
fetch, or its styles. If the drawer needs different behavior, the answer is
flow-side composition or copy — never an edit inside the module.

## In scope

- **Wire the drawer**: in `Flow.tsx`, the `merges` dive on step 1 renders
  `<TokenizeDemo ctx={flowCtx} />` instead of the stub (exactly the pattern
  the `dot` drawer set on "looks back").
- **One framing line above the module** (flow-side copy, new element): the
  drawer explains how *your typed words* became pieces. After "run it again"
  the sentence also contains tokens the model *drew* — those never went
  through the byte-pair walk, and `/api/v1/merges` correctly covers the
  prompt only. One quiet sentence keeps that honest instead of confusing:
  e.g. *"your prompt, piece by piece — generated tokens were drawn whole, so
  they never merged."*
- **The agreement check, stated where the user is**: the step-1 chips and the
  drawer's final pieces are the same token ids. Verify it visually in the
  pass (the module already shows ids; the chips carry ids in their titles).

## Out of scope (do not)

- No edits to `TokenizeDemo`, `getMerges`, `useAutoplay`, `Stepper`, or their
  CSS (`tok-*`). No new palette, accent, or motion.
- No other drawers, no multi-drawer dive rows (that arrives with the
  "looks back" pass, which will dock three).
- No engine work. `/api/v1/merges` already exists and is already correct.
- Do not "improve" the drawer into a second tokens lesson — the step teaches,
  the drawer deepens. If copy grows past a sentence or two, cut it.

## Files (confirm against the tree)

- `web/src/components/Flow.tsx` — swap the stub for the module in
  `drawerBody`; add the framing line. This should be the whole diff, ±CSS:
- `web/src/styles.css` — only if the framing line needs a class that
  `.fl-stub` / `.fl-note` don't already cover (it probably doesn't).
- reuse as-is: `web/src/components/TokenizeDemo.tsx`, `getMerges` in
  `web/src/api.ts`.

## Build sequence

1. Wire `merges` → `TokenizeDemo` in the drawer body; verify it loads live on
   a fresh prompt (chips on the step, timeline in the drawer, same ids).
2. Add the framing line; verify the post-"run it again" case reads honestly
   (grown sentence on the step, prompt-only walk in the drawer).
3. Full gate: `tsc`, build, tests, walkthrough, screenshots (drawer open,
   desktop + mobile), expert view untouched.

## Done when

- Opening "watch the text become tokens" on step 1 walks the real prompt's
  byte-pair merges — the same timeline the expert view shows — and its final
  pieces match the step's chips (same ids, spot-checked).
- The drawer opens over the step, closes back to it, one at a time — the
  design-01 mechanism, unchanged.
- After "run it again", the drawer still shows the prompt-only walk with the
  framing line making that explicit.
- `TokenizeDemo` and its styles have a zero-line diff.
- `tsc` strict, build, `lib.test.ts` green; screenshots at desktop + mobile.

## Pitched alongside (optional — approve or strike each line)

Small comprehension/usability items that fit this pass without widening it.
Each is independent; strike freely:

1. **`.gitattributes` with `* text=auto`** (repo root, own commit) — pins
   LF-in-repo policy and permanently silences the CRLF warnings on Windows.
2. **An "about" affordance on flow step 0** — one faint line under the prompt
   row ("a from-scratch inference engine — every number here is computed
   live") linking to the expert view's welcome. New users landing on the flow
   currently get no statement of what suiron is or that nothing is mocked —
   the project's strongest claim, invisible on its default screen.
3. **Token ids visible in the step-1 chips on hover/focus** — the chips
   already carry `title="id … · pos …"`; surfacing the id as a tiny
   superscript on hover (CSS only) would let the "same ids" agreement between
   step and drawer be *seen* rather than trusted.
4. **Rail dots gain step-name tooltips** — they have `aria-label`s already;
   adding `title` makes the five-step shape discoverable by mouse before
   clicking.

## Commit

Stage it: "lab: re-home the merge timeline as the tokens drawer (live)".
Pitched items that survive review land as their own small commits ("lab:
about line on the flow's first step", "chore: .gitattributes", …).
User commits.
