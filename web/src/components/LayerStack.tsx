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
  const group = trace.heads / trace.kv_heads;

  const detail = (l: number) =>
    step.attn[l] && (
      <div className="detail" key={`d${l}`}>
        <div className="label">
          layer {l} — {trace.heads} heads (kv group = head ÷ {group})
        </div>
        <div className="heads">
          {step.attn[l].map((edges, h) => (
            <div className="head" key={h}>
              <div className="hl">
                h{h} · kv{Math.floor(h / group)}
              </div>
              <DotStrip weights={edgesToWeights(edges, nPos)} nPos={nPos} />
            </div>
          ))}
        </div>
      </div>
    );

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
    if (l === openLayer) rows.push(detail(l)); // expands in place, under its row
  }

  return (
    <section>
      <div className="label">
        <span className="idx">04</span>
        inside the {trace.layers} layers — where attention looked (mean of heads, red =
        strongest) · click a layer for its {trace.heads} heads
        <span className="note">
          {" "}— one row per transformer layer, last layer on top. each dot: how much this
          layer attended to that earlier position when processing the current token. the number
          at right is the residual stream's magnitude after the layer
        </span>
      </div>
      <div>{rows}</div>
    </section>
  );
}
