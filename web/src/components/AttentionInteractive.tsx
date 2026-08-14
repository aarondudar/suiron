import { useState } from "react";
import { DotProduct } from "./DotProduct";
import { UnderHood } from "./UnderHood";
import type { ExplainCtx } from "./Explanations";

/* The attention concept's interactive: one shared layer/head control drives
   both the worked dot product and the woven code+values view, so the two always
   point at the same head. */
/** the three ideas this drawer holds, in the order the arithmetic happens */
const PARTS = [
  { id: "score", label: "the score" },
  { id: "blend", label: "the blend" },
  { id: "source", label: "the source" },
] as const;
type Part = (typeof PARTS)[number]["id"];

export function AttentionInteractive({
  ctx,
  flow,
  onScore,
}: {
  ctx: ExplainCtx;
  /** inside the guided tour (design-34). Two things come off the screen there:
   *  the layer/head spinners, because "layer" does not unlock until step 3 and
   *  "head" not until the next drawer along — a step-2 reader cannot use them;
   *  and the intro note, which restates the drawer's own D.what. The expert
   *  view keeps both. */
  flow?: boolean;
  onScore?: (engineScore: number | undefined) => void;
}) {
  const nLayers = ctx.trace.layers;
  const nHeads = ctx.trace.heads;
  const [layer, setLayer] = useState(Math.min(ctx.layer, nLayers - 1));
  const [head, setHead] = useState(Math.min(3, nHeads - 1));
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  /* one idea at a time, inside the drawer (design-35 track C). This drawer stacked
     four sections and ran to 3.4 screens, where its sibling reads at 1.3 — and the
     mechanism to fix that already existed: the sampling drawer shows one dial at a
     time, with the comment "three stacked demos would bury the idea". Same
     segmented control, same law, one level down. The expert view keeps the stack. */
  const [part, setPart] = useState<Part>("score");

  return (
    <div className="attn-interactive">
      {!flow && (
        <div className="fl-drawer-note">
          the score compares two vectors: this word's <b>query</b> (what it's looking for) and an
          earlier word's <b>key</b> (what it offers). each is {ctx.trace.head_dim} numbers long —
          its "components." multiply the two lists component by component, add them up, and that
          sum (scaled) is the score. a big product at a component means the two words agree
          strongly on that feature.
        </div>
      )}
      {!flow && (
      <div className="attn-controls">
        <label className="uh-sel">
          layer{" "}
          <input
            type="number"
            min={0}
            max={nLayers - 1}
            value={layer}
            onChange={(e) => setLayer(clamp(+e.target.value, nLayers - 1))}
          />
        </label>
        <label className="uh-sel">
          head{" "}
          <input
            type="number"
            min={0}
            max={nHeads - 1}
            value={head}
            onChange={(e) => setHead(clamp(+e.target.value, nHeads - 1))}
          />
        </label>
      </div>
      )}
      {flow && (
        <div className="seg fl-knob-seg">
          {PARTS.map((p) => (
            <button
              key={p.id}
              className={"seg-opt" + (part === p.id ? " on" : "")}
              onClick={() => setPart(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {(!flow || part !== "source") && (
        <DotProduct
          ctx={ctx}
          layer={layer}
          head={head}
          flow={flow}
          part={flow ? (part as "score" | "blend") : undefined}
          onScore={onScore}
        />
      )}
      {(!flow || part === "source") && (
        <UnderHood ctx={ctx} stage="attention" layer={layer} head={head} />
      )}
    </div>
  );
}
