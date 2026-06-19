import { useEffect, useState } from "react";
import { q } from "../lib";
import type { ExplainCtx } from "./Explanations";

/* This token's real per-stage arithmetic, fetched on demand from
   /api/v1/inspect. Extracted from the old band-05 "machine" cards so the full
   math (with the layer and head selectors) survives the move into the Explainer
   drawer. Click-gated by the rung, so it makes no engine call until opened. */

interface VecStat {
  head: number[];
  len: number;
  rms: number;
  min: number;
  max: number;
}
interface Inspect {
  pos: number;
  layer: number;
  token: { id: number; t: string };
  x_in?: VecStat;
  attn_norm?: VecStat;
  q?: VecStat;
  k?: VecStat;
  v?: VecStat;
  attn_out?: VecStat;
  gate?: VecStat;
  up?: VecStat;
  gate_act?: VecStat;
  down?: VecStat;
  x_out?: VecStat;
  heads: { scores: number[]; weights: number[] }[];
}

const f = (x: number) => x.toFixed(3);
const headStr = (v?: VecStat) => (v ? `[${v.head.map(f).join(", ")} …×${v.len}]` : "…");

export type Stage = "embedding" | "attention" | "feedforward";

export function StageMath({ ctx, stage }: { ctx: ExplainCtx; stage: Stage }) {
  const nLayers = ctx.trace.layers;
  const nHeads = ctx.trace.heads;
  const [layer, setLayer] = useState(ctx.layer);
  const [head, setHead] = useState(3);
  const [data, setData] = useState<Inspect | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/inspect?pos=${ctx.cur}&layer=${layer}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ctx.cur, layer]);

  const layerSel = (
    <span className="m-row">
      layer{" "}
      <input
        type="number"
        min={0}
        max={nLayers - 1}
        value={layer}
        onChange={(e) => setLayer(Math.min(nLayers - 1, Math.max(0, +e.target.value)))}
      />
      {loading && <span className="m-loading"> recomputing…</span>}
    </span>
  );

  if (!data) {
    return (
      <div className="m-math">
        {layerSel}
        <br />
        loading this token's numbers…
      </div>
    );
  }

  const h = data.heads[head];
  const topAttn = h
    ? h.weights
        .map((w, p) => [p, w, h.scores[p]] as [number, number, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <div className="m-math">
      {layerSel}
      <br />
      {stage === "embedding" && (
        <>
          entering layer {layer}: x = {headStr(data.x_in)}
          <br />
          overall size (rms) <b>{f(data.x_in?.rms ?? 0)}</b>, range [{f(data.x_in?.min ?? 0)},{" "}
          {f(data.x_in?.max ?? 0)}]. the rms grows with the layer number as the model gathers
          information.
        </>
      )}

      {stage === "attention" && (
        <>
          normalized first (rmsnorm): x / rms · weights = {headStr(data.attn_norm)}
          <br />
          <span className="m-row">
            head{" "}
            <input
              type="number"
              min={0}
              max={nHeads - 1}
              value={head}
              onChange={(e) => setHead(Math.min(nHeads - 1, Math.max(0, +e.target.value)))}
            />{" "}
            · q = {headStr(data.q)}
          </span>
          <table className="m-table">
            <thead>
              <tr>
                <th>looks at</th>
                <th>score = q·k/√128</th>
                <th>after softmax</th>
              </tr>
            </thead>
            <tbody>
              {topAttn.map(([p, w, s]) => (
                <tr key={p} className={w === topAttn[0][1] ? "strong" : undefined}>
                  <td>
                    {p}: {q(ctx.trace.tokens[p]?.t ?? "")}
                  </td>
                  <td>{f(s)}</td>
                  <td>{(w * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          blended output for this head flows into attn_out = {headStr(data.attn_out)}
        </>
      )}

      {stage === "feedforward" && (
        <>
          gate = {headStr(data.gate)}
          <br />
          silu(gate) · up = {headStr(data.gate_act)}
          <br />
          compressed back down = {headStr(data.down)}
          <br />
          residual stream leaving layer {layer}: rms <b>{f(data.x_out?.rms ?? 0)}</b>
        </>
      )}
    </div>
  );
}
