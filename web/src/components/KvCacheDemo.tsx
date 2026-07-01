import { useAutoplay } from "../autoplay";
import { litToken, meanHeadWeights } from "../lib";
import { Stepper } from "./Stepper";
import type { ExplainCtx } from "./Explanations";

/* The KV cache, made visible. Trace-only: no engine change, no new fetch. Every
   producing pass already reads back over positions 0..prod (the attention
   arcs in TokenStrip/LayerStack) — that IS the cache being read. This view
   reframes the same numbers explicitly as "the cache": one column per cached
   position, per layer, filled up to the producing position, with the real
   mean-head attention weight from that read as the fill's brightness (the
   strongest read in red). Stepping the scrubber does not recompute anything;
   it just reveals more of the already-cached columns, left to right, standing
   in for "one more token generated, one more column appended." */

const CELL = 13;
const ROWS_SHOWN = 6; // a representative spread of layers, not all 28

export function KvCacheDemo({ ctx }: { ctx: ExplainCtx }) {
  const { trace, step, prod, layer } = ctx;
  const nPos = prod + 1; // cached positions at the producing pass: 0..prod
  const { i: shown, playing, setI, toggle } = useAutoplay(Math.max(nPos, 1), { stepMs: 140 });

  if (prod < 0) {
    return (
      <div className="kv-demo kv-status">
        The first token has no producing pass, so nothing is cached yet. Select a later token to
        watch its cache fill.
      </div>
    );
  }
  if (!step.attn.length) {
    return <div className="kv-demo kv-status">no attention recorded for this pass.</div>;
  }

  const nLayers = trace.layers;
  // a representative spread of layers (first, a few evenly spaced, last) — the
  // full 28 rows would just repeat the same shape
  const layerIdx =
    nLayers <= ROWS_SHOWN
      ? [...Array(nLayers).keys()]
      : [...new Set(
          Array.from({ length: ROWS_SHOWN }, (_, i) => Math.round((i * (nLayers - 1)) / (ROWS_SHOWN - 1))),
        )];
  if (!layerIdx.includes(layer)) layerIdx[layerIdx.length - 1] = layer;
  layerIdx.sort((a, b) => a - b);

  const at = Math.min(shown, nPos);
  const tokAt = (p: number) => litToken(trace.tokens[p]?.t ?? "").text;
  const kvHeads = trace.kv_heads;

  return (
    <div className="kv-demo">
      <div className="kv-title">
        the cache after this pass: {nPos} position{nPos === 1 ? "" : "s"} × {nLayers} layers ×{" "}
        {kvHeads} kv head{kvHeads === 1 ? "" : "s"}, one key and one value vector each
      </div>

      <div className="kv-rows">
        {layerIdx.map((l) => {
          const w = step.attn[l] ? meanHeadWeights(step, l, nPos) : new Array(nPos).fill(0);
          const max = Math.max(...w.slice(0, at), 1e-9);
          return (
            <div className={"kv-row" + (l === layer ? " on" : "")} key={l}>
              <span className="kv-lnum">L{l}</span>
              <div className="kv-cells" style={{ width: nPos * CELL }}>
                {Array.from({ length: nPos }, (_, p) => {
                  const filled = p < at;
                  const v = filled ? w[p] / max : 0;
                  const isTop = filled && w[p] === max && max > 1e-6;
                  return (
                    <div
                      key={p}
                      className={"kv-cell" + (filled ? " filled" : "") + (isTop ? " top" : "")}
                      style={filled ? { opacity: 0.22 + 0.78 * v } : undefined}
                      title={`position ${p} (${tokAt(p)})${filled ? ` · read weight ${(w[p] * 100).toFixed(0)}%` : " · not yet appended"}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Stepper i={at} max={nPos} playing={playing} setI={setI} toggle={toggle} unit="cached position" />

      <div className="kv-note">
        each filled cell is one earlier token's key and value, already sitting in the cache for this
        layer; brightness is how much this pass actually read from it (the same attention weights
        drawn as arcs above). Without the cache, producing this one token would repeat the key/value
        projections for every earlier token, at every layer, again.
      </div>
    </div>
  );
}
