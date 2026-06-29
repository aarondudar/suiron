import { useEffect, useState } from "react";
import { litToken } from "../lib";
import type { ExplainCtx } from "./Explanations";
import type { WorkedDot } from "../types";

/* The worked operation: one real attention score, built component by component.
   This token's query vector q and one earlier token's key vector k (one head),
   each head_dim long, paired and multiplied into a running sum, then scaled by
   1/√head_dim — equal to that head's pre-softmax score, which the engine already
   reports. Pure render over real numbers from /api/v1/inspect (fetched only when
   this interactive is open). Red marks the current component and the final
   score; everything else is monochrome. prefers-reduced-motion shows the
   completed computation. (Reusable later for feed-forward's gate·up.) */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Resp {
  heads: { scores: number[]; weights: number[] }[];
  worked?: WorkedDot;
}

const f = (x: number) => x.toFixed(3);

export function DotProduct({ ctx }: { ctx: ExplainCtx }) {
  const { layers: nLayers, heads: nHeads, head_dim: hd } = ctx.trace;
  const [layer, setLayer] = useState(Math.min(ctx.layer, nLayers - 1));
  const [head, setHead] = useState(Math.min(3, nHeads - 1));
  const [src, setSrc] = useState<number | null>(null); // null = engine's strongest edge
  const [data, setData] = useState<Resp | null>(null);
  const [i, setI] = useState(0); // components accumulated so far

  useEffect(() => {
    let dead = false;
    setData(null);
    const sp = src == null ? "" : `&src=${src}`;
    fetch(`/api/v1/inspect?pos=${ctx.cur}&layer=${layer}&head=${head}${sp}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Resp | null) => {
        if (dead) return;
        setData(d);
        setI(REDUCED ? hd : 0); // reduced motion: start completed
      })
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.cur, layer, head, src, hd]);

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

  // top earlier tokens by this head's attention weight, to pick the source from
  const srcOptions = (data?.heads[head]?.weights ?? [])
    .map((wt, p) => [p, wt] as [number, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const num = (set: (n: number) => void, max: number) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(Math.min(max, Math.max(0, +e.target.value)));

  const srcText = (p: number) => litToken(ctx.trace.tokens[p]?.t ?? "").text;

  return (
    <div className="dotprod">
      <div className="dp-title">one real attention score, component by component</div>

      <div className="dp-controls">
        <label className="dp-sel">
          layer <input type="number" min={0} max={nLayers - 1} value={layer} onChange={num(setLayer, nLayers - 1)} />
        </label>
        <label className="dp-sel">
          head <input type="number" min={0} max={nHeads - 1} value={head} onChange={num(setHead, nHeads - 1)} />
        </label>
      </div>

      {!data ? (
        <div className="dp-status">loading this token's vectors…</div>
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

          {/* the current component being added (red), then the running sum */}
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
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i <= 0}>
              ◀
            </button>
            <button onClick={() => setI(Math.min(hd, i + 1))} disabled={done}>
              ▶ step
            </button>
            <button onClick={() => setI(Math.min(hd, i + 8))} disabled={done}>
              +8
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
