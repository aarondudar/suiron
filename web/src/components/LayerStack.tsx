import { edgesToWeights, meanHeadWeights } from "../lib";
import type { Step, Trace } from "../types";
import { DotStrip } from "./DotStrip";

export function LayerStack({
  trace,
  step,
  nPos,
  openLayer,
  setOpenLayer,
}: {
  trace: Trace;
  step: Step;
  nPos: number;
  openLayer: number;
  setOpenLayer: (l: number) => void;
}) {
  const rows = [];
  for (let l = trace.layers - 1; l >= 0; l--) {
    rows.push(
      <div
        key={l}
        className={"row" + (l === openLayer ? " open" : "")}
        onClick={() => setOpenLayer(openLayer === l ? -1 : l)}
      >
        <span className="lnum">{l}</span>
        <DotStrip weights={meanHeadWeights(step, l, nPos)} nPos={nPos} />
        <span className="rn">{step.rnorm[l]?.toFixed(1) ?? ""}</span>
      </div>,
    );
  }

  const group = trace.heads / trace.kv_heads;

  return (
    <section>
      <div className="label">
        <span className="idx">02</span>
        layer stack — where attention looked (mean of heads, red = strongest) · click a layer for heads
        <span className="note">
          {" "}— 28 rows, one per transformer layer, layer 27 on top. each dot: how much this
          layer attended to that earlier position when processing the current token. the number
          at right is the residual stream's magnitude after the layer
        </span>
      </div>
      <div>{rows}</div>
      {openLayer >= 0 && step.attn[openLayer] && (
        <div className="detail">
          <div className="label">
            layer {openLayer} — {trace.heads} heads (kv group = head ÷ {group})
          </div>
          <div className="heads">
            {step.attn[openLayer].map((edges, h) => (
              <div className="head" key={h}>
                <div className="hl">
                  h{h} · kv{Math.floor(h / group)}
                </div>
                <DotStrip weights={edgesToWeights(edges, nPos)} nPos={nPos} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
