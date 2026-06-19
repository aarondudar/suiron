import { useEffect, useState } from "react";

/* Renders one real function from the engine, fetched live from
   /api/v1/source. Used by the Explainer's "the code" rungs (alongside StageMath
   for "the math"). Click-gated, so the default view never makes this call. */

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

export function EngineSource({ fn }: { fn: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/v1/source?fn=${fn}`)
      .then((r) => (r.ok ? r.text() : "// source unavailable — restart the lab (make dev)"))
      .then((t) =>
        setSrc(t.startsWith("<") ? "// stale backend — restart the lab (make dev)" : t),
      );
  }, [fn]);
  if (src === null) return <pre className="code">loading…</pre>;
  return (
    <pre className="code">
      {src.split("\n").map((line, i) => (
        <div key={i}>{highlight(line, i)}</div>
      ))}
    </pre>
  );
}
