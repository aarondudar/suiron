import { useState } from "react";
import { edgesToWeights, headGlance, layerGlance, meanHeadWeights, q } from "../lib";
import type { Step, Trace } from "../types";
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
  const [help, setHelp] = useState(false);
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
        <DotStrip weights={meanHeadWeights(step, l, nPos)} nPos={nPos} />
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
      <div className="label">
        <span className="idx">04</span>
        inside the {trace.layers} layers — where attention looked, bottom to top
        <button className="expand" onClick={() => setHelp(!help)}>
          how to read this
        </button>
        <span className="note">
          {" "}— one row per transformer layer; the token passes through layer 0 first, layer{" "}
          {trace.layers - 1} last. hover a row to draw its reach over the sentence above;
          click for its individual heads.
        </span>
      </div>
      {help && (
        <div className="m-math how-to">
          each row is one layer of the network, and the dots show <b>where that layer looked</b>{" "}
          while processing the current token — bigger dot, more attention; red = strongest. the
          “→ word %” tells you its favorite target so you don't have to squint. patterns to
          spot:
          <br />· <b>local</b> — attending to adjacent words: grammar at work, common in early
          layers.
          <br />· <b>focused</b> — most attention on one earlier word: the layer retrieved
          something specific (watch for pronouns finding their nouns).
          <br />· <b>broad</b> — spread thin across the sentence: general context gathering.
          <br />· <b>sink</b> — piled on the very first token. this is real and normal:
          attention must sum to 100%, so when a layer has nothing useful to fetch, it parks
          the leftover on token 0. think of it as the model's “none of the above”.
          <br />
          the number on the right is the residual stream's strength (rms) after each layer —
          it grows from bottom to top as every layer writes what it learned into the token.
          hover any row and the arcs above show that layer's reach over your actual sentence.
        </div>
      )}
      <div onMouseLeave={() => setHoverLayer(null)}>{rows}</div>
    </section>
  );
}
