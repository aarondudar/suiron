import { useEffect, useState } from "react";
import { useHotVar } from "./Explainer";
import type { ExplainCtx } from "./Explanations";
import type { Trace } from "../types";

/* "Under the hood": one woven artifact for a compute stage. The real engine
   source, this token's real numbers, and the prose are linked — hover a named
   quantity in the code (or its term in the prose) and its actual value for the
   current token appears in a fixed readout below the code. The value↔variable
   map is a small CURATED table per stage (STAGE_ANNO) — no source parsing, no
   auto-instrumentation. Click-gated like its parts: nothing fetches until the
   concept is open. Linked highlighting is drawer-scoped (hotVar), never red. */

export type Stage = "embedding" | "attention" | "feedforward";

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

/** compact, honest summary of a hidden-dim vector */
function vec(v?: VecStat): string {
  if (!v) return "…";
  return `[${v.head.slice(0, 4).map(f).join(", ")} …] rms ${f(v.rms)}`;
}
/** peak of a per-position array (scores / weights for one head) */
function peak(arr: number[] | undefined, asPct: boolean): string {
  if (!arr || !arr.length) return "…";
  let mi = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[mi]) mi = i;
  const val = asPct ? `${(arr[mi] * 100).toFixed(0)}%` : f(arr[mi]);
  return `${arr.length} values, peak ${val} at position ${mi}`;
}

type ValueFn = (d: Inspect, head: number, trace: Trace) => string;
interface VarAnno {
  name: string;
  meaning: string;
  value: ValueFn;
}

/* Each entry maps a REAL identifier in the served source to a REAL inspect
   field for this token. Only quantities a field faithfully backs are listed. */
const STAGE_ANNO: Record<Stage, { fn: string; vars: VarAnno[] }> = {
  embedding: {
    fn: "embedding",
    vars: [
      { name: "token", meaning: "this token's id, an index into the table", value: (d) => `${d.token.id}` },
      { name: "h", meaning: "the hidden size: numbers per token", value: (d) => `${d.x_in?.len ?? "…"}` },
      {
        name: "token_embd",
        meaning: "the embedding table; this row becomes the token's vector",
        value: (d) => vec(d.x_in),
      },
    ],
  },
  attention: {
    fn: "attention",
    vars: [
      { name: "q", meaning: "this token's query vector", value: (d) => vec(d.q) },
      {
        name: "scale",
        meaning: "1/√head_dim, keeps the scores in range",
        value: (_d, _h, t) => `1/√${t.head_dim} = ${(1 / Math.sqrt(t.head_dim)).toFixed(4)}`,
      },
      { name: "scores", meaning: "q·k for each earlier token, this head", value: (d, h) => peak(d.heads[h]?.scores, false) },
      {
        name: "weights",
        meaning: "scores after softmax: how much to read from each token",
        value: (d, h) => peak(d.heads[h]?.weights, true),
      },
    ],
  },
  feedforward: {
    fn: "ffn",
    vars: [
      { name: "gate", meaning: "the gate projection", value: (d) => vec(d.gate) },
      { name: "up", meaning: "the up projection", value: (d) => vec(d.up) },
      { name: "silu", meaning: "x·sigmoid(x); gates how much of up passes through", value: (d) => vec(d.gate_act) },
      { name: "down", meaning: "compressed back to the hidden size", value: (d) => vec(d.down) },
    ],
  },
};

// --- a tiny Rust highlighter that also wraps the curated variable names ---
const KW =
  "pub|fn|let|mut|for|in|if|else|return|match|loop|while|use|struct|impl|enum|const|break|continue|as|where|self|Self";
const TY =
  "f16|f32|f64|u8|u16|u32|u64|usize|i8|i16|i32|i64|bool|str|Vec|Option|Some|None|String|KvCache|Model|Observer";
const CLS: Record<number, string> = { 2: "c-comment", 3: "c-str", 4: "c-kw", 5: "c-type", 6: "c-num" };

function buildRe(vars: string[]): RegExp {
  // longest-first so `token_embd` wins over `token` at the same position
  const v = [...vars].sort((a, b) => b.length - a.length).join("|");
  return new RegExp(
    `(\\b(?:${v})\\b)` + // 1 curated var
      `|(\\/\\/.*)` + // 2 comment
      `|("(?:[^"\\\\]|\\\\.)*")` + // 3 string
      `|\\b(${KW})\\b` + // 4 keyword
      `|\\b(${TY})\\b` + // 5 type
      `|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e-?\\d+)?\\b)`, // 6 number
    "g",
  );
}

