import type { ReactNode } from "react";
import { edgesToWeights, headGlance, layerGlance, litToken, meanHeadWeights, moments, q, settledSeq, type Marker } from "../lib";
import type { FocusTarget, Step, Trace } from "../types";
import { BandHeader } from "./BandHeader";
import { DotStrip } from "./DotStrip";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import { RoleTag } from "./RoleTag";
import { useLens } from "./Geometry";

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
  setHover,
  focus,
  lensActive,
  card,
  dim,
}: {
  trace: Trace;
  step: Step;
  nPos: number;
  openLayer: number;
  setOpenLayer: (l: number) => void;
  setHover: (f: FocusTarget) => void;
  /** the effective focus, so an explained layer (attention/residual) lights its
   *  own row here, not only the arcs in band 01 */
  focus: FocusTarget;
  /** when the lens concept is open: show the per-layer top guess in the spine */
  lensActive: boolean;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
}) {
  const litLayer = focus.kind === "layer" ? focus.layer : null;
  const group = trace.heads / trace.kv_heads;
  const tokAt = (p: number) => q(trace.tokens[p]?.t ?? "");

  // the logit lens for this position, gated on the lens concept being open
  // (cached, so it shares the band's one fetch). Per layer: the top guess so
  // far; the layer where the final winner first leads is marked.
  const lens = useLens(nPos - 1, lensActive, settledSeq(trace));
  const finalWin = lens?.layers[lens.layers.length - 1]?.top[0]?.[0];
  const firstLead =
    lens && finalWin !== undefined ? lens.layers.findIndex((L) => L.top[0]?.[0] === finalWin) : -1;

  // curated moments for this token (decision only when the lens read is open)
  const markers = moments(trace, nPos - 1, lens);
  const byLayer = new Map<number, Marker>();
  for (const m of markers) if (m.layer !== undefined) byLayer.set(m.layer, m);
  const outputMarker = markers.find((m) => m.kind === "output");

  const detail = (l: number) =>
    step.attn[l] && (
      <div className="detail" key={`d${l}`}>
        <div className="label">
          layer {l}, its {trace.heads} heads. each head reads the sentence its own way; groups of{" "}
          {group} share one set of cached keys and values
        </div>
        <div className="stage-crumb">
          this layer's math: <Explain of="norm" label="normalize" /> →{" "}
          <Explain of="attention" label="attention" /> → <Explain of="feedforward" label="feed-forward" />
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
  for (let l = 0; l < trace.layers; l++) {
    const g = layerGlance(step, l, nPos);
    rows.push(
      <div
        key={l}
        className={"row" + (l === openLayer ? " open" : "") + (l === litLayer ? " lit" : "")}
        onClick={() => setOpenLayer(openLayer === l ? -1 : l)}
        onMouseEnter={() => setHover({ kind: "layer", layer: l })}
        onMouseLeave={() => setHover({ kind: "none" })}
      >
        <span className="lnum">{l}</span>
        <div className="row-dots" data-explain-el={"layer-dots-" + l}>
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
        {lens && lens.layers[l]?.top[0] && (
          <span
            className={"lens-mark" + (l === firstLead ? " leads" : "")}
            title={
              l === firstLead
                ? "the layer where the final winning token first leads"
                : `top guess if the model stopped at layer ${l}`
            }
          >
            {litToken(lens.layers[l].top[0][1]).text}
          </span>
        )}
        <span className="rn" title="how much information has built up by this layer (rms); it grows as the token moves down the stack">
          {step.rnorm[l]?.toFixed(1) ?? ""}
        </span>
      </div>,
    );
    const mk = byLayer.get(l);
    if (mk) {
      rows.push(
        <div className={"moment-row " + mk.kind} key={`m${l}`}>
          {mk.label}
        </div>,
      );
    }
    if (l === openLayer) rows.push(detail(l));
  }

  return (
    <section className={dim ? "dimmed" : undefined}>
      <BandHeader
        idx="02"
        title={<Explain of="attention">inside the {trace.layers} layers</Explain>}
        sub={SUB.layers}
      >
        <Explain of="embedding" label="embedding" />
        <Explain of="residual" label="residual" />
        <Explain of="kvcache" label="KV cache" />
        <RoleTag trace={trace} pos={nPos - 1} kind="prod" />
      </BandHeader>
      {card}
      {outputMarker && <div className="moment-output">{outputMarker.label}</div>}
      <div onMouseLeave={() => setHover({ kind: "none" })}>{rows}</div>
    </section>
  );
}
