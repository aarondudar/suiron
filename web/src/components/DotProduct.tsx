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
  /** direct logit attribution (design-23): per final candidate
   *  [id, text, this head's contribution, the layer's attention contribution,
   *  the full logit] — absent on recordings made before the field existed */
  attribution?: { sum_ok: boolean; cands: [number, string, number, number, number][] };
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

  // ---- why THIS number (design-22): per-instance, from the values on screen ----
  // the few signed components that carry at least half the final sum (capped
  // at 5); an empty list with a positive sum means the match is spread — a
  // finding in its own right
  const carry: number[] = [];
  if (w && fullSum > 0) {
    const ranked = w.q
      .map((qv, j) => [qv * w.k[j], j] as [number, number])
      .sort((a, b) => b[0] - a[0]);
    let s = 0;
    for (const [c, j] of ranked) {
      if (c <= 0 || carry.length >= 5) break;
      carry.push(j);
      s += c;
      if (s >= fullSum * 0.5) break;
    }
    if (s < fullSum * 0.5) carry.length = 0; // >5 needed: call it spread instead
  }
  const carrySum = w ? carry.reduce((a, j) => a + w.q[j] * w.k[j], 0) : 0;

  // the biggest component's RoPE pair: its real rotation period, from the
  // model's rope theta (1e6, a GGUF constant — same footing as the vocab count)
  const jStar = carry[0];
  let ropeLine: string | null = null;
  if (w && jStar !== undefined) {
    const pair = jStar % (hd / 2);
    const freq = Math.pow(1e6, (-2 * pair) / hd);
    const period = (2 * Math.PI) / freq;
    const compact =
      period >= 1e6 ? `${(period / 1e6).toFixed(1)}M` : period >= 1e3 ? `${(period / 1e3).toFixed(1)}k` : period.toFixed(0);
    ropeLine =
      period < 100
        ? `component ${jStar} rides rotation pair ${pair}, turning once every ~${compact} tokens — a channel position moves hard`
        : `component ${jStar} rides rotation pair ${pair}, turning once in ~${compact} tokens — position barely touches it; it carries content`;
  }

  // the discriminator: against the strongest rival source, where did the head
  // actually tell the two words apart? one extra inspect, cached like the rest
  const rivalPos = w ? srcOptions.find(([p]) => p !== w.src)?.[0] : undefined;
  const [rivalK, setRivalK] = useState<number[] | null>(null);
  useEffect(() => {
    let dead = false;
    setRivalK(null);
    if (!w || rivalPos === undefined || ctx.prod < 0 || seq < 0) return;
    getInspect<Resp>(ctx.prod, layer, head, rivalPos)
      .then((d) => !dead && setRivalK(d.worked?.k ?? null))
      .catch(() => !dead && setRivalK(null));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w?.src, rivalPos, layer, head, seq]);
  let discLine: string | null = null;
  if (w && rivalK && rivalPos !== undefined && engineScore !== undefined) {
    const rivalScore = data?.heads[head]?.scores[rivalPos];
    if (rivalScore !== undefined && engineScore > rivalScore) {
      const diffs = w.q
        .map((qv, j) => [qv * (w.k[j] - rivalK[j]), j] as [number, number])
        .sort((a, b) => b[0] - a[0])
        .slice(0, 2);
      if (diffs[0][0] > 0) {
        discLine = `against ${srcText(rivalPos)} (score ${f(rivalScore)}), the head prefers ${srcText(w.src)} mostly at components ${diffs.map(([, j]) => j).join(" and ")} — where their keys differ most under this query`;
      }
    }
  }

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
                {carry.includes(i - 1) && (
                  <span className="dp-carry-tag"> ← one of the few that carry this score</span>
                )}
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

          {done && fullSum > 0 && (
            <div className="dp-insight">
              <div>
                {carry.length > 0
                  ? `why this number: components ${carry.join(", ")} alone give ${f(carrySum)} of the ${f(fullSum)} — a few coordinates carry the match.`
                  : `why this number: no few coordinates dominate — the match is spread across many components.`}
              </div>
              {ropeLine && <div>{ropeLine}</div>}
              {discLine && <div>{discLine}</div>}
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

          {data.heads[head] && (
            <div className="dp-insight">
              the forward thread: softmax turned this score into{" "}
              {((data.heads[head].weights[w.src] ?? 0) * 100).toFixed(0)}% of the head's read; the
              head's output joins this word's running vector, which every later layer reads — "the
              signal" shows it travel, and the climb shows what it becomes.
            </div>
          )}

          {data.attribution && data.attribution.cands.length > 0 && (
            <div className="dp-insight">
              <div>what this head's read bought at the finish line:</div>
              {data.attribution.cands.slice(0, 2).map(([cid, t, cHead, cLayer, logit]) => (
                <div key={cid}>
                  “{litToken(t).text}” — this head{" "}
                  <b className="dp-attr">{cHead >= 0 ? "+" : ""}{cHead.toFixed(3)}</b>, the layer's
                  whole attention {cLayer >= 0 ? "+" : ""}
                  {cLayer.toFixed(3)}, of the full {logit.toFixed(2)} logit
                </div>
              ))}
              <div className="dp-check">
                {data.attribution.sum_ok
                  ? `the ${data.heads.length} heads' pushes sum to the layer's recorded output · matches`
                  : "the head pushes did not reconstruct the layer output — inspect in the expert view"}
              </div>
            </div>
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