export function UnderHood({
  ctx,
  stage,
  layer: cLayer,
  head: cHead,
}: {
  ctx: ExplainCtx;
  stage: Stage;
  /** when given (the attention concept), layer/head are controlled by the
   *  shared attention controls so this view and the worked dot product agree */
  layer?: number;
  head?: number;
}) {
  const anno = STAGE_ANNO[stage];
  const { hot, setHot } = useHotVar();
  const controlled = cLayer !== undefined;
  // embedding is the layer-0 table lookup; feed-forward picks its own layer
  const [iLayer, setILayer] = useState(stage === "embedding" ? 0 : ctx.layer);
  const [iHead, setIHead] = useState(3);
  const layer = stage === "embedding" ? 0 : (cLayer ?? iLayer);
  const head = cHead ?? iHead;
  const eff = layer;

  const [data, setData] = useState<Inspect | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  // embedding is the token's own IDENTITY (a table row keyed by token id, no
  // forward pass required), so it reads at `cur` — including the seed, where
  // there is no producing pass at all. Every other stage is a PRODUCTION read
  // and fetches the pass that produced `cur`, at `prod` (absent at the seed).
  const readPos = stage === "embedding" ? ctx.cur : ctx.prod;

  useEffect(() => {
    let dead = false;
    setData(null);
    if (readPos < 0) return; // the seed token had no forward pass to inspect
    fetch(`/api/v1/inspect?pos=${readPos}&layer=${eff}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [readPos, eff]);

  useEffect(() => {
    let dead = false;
    fetch(`/api/v1/source?fn=${anno.fn}`)
      .then((r) => (r.ok ? r.text() : "// source unavailable — restart the lab (make dev)"))
      .then((t) => !dead && setSrc(t.startsWith("<") ? "// stale backend — restart the lab (make dev)" : t));
    return () => {
      dead = true;
    };
  }, [anno.fn]);

  const re = buildRe(anno.vars.map((a) => a.name));
  const names = new Set(anno.vars.map((a) => a.name));

  const line = (text: string, key: number) => {
    const out: React.ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > last) out.push(text.slice(last, i));
      if (m[1] !== undefined && names.has(m[1])) {
        const name = m[1];
        out.push(
          <span
            key={`${key}-${i}`}
            className={"uh-var" + (hot === name ? " hot" : "")}
            data-var={name}
            onMouseEnter={() => setHot(name)}
            onMouseLeave={() => setHot(null)}
            onClick={() => setHot(hot === name ? null : name)}
          >
            {m[0]}
          </span>,
        );
      } else {
        const gi = [2, 3, 4, 5, 6].find((g) => m[g] !== undefined);
        out.push(
          <span key={`${key}-${i}`} className={gi ? CLS[gi] : undefined}>
            {m[0]}
          </span>,
        );
      }
      last = i + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length ? out : " ";
  };

  const active = hot ? anno.vars.find((a) => a.name === hot) : null;

  return (
    <div className="under-hood">
      <div className="uh-controls">
        {stage !== "embedding" && !controlled && (
          <label className="uh-sel">
            layer{" "}
            <input
              type="number"
              min={0}
              max={ctx.trace.layers - 1}
              value={layer}
              onChange={(e) => setILayer(Math.min(ctx.trace.layers - 1, Math.max(0, +e.target.value)))}
            />
          </label>
        )}
        {stage === "attention" && !controlled && (
          <label className="uh-sel">
            head{" "}
            <input
              type="number"
              min={0}
              max={ctx.trace.heads - 1}
              value={head}
              onChange={(e) => setIHead(Math.min(ctx.trace.heads - 1, Math.max(0, +e.target.value)))}
            />
          </label>
        )}
        {!data && (
          <span className="uh-loading">
            {stage === "embedding" ? "loading the table row…" : "loading the producing pass…"}
          </span>
        )}
      </div>

      <pre className="code uh-code">
        {src === null
          ? "loading…"
          : src.split("\n").map((l, i) => <div key={i}>{line(l, i)}</div>)}
      </pre>

      <div className="uh-readout">
        {active ? (
          <>
            <b className="uh-readout-name">{active.name}</b>
            <span className="uh-readout-meaning"> {active.meaning} </span>={" "}
            <span className="uh-val">{data ? active.value(data, head, ctx.trace) : "…"}</span>
          </>
        ) : (
          <span className="uh-readout-idle">
            hover a highlighted name to see its real value{stage === "embedding" ? " for this token" : " for the producing pass"}
          </span>
        )}
      </div>
    </div>
  );
}
