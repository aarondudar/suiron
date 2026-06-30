import { useState } from "react";
import { DotProduct } from "./DotProduct";
import { UnderHood } from "./UnderHood";
import type { ExplainCtx } from "./Explanations";

/* The attention concept's interactive: one shared layer/head control drives
   both the worked dot product and the woven code+values view, so the two always
   point at the same head. */
export function AttentionInteractive({ ctx }: { ctx: ExplainCtx }) {
  const nLayers = ctx.trace.layers;
  const nHeads = ctx.trace.heads;
  const [layer, setLayer] = useState(Math.min(ctx.layer, nLayers - 1));
  const [head, setHead] = useState(Math.min(3, nHeads - 1));
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

  return (
    <div className="attn-interactive">
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
      <DotProduct ctx={ctx} layer={layer} head={head} />
      <UnderHood ctx={ctx} stage="attention" layer={layer} head={head} />
    </div>
  );
}
