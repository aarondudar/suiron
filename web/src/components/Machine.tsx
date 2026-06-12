import { useEffect, useState } from "react";
import { q } from "../lib";
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

/* Hand-rolled Rust highlighter — ~40 lines, monochrome layers only (red
   stays reserved for the model's choices). Good enough for our own engine
   source, which is the only thing it ever renders. */
const RUST_TOKEN =
  /(\/\/.*)|("(?:[^"\\]|\\.)*")|\b(pub|fn|let|mut|for|in|if|else|return|match|loop|while|use|struct|impl|enum|const|break|continue|as|where|self|Self)\b|\b(f16|f32|f64|u8|u16|u32|u64|usize|i8|i16|i32|i64|bool|str|Vec|Option|Some|None|String|KvCache|Model|Observer)\b|(\b\d[\d_]*(?:\.\d+)?(?:e-?\d+)?\b)/g;

const TOKEN_CLASS = ["c-comment", "c-str", "c-kw", "c-type", "c-num"];

function highlight(line: string, key: number) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(RUST_TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    const group = m.slice(1).findIndex((g) => g !== undefined);
    out.push(
      <span key={`${key}-${i}`} className={TOKEN_CLASS[group]}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out.length ? out : " ";
}

function Code({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/v1/source?fn=${name}`)
      .then((r) => (r.ok ? r.text() : "// source unavailable — restart the lab (make dev)"))
      .then((t) =>
        setSrc(t.startsWith("<") ? "// stale backend — restart the lab (make dev)" : t),
      );
  }, [name]);
  if (src === null) return <pre className="code">loading…</pre>;
  return (
    <pre className="code">
      {src.split("\n").map((line, i) => (
        <div key={i}>{highlight(line, i)}</div>
      ))}
    </pre>
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
      {showCode && code && <Code name={code} />}
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
  const h = data?.heads[head];
  const topAttn = h
    ? h.weights
        .map((w, p) => [p, w, h.scores[p]] as [number, number, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <section>
      <div className="label">
        <span className="idx">05</span>
        the machine — what actually computed token {cur} ({tokText})
        <span className="note">
          {" "}— the real pipeline, stage by stage. every card: plain words first, then [math]
          with this token's actual numbers (recomputed live from the model), then [code] —
          the engine's own rust, the literal lines that ran.
        </span>
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
      </div>

      <Card
        title="1 · tokenize"
        plain={
          <>
            your text was chopped into {trace.tokens.length} tokens from a fixed 151,936-entry
            dictionary (band 01). token {cur} is {tokText} — dictionary id{" "}
            {trace.tokens[cur]?.id}.
          </>
        }
        code="forward"
      />

      <Card
        title="2 · meaning numbers"
        plain={
          <>
            id {trace.tokens[cur]?.id} looks up a row of 1,024 learned numbers — the token's
            "meaning". those numbers, plus everything the previous layers mixed in, are the
            vector flowing into layer {layer}.
          </>
        }
        math={
          data && (
            <>
              entering layer {layer}: x = {headStr(data.x_in)}
              <br />
              overall size (rms) <b>{f(data.x_in?.rms ?? 0)}</b>, range [{f(data.x_in?.min ?? 0)},{" "}
              {f(data.x_in?.max ?? 0)}] — watch rms grow with layer number as the model
              accumulates information.
            </>
          )
        }
        code="embedding"
      />

      <Card
        title="3 · normalize (rmsnorm)"
        plain={
          <>
            before attention, the vector is rescaled to a standard size — same direction, volume
            reset to ~1 — so 28 layers of math can't spiral the numbers out of range.
          </>
        }
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
        title="4 · attention — the token reads its context"
        plain={
          <>
            the normalized vector becomes a <b>q</b>uery; every earlier position offers a{" "}
            <b>k</b>ey and a <b>v</b>alue. q·k similarity scores → softmax → percentages → a
            weighted blend of values. this is the only place tokens exchange information.
          </>
        }
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
        title="5 · think it over (swiglu feed-forward)"
        plain={
          <>
            after reading context, the token "thinks privately": its 1,024 numbers expand to
            3,072, each neuron decides how much to fire (silu — a smooth on/off dimmer), gets
            gated, and compresses back to 1,024. no other tokens involved.
          </>
        }
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

      <Card
        title="6 · score every word"
        plain={
          <>
            after layer {trace.layers - 1}, the final vector is compared (one dot product each)
            against all 151,936 token meanings. high similarity = high score. those scores are
            band 02, and the pick is band 03 — you've already seen the end of this machine.
          </>
        }
        code="matmul"
      />
    </section>
  );
}
