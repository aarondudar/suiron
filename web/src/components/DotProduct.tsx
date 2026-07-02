import { useEffect, useState } from "react";
import { getInspect } from "../api";
import { useAutoplay } from "../autoplay";
import { litToken, settledSeq, softmaxAt } from "../lib";
import { Stepper } from "./Stepper";
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

  const seq = settledSeq(ctx.trace);
  useEffect(() => {
    let dead = false;
    setData(null);
    if (ctx.prod < 0 || seq < 0) return; // no producing pass yet / still generating
    // the attention that produced `cur` ran at the previous position
    getInspect<Resp>(ctx.prod, layer, head, src)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.prod, layer, head, src, seq]);

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
            rebuild the score for:
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
          <div className="dp-why">
            dividing by √{hd} keeps the score in a stable range: a sum of {hd} products would
            otherwise grow with the vector length.
          </div>

          <div className="dp-step">
            {i > 0 ? (
              <span className="dp-term">
                q[{i - 1}] × k[{i - 1}] = {f(w.q[i - 1])} × {f(w.k[i - 1])} ={" "}
                <span className="dp-prod">{f(w.q[i - 1] * w.k[i - 1])}</span>
              </span>
            ) : (
              <span className="dp-term">pair each of the {hd} components, multiply, sum.</span>
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

          <Stepper i={i} max={hd} playing={playing} setI={setI} toggle={toggle} unit="component" />

          {data.heads[head] && w.v && w.ctx && w.v.length === data.heads[head].weights.length && (
            <Blend
              scores={data.heads[head].scores}
              weights={data.heads[head].weights}
              v={w.v}
              ctx={w.ctx}
              srcText={srcText}
            />
          )}
        </>
      )}
    </div>
  );
}

/* The second half of attention: that one score was for one source; softmax turns
   ALL the scores into weights, and the head's output is every source's value
   vector summed by its weight. Stepped over sources; the final sum equals the
   engine's recorded head context. One head — the heads are then concatenated and
   output-projected to finish attention. */
function Blend({
  scores,
  weights,
  v,
  ctx,
  srcText,
}: {
  scores: number[];
  weights: number[];
  v: number[][];
  ctx: number[];
  srcText: (p: number) => string;
}) {
  const n = weights.length;
  const hd = ctx.length;
  const { i: s, playing, setI, toggle } = useAutoplay(n, { stepMs: 260 });

  const soft = softmaxAt(scores, 1);
  const softOk = soft.length === n && weights.every((wp, p) => Math.abs(wp - soft[p]) < 2e-3);

  const at = Math.min(s, n);
  const run = new Array(hd).fill(0);
  for (let p = 0; p < at; p++) {
    const wp = weights[p];
    const vp = v[p];
    for (let d = 0; d < hd; d++) run[d] += wp * vp[d];
  }
  const done = s >= n;
  const rms = (a: number[]) => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / (a.length || 1));
  const maxDiff = Math.max(...ctx.map((c, d) => Math.abs(c - run[d])));
  const cur = at > 0 ? at - 1 : -1;

  return (
    <div className="dp-blend">
      <div className="dp-blend-title">
        then the blend: softmax turns the scores into weights, and the head reads each token's value
        by its weight.
      </div>
      <div className="dp-softmax">
        softmax(scores) → weights{" "}
        <span className="dp-check">{softOk ? "· matches the engine" : "· differs"}</span>
      </div>

      <div className="dp-step">
        {cur >= 0 ? (
          <span className="dp-term">
            weight[{cur}] × v(<span className="dp-prod">{srcText(cur)}</span>) = {f(weights[cur])} ×
            [{hd} numbers]
          </span>
        ) : (
          <span className="dp-term">add each source's value vector, scaled by its weight.</span>
        )}
      </div>

      <div className="dp-runsum">
        <span className="dp-runsum-val">
          Σ weight·v so far · rms {f(rms(run))} · [{run.slice(0, 4).map(f).join(", ")} …]
        </span>
      </div>

      {done && (
        <div className="dp-result">
          head output · rms {f(rms(ctx))}{" "}
          <span className="dp-check">
            engine {maxDiff < 5e-3 ? "· matches" : `· differs (${f(maxDiff)})`}
          </span>
        </div>
      )}

      <Stepper i={s} max={n} playing={playing} setI={setI} toggle={toggle} unit="source" />

      <div className="dp-blend-note">
        one head. the heads' outputs are concatenated and passed through the output projection to
        finish attention.
      </div>
    </div>
  );
}
