# design-04 — re-home the KV cache onto "loops"

## Goal

Turn the "the cache that makes the loop fast" stub on step 5 (**loops**) live:
`KvCacheDemo`, unchanged, over the current producing pass. The step teaches
"it runs again"; the drawer shows why running again is cheap — everything read
so far is already cached.

**Read first:** `docs/design.md`; the recipe is design-02/03's.

## The critical rule

`KvCacheDemo` is trace-only (no fetch, no engine change) and already takes the
full `ExplainCtx`. Zero-line diff. Feed it `flowCtx` exactly as the registry
does (`interactive: (c) => <KvCacheDemo ctx={c} />`).

## In scope

- `cache` drawer → `<KvCacheDemo ctx={flowCtx} />` behind one framing line
  tying it to the step's claim (e.g. "why running it again is cheap: every
  earlier token's keys and values are already sitting here").
- Verify the drawer's dimensions line states the real run (positions × layers
  × kv heads) and matches the trace.

## Out of scope

- No edits to `KvCacheDemo` / `kv-*` CSS. The epilogue finale is design-07's.

## Done when

- The drawer opens on step 5 with the real cache grid for the current pass;
  scrubbing reveals cached columns; brightness/red match the recorded
  attention. Close returns to step 5. Zero-line module diff. Gate green
  (tsc/build/tests + screenshots desktop/mobile).

## Pitched alongside (optional — approve or strike each line)

1. **A quiet loop counter on step 5** — "the loop so far: N of your tokens +
   M drawn" under the sentence; the step currently gives no sense of
   accumulation as you run it again repeatedly.
2. **Busy label on "run it again"** — while generating it sits disabled but
   unchanged; swapping the label to "↻ running…" makes the wait legible.

## Commit

"lab: kv-cache drawer live on loops" (+ pitches separately). Claude commits.
