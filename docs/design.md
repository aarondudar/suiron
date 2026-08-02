# design — the guided flow is the app

## What this is

The architecture for the front end, and the anchor for every front-end pass. Read
it, and open `docs/prototype/core-loop.html` in a browser, before touching code.
The prototype is the target interaction; this doc is the law that governs it.

This supersedes any earlier "consolidate the dense layout" framing. The decision
is more decisive than consolidation: the app is rebuilt around a guided flow.

## The one idea

**The guided flow is the spine. Everything else is a drawer that opens over one
step at a time — and only ever one at a time. Closing a drawer returns the user to
exactly the step they were on.**

Amendment (design-21, Aaron 2026-07-20): drawers are SUB-STEPS, not optional
side quests — continue/back/arrows walk each step's drawers in dock order
before moving on, so the default path goes through the depth. The dock and the
rail remain random access; the one-at-a-time rule and close-returns-to-step
are unchanged. (design-20 adds the machine map on steps 2–4: structure stated
at the moment it becomes necessary, never a new step.)

That single-drawer rule is the whole fix. The old app's disease was simultaneity:
everything on screen at once, nothing held back, impossible to learn from. The cure
is not decoration or animation — it is pacing and restraint. One idea per screen,
the rest summoned deliberately and dismissed back to place. If two things are ever
competing for attention at once, the rule is broken.

## The spine (five steps = one prediction)

The flow walks one real prediction, one step per screen, in the causal order it
actually happens:

1. **tokens** — your words become the pieces the model reads.
2. **looks back** — to guess next, it reads back over everything so far.
3. **sharpens** — the guess resolves across the 28 layers. *This is the
   signature moment and it lives inline in the spine, not in a drawer* — it is the
   one thing that earns full real estate in the flow itself.
4. **draws one** — it samples a token from the distribution.
5. **loops** — the token joins the sentence and the whole thing runs again.

If a step is missing, misnamed, or out of order, fix it here first — everything
else hangs off this vocabulary.

## The drawers (your existing modules, re-homed)

Nothing built so far is thrown away. Every module becomes a drawer docked to the
step it explains, opened on demand, shown alone, dismissed back to the step. The
map:

| step | drawers that dock here |
|---|---|
| tokens | the BPE merge sequence |
| looks back | the worked dot product; attention heads; RoPE |
| sharpens | RMSNorm; the residual; (the logit lens is the inline signature here, not a drawer) |
| draws one | temperature / top-k / top-p; the fork |
| loops | the KV cache; the epilogue (as the finale) |

This ordering — the causal path of one prediction — is a better information
architecture than the old stacked bands, because it *is* the thing being taught.

## Faithful or nothing still governs

The prototype uses canned numbers because it is a UI mockup. **The real app does
not.** Every step and every drawer runs live against the engine on the user's own
prompt (canned/recorded data only in the demo / WASM fallback). The prototype is
the *shape and pacing* to match, never a data source. Copying its fake numbers
would quietly betray the project's core rule.

## Visual invariants (unchanged, do not break)

Monochrome ground + one red that means exactly one thing (the model's
choice/attended); Doto for figures only; `tabular-nums` on anything that updates;
honest geometry channels (radius = real value, angle = layout, red = winner);
`prefers-reduced-motion` respected, visible keyboard focus, AA contrast; no second
accent, no gradient-as-data. Motion is spent on the spine (step transitions, the
climb), never sprayed.

## Re-homing, not rebuilding (the contract that stops breakage)

The modules already work. A pass **re-homes** one into its drawer; it does not
rebuild it and does not change its engine calls, props, math, or the registry.
Presentation and composition only. Gate for every pass: `tsc` strict, build,
`lib.test.ts` all green, and every flow step + wired drawer still runs live.

## How to work

Use the **frontend-design skill**. Work **one step or one drawer per pass**, never
a global change. Screenshot after each change and compare to
`docs/prototype/core-loop.html` — a picture is worth 1000 tokens, and matching the
prototype's pacing is the target. Do not big-bang the whole app in one pass; that
recreates the breakage this rebuild exists to end.

## The expert view

The old everything-at-once stack is not deleted. It stays reachable (a toggle or
route) as an opt-in expert mode while the flow becomes the default. Whether it
survives long-term is deferred — build the flow first, decide later.

## Order

| # | plan | builds |
|---|------|--------|
| 01 | `design-01-guided-shell.md` | the spine + the single-drawer mechanism + one live proof drawer; old stack kept reachable |
| 02+ | one per module | re-home each drawer onto its step, live, behavior frozen |

`design-01` stands up the skeleton and proves the rhythm with one real drawer.
The re-homing passes are scoped after it, one module at a time.

## Out of scope (whole track)

No new engine work; `web/` composition only. No new palette, no second accent, no
component library. No change to module internals, props, the geometry math, or the
registry (see re-homing). No deleting the expert stack yet.
