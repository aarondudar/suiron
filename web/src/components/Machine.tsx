import { useEffect, useState } from "react";
import { q } from "../lib";
import { BandHeader } from "./BandHeader";
import { EngineSource } from "./EngineSource";
import { MACHINE, SUB, type MachineCtx } from "./Explanations";
import type { Trace } from "../types";

/* "the machine": one token's journey through the actual computation.
   Each stage card: plain language always visible; [math] = real numbers
   from an on-demand deep inspection; [code] = the engine's real source. */

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
const headStr = (v?: VecStat) =>
  v ? `[${v.head.map(f).join(", ")} …×${v.len}]` : "…";

function Expand({
  kind,
  open,
  onClick,
}: {
  kind: "math" | "code";
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button className={"expand" + (open ? " on" : "")} onClick={onClick}>
      {kind}
    </button>
  );
}

function Card({
  title,
  plain,
  math,
  code,
}: {
  title: string;
  plain: React.ReactNode;
  math?: React.ReactNode;
  code?: string;
}) {
  const [showMath, setShowMath] = useState(false);
  const [showCode, setShowCode] = useState(false);
  return (
    <div className="m-card">
      <div className="m-head">
        <span className="m-title">{title}</span>
        {math && <Expand kind="math" open={showMath} onClick={() => setShowMath(!showMath)} />}
        {code && <Expand kind="code" open={showCode} onClick={() => setShowCode(!showCode)} />}
      </div>
      <div className="m-plain">{plain}</div>
      {showMath && math && <div className="m-math">{math}</div>}
      {showCode && code && <EngineSource fn={code} />}
    </div>
  );
}

export function Machine({
  trace,
  cur,
  busy,
}: {
  trace: Trace;
  cur: number;
  busy: boolean;
}) {
  const [layer, setLayer] = useState(Math.floor(trace.layers / 2));
  const [head, setHead] = useState(3);
  const [data, setData] = useState<Inspect | null>(null);
  const [loading, setLoading] = useState(false);

  // deep inspection is lazy: fetched when this band's position/layer change
  useEffect(() => {
    if (busy) return;
    setLoading(true);
    fetch(`/api/v1/inspect?pos=${cur}&layer=${layer}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cur, layer, busy, trace.seq]);

  const tokText = q(trace.tokens[cur]?.t ?? "");
  const mc: MachineCtx = {
    nTokens: trace.tokens.length,
    cur,
    tokText,
    tokId: trace.tokens[cur]?.id,
    layer,
  };
  const h = data?.heads[head];
  const topAttn = h
    ? h.weights
        .map((w, p) => [p, w, h.scores[p]] as [number, number, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <section>
      <BandHeader
        idx="05"
        title={<>the machine · token {cur} ({tokText})</>}
        sub={SUB.machine}
      >
        <span className="m-sel">
          layer{" "}
          <input
            type="number"
            min={0}
            max={trace.layers - 1}
            value={layer}
            onChange={(e) => setLayer(Math.min(trace.layers - 1, Math.max(0, +e.target.value)))}
          />
          {loading && <span className="m-loading"> recomputing…</span>}
        </span>
      </BandHeader>

      <Card title={MACHINE.tokenize.title} plain={MACHINE.tokenize.plain(mc)} code="forward" />

      <Card
        title={MACHINE.meaning.title}
        plain={MACHINE.meaning.plain(mc)}
        math={
          data && (
            <>
              entering layer {layer}: x = {headStr(data.x_in)}
              <br />
              overall size (rms) <b>{f(data.x_in?.rms ?? 0)}</b>, range [{f(data.x_in?.min ?? 0)},{" "}
              {f(data.x_in?.max ?? 0)}]. the rms grows with the layer number as the model gathers
              information.
            </>
          )
        }
        code="embedding"
      />

      <Card
        title={MACHINE.normalize.title}
        plain={MACHINE.normalize.plain(mc)}
        math={
          data && (
            <>
              rms = √(mean(x²) + ε) = <b>{f(data.x_in?.rms ?? 0)}</b>
              <br />
              x / rms · weights = {headStr(data.attn_norm)} (new rms ≈{" "}
              {f(data.attn_norm?.rms ?? 0)})
            </>
          )
        }
        code="rmsnorm"
      />

      <Card
        title={MACHINE.attention.title}
        plain={MACHINE.attention.plain(mc)}
        math={
          data &&
          h && (
            <>
              <span className="m-row">
                head{" "}
                <input
                  type="number"
                  min={0}
                  max={trace.heads - 1}
                  value={head}
                  onChange={(e) =>
                    setHead(Math.min(trace.heads - 1, Math.max(0, +e.target.value)))
                  }
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
                        {p}: {q(trace.tokens[p]?.t ?? "")}
                      </td>
                      <td>{f(s)}</td>
                      <td>{(w * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              blended output for this head flows into attn_out = {headStr(data.attn_out)}
            </>
          )
        }
        code="attention"
      />

      <Card
        title={MACHINE.feedforward.title}
        plain={MACHINE.feedforward.plain(mc)}
        math={
          data && (
            <>
              gate = {headStr(data.gate)}
              <br />
              silu(gate) · up = {headStr(data.gate_act)}
              <br />
              compressed back down = {headStr(data.down)}
              <br />
              residual stream leaving layer {layer}: rms <b>{f(data.x_out?.rms ?? 0)}</b>
            </>
          )
        }
        code="ffn"
      />

      <Card title={MACHINE.score.title} plain={MACHINE.score.plain(mc)} code="matmul" />
    </section>
  );
}
