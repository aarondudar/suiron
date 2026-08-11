import { useState } from "react";
import { DotProduct } from "./DotProduct";
import { UnderHood } from "./UnderHood";
import type { ExplainCtx } from "./Explanations";

/* The attention concept's interactive: one shared layer/head control drives
   both the worked dot product and the woven code+values view, so the two always
   point at the same head. */
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
      <DotProduct ctx={ctx} layer={layer} head={head} onScore={onScore} />
      <UnderHood ctx={ctx} stage="attention" layer={layer} head={head} />
    </div>
  );
}
