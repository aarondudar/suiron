import { useEffect, useState } from "react";
import { useAutoplay } from "../autoplay";
import { litToken } from "../lib";
import type { ExplainCtx } from "./Explanations";
import type { WorkedDot } from "../types";

/* The worked operation: one real attention score, built component by component.
   This token's query q and one earlier token's key k (one head), each head_dim
   long, paired and multiplied into a running sum, then scaled by 1/√head_dim —
   equal to the head's pre-softmax score the engine reports. Pure render over
   /api/v1/inspect (fetched only when this interactive is open). Autoplays the
   accumulation in a loop by default (pausable; off under reduced-motion). Red
   marks the current component and the final score. layer/head are controlled by
   the shared attention controls. (Reusable later for feed-forward's gate·up.) */

interface Resp {
  heads: { scores: number[]; weights: number[] }[];
  worked?: WorkedDot;
}

const f = (x: number) => x.toFixed(3);

export function DotProduct({ ctx, layer, head }: { ctx: ExplainCtx; layer: number; head: number }) {
  const hd = ctx.trace.head_dim;
  const [src, setSrc] = useState<number | null>(null); // null = engine's strongest edge
  const [data, setData] = useState<Resp | null>(null);
  // autoplay the accumulation: ~4 components per tick so a full pass is a few seconds
  const { i, playing, setI, toggle } = useAutoplay(hd, { chunk: 4, stepMs: 130 });

  useEffect(() => {
    let dead = false;
    setData(null);
    if (ctx.prod < 0) return; // the seed token had no forward pass to inspect
    const sp = src == null ? "" : `&src=${src}`;
    // the attention that produced `cur` ran at the previous position
    fetch(`/api/v1/inspect?pos=${ctx.prod}&layer=${layer}&head=${head}${sp}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Resp | null) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.prod, layer, head, src]);

  const w = data?.worked;
  const scale = 1 / Math.sqrt(hd);
  const partial = (n: number) => {
    let s = 0;
    if (w) for (let j = 0; j < n; j++) s += w.q[j] * w.k[j];
    return s;
  };
  const fullSum = w ? partial(hd) : 0;
  const runSum = partial(Math.min(i, hd));
  const score = fullSum * scale;
  const engineScore = w && data ? data.heads[head]?.scores[w.src] : undefined;
  const done = i >= hd;
  const agrees = engineScore !== undefined && Math.abs(score - engineScore) < 5e-3;

  const srcOptions = (data?.heads[head]?.weights ?? [])
    .map((wt, p) => [p, wt] as [number, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const srcText = (p: number) => litToken(ctx.trace.tokens[p]?.t ?? "").text;

  return (
    <div className="dotprod">
      <div className="dp-title">one real attention score, component by component</div>

      {!data ? (
        <div className="dp-status">loading the producing pass…</div>
      ) : !w ? (
        <div className="dp-status">no earlier token to read from at this position.</div>
      ) : (
        <>
          <div className="dp-src">
            source token:
            {srcOptions.map(([p, wt]) => (
              <button
                key={p}
                className={"dp-src-opt" + (p === w.src ? " on" : "")}
                onClick={() => setSrc(p)}
                title={`attention weight ${(wt * 100).toFixed(0)}%`}
              >
                {srcText(p)}
              </button>
            ))}
          </div>

          <div className="dp-formula">
            score = ( q · k<sub>{srcText(w.src)}</sub> ) / √{hd}
          </div>

          <div className="dp-step">
            component <b>{Math.min(i, hd)}</b> / {hd}
            {i > 0 && (
              <span className="dp-term">
                q[{i - 1}] × k[{i - 1}] = {f(w.q[i - 1])} × {f(w.k[i - 1])} ={" "}
                <span className="dp-prod">{f(w.q[i - 1] * w.k[i - 1])}</span>
              </span>
            )}
          </div>

          <div className="dp-runsum">
            <div className="dp-bar">
              <div
                className="dp-bar-fill"
                style={{ width: `${Math.min(100, (Math.abs(runSum) / (Math.abs(fullSum) || 1)) * 100)}%` }}
              />
            </div>
            <span className="dp-runsum-val">Σ q·k so far = {f(runSum)}</span>
          </div>

          {done && (
            <div className="dp-result">
              Σ q·k = {f(fullSum)} ÷ √{hd} = <span className="dp-score">{f(score)}</span>
              {engineScore !== undefined && (
                <span className="dp-check">
                  {" "}
                  engine score {f(engineScore)} {agrees ? "· matches" : "· differs"}
                </span>
              )}
            </div>
          )}

          <div className="dp-buttons">
            <button onClick={toggle}>{playing ? "❚❚ pause" : "▶ play"}</button>
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i <= 0}>
              ◀
            </button>
            <button onClick={() => setI(Math.min(hd, i + 1))} disabled={done}>
              ▶ step
            </button>
            <button onClick={() => setI(hd)} disabled={done}>
              to end
            </button>
            <button onClick={() => setI(0)} disabled={i === 0}>
              reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}
