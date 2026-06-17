import { edgesToWeights, headGlance, layerGlance, meanHeadWeights, q } from "../lib";
import type { Step, Trace } from "../types";
import { BandHeader } from "./BandHeader";
import { DotStrip } from "./DotStrip";
import { EXPLAIN, SUB } from "./Explanations";

const TAG_HELP: Record<string, string> = {
  local: "looking at nearby tokens, the grammar of the sentence",
  focused: "locked onto one specific earlier token",
  broad: "attention spread out across many tokens",
  sink: "parked on the first token, meaning it found nothing it needed",
};

export function LayerStack({
  trace,
  step,
  nPos,
  openLayer,
  setOpenLayer,
  setHoverLayer,
}: {
  trace: Trace;
  step: Step;
  nPos: number;
  openLayer: number;
  setOpenLayer: (l: number) => void;
  setHoverLayer: (l: number | null) => void;
}) {
  const group = trace.heads / trace.kv_heads;
  const tokAt = (p: number) => q(trace.tokens[p]?.t ?? "");

  const detail = (l: number) =>
    step.attn[l] && (
      <div className="detail" key={`d${l}`}>
        <div className="label">
          layer {l}, its {trace.heads} heads. each head reads the sentence its own way (kv group
          = head ÷ {group})
        </div>
        <div className="heads">
          {step.attn[l].map((edges, h) => {
            const g = headGlance(edges);
            return (
              <div className="head" key={h}>
                <div className="hl">
                  h{h}
                  {g && (
                    <span className={g.share > 0.5 ? "hl-target strong" : "hl-target"}>
                      {" "}
                      → {tokAt(g.topPos)} {(g.share * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <DotStrip weights={edgesToWeights(edges, nPos)} nPos={nPos} />
              </div>
            );
          })}
        </div>
      </div>
    );

  const rows = [];
  for (let l = trace.layers - 1; l >= 0; l--) {
    const g = layerGlance(step, l, nPos);
    rows.push(
      <div
        key={l}
        className={"row" + (l === openLayer ? " open" : "")}
        onClick={() => setOpenLayer(openLayer === l ? -1 : l)}
        onMouseEnter={() => setHoverLayer(l)}
        onMouseLeave={() => setHoverLayer(null)}
      >
        <span className="lnum">{l}</span>
        <div className="row-dots">
          <DotStrip weights={meanHeadWeights(step, l, nPos)} nPos={nPos} />
        </div>
        <span className="glance">
          {g && (
            <>
              → {tokAt(g.topPos)} {(g.share * 100).toFixed(0)}%
              {g.tag && (
                <span className="gtag" title={TAG_HELP[g.tag]}>
                  {g.tag}
                </span>
              )}
            </>
          )}
        </span>
        <span className="rn" title="how much information has built up by this layer (rms); it grows toward the top">
          {step.rnorm[l]?.toFixed(1) ?? ""}
        </span>
      </div>,
    );
    if (l === openLayer) rows.push(detail(l));
  }

  return (
    <section>
      <BandHeader
        idx="04"
        title={<>inside the {trace.layers} layers</>}
        sub={SUB.layers}
        explain={EXPLAIN.layers}
      />
      <div onMouseLeave={() => setHoverLayer(null)}>{rows}</div>
    </section>
  );
}
