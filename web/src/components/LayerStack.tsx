import { edgesToWeights, headGlance, layerGlance, meanHeadWeights, q } from "../lib";
import type { Step, Trace } from "../types";
import { BandHeader } from "./BandHeader";
import { DotStrip } from "./DotStrip";

const TAG_HELP: Record<string, string> = {
  local: "attending to nearby words — grammar and phrasing",
  focused: "locked onto one specific earlier word — retrieval",
  broad: "attention spread wide — gathering general context",
  sink: "parked on the first token — this layer found nothing it needed",
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
          layer {l} — its {trace.heads} heads, each reading the sentence its own way (kv group
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
        <span className="rn" title="residual stream strength after this layer (rms) — grows as layers add information">
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
        sub="where each layer looked back in the text — hover a row, click for its heads."
        explain={
          <>
            the token passes through every layer in turn; each looks back over earlier tokens
            (attention) and writes what it found into a running summary, the residual stream. the
            dots show <b>where that layer looked</b> — bigger = more attention, red = strongest;
            the “→ word %” names its favorite target. the number at right is the residual's
            strength (rms), growing bottom-to-top as each layer adds what it learned. patterns:
            <br />· <b>local</b> — nearby words: grammar at work, common early.
            <br />· <b>focused</b> — most attention on one earlier word: retrieval (watch
            pronouns find their nouns).
            <br />· <b>broad</b> — spread thin: gathering general context.
            <br />· <b>sink</b> — piled on the first token. normal: attention must sum to 100%,
            so a layer with nothing to fetch parks the leftover there — the model's "none of the
            above".
          </>
        }
      />
      <div onMouseLeave={() => setHoverLayer(null)}>{rows}</div>
    </section>
  );
}
