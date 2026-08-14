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

/* The score, drawn as the thing it is (design-35, track B).
   This was a progress bar: the loudest element in the drawer encoded how far
   through the stepper you had clicked, while the mathematics — which components
   agree, and by how much — was not drawn at all. Aaron, 2026-08-10: "too
   difficult to parse in its current state."

   Now three real lanes, one column per component: the query, the key, and their
   product. Every bar is a live number and the sign is the direction from the
   midline, so agreement is visible as two bars leaning the same way, and the
   punchline the drawer already computed — that a handful of coordinates carry
   the whole score — is the shape of the bottom lane rather than a sentence under
   it. Columns left of the cursor are the sum so far; the product lane is tallest
   because it is the one being argued about.

   SVG, not canvas: nothing here animates (the stepper drives it), it stays crisp
   at any width, and unlike the canvas instruments it can actually be seen in a
   screenshot. */
function ComponentStrip({
  q,
  k,
  upto,
  carry,
}: {
  q: number[];
  k: number[];
  upto: number;
  carry: number[];
}) {
  const n = q.length;
  if (!n) return null;
  const prod = q.map((v, j) => v * k[j]);
  const peak = (xs: number[]) => Math.max(...xs.map(Math.abs), 1e-6);
  const carried = new Set(carry);
  /* One lane, not three. The first cut drew q and k as their own lanes so the
     reader could see WHY a product spikes — but these are real vectors with a
     heavy tail, and on an honest linear scale 116 of 128 key bars rendered
     sub-pixel. A channel nobody can see is not a channel; rescaling to make it
     visible would break "radius = real value". So the product gets the whole
     height, and the per-pair "why" stays where it is already legible: the
     numeric q[j] x k[j] line directly above (design-35). */
  const LANES = [{ rows: prod, half: 38, top: 0, peak: peak(prod), label: "q × k" }];
  const H = 76;
  return (
    <svg className="dp-strip" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" role="img"
      aria-label="each component's query value, key value, and their product">
      {LANES.map((lane) => {
        const mid = lane.top + lane.half;
        return (
          <g key={lane.label}>
            <line className="dp-strip-mid" x1={0} y1={mid} x2={n} y2={mid} />
            {lane.rows.map((v, j) => {
              const h = (Math.abs(v) / lane.peak) * lane.half;
              const cls =
                j >= upto
                  ? "dp-b"
                  : j === upto - 1
                    ? "dp-b cur"
                    : carried.has(j)
                      ? "dp-b carry"
                      : "dp-b on";
              return (
                <rect
                  key={j}
                  className={cls}
                  x={j + 0.12}
                  width={0.76}
                  y={v >= 0 ? mid - h : mid}
                  height={Math.max(h, 0.35)}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function DotProduct({
  ctx,
  layer,
  head,
  flow,
  part,
  onScore,
}: {
  ctx: ExplainCtx;
  layer: number;
  head: number;
  /** which half to show. The tour walks this drawer one idea at a time — the
   *  score, then the blend — the same way the sampling drawer shows one dial at a
   *  time (design-35 track C). Undefined shows both, as the expert view does. */
  part?: "score" | "blend";
  /** in the tour the two deepest insight lines come off (design-34): "rides
   *  rotation pair N, turning once in ~2.6M tokens" and the rival-key
   *  discriminator are expert readings, and this drawer is already the longest
   *  thing a beginner meets. "why this number" stays — it is plain. */
  flow?: boolean;
  /** reports the engine's score for the pair on show, so the drawer's D.proof
   *  slot can name it — the same "instrument reports up, prose renders it"
   *  pattern LensSpace uses for step 3's caption (design-34) */
  onScore?: (engineScore: number | undefined) => void;
}) {
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
  useEffect(() => {
    onScore?.(engineScore);
  }, [engineScore, onScore]);

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
      <div className="dp-title">
        {part === "blend"
          ? "then the blend: weights, and the head's read"
          : "one real attention score, component by component"}
      </div>

      {!data ? (
        <div className="dp-status">loading the producing pass…</div>
      ) : !w ? (
        <div className="dp-status">no earlier token to read from at this position.</div>
      ) : (
        <>
          {part !== "blend" && (
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

          <div className="dp-strip-key">
            <span>
              one column per component · <b>up</b> the two agree, <b>down</b> they disagree ·
              height is how strongly · the sum is every column added up
            </span>
          </div>
          <ComponentStrip q={w.q} k={w.k} upto={Math.min(i, hd)} carry={carry} />
          <div className="dp-runsum">
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
              {!flow && ropeLine && <div>{ropeLine}</div>}
              {!flow && discLine && <div>{discLine}</div>}
            </div>
          )}

          <Stepper i={i} max={hd} playing={playing} setI={setI} toggle={toggle} unit="component" />
          </>
          )}

          {part !== "score" && data.heads[head] && w.v && w.ctx && w.v.length === data.heads[head].weights.length && (
            <Blend
              scores={data.heads[head].scores}
              weights={data.heads[head].weights}
              v={w.v}
              ctx={w.ctx}
              srcText={srcText}
            />
          )}

          {part !== "score" && data.heads[head] && (
            <div className="dp-insight">
              the forward thread: softmax turned this score into{" "}
              {((data.heads[head].weights[w.src] ?? 0) * 100).toFixed(0)}% of the head's read; the
              head's output joins this word's running vector, which every later layer reads — "the
              signal" shows it travel, and the climb shows what it becomes.
            </div>
          )}

          {part !== "score" && data.attribution && data.attribution.cands.length > 0 && (
            <div className="dp-insight">
              <div>what this head's read bought at the finish line:</div>
              {data.attribution.cands.slice(0, 2).map(([cid, t, cHead, cLayer, logit]) => (
                <div key={cid}>
                  {/* "logit" is a step-4 term; this is a step-2 drawer, so it
                      names the number instead of labelling it (design-34, C6) */}
                  “{litToken(t).text}” — this head{" "}
                  <b className="dp-attr">{cHead >= 0 ? "+" : ""}{cHead.toFixed(3)}</b>, the layer's
                  whole attention {cLayer >= 0 ? "+" : ""}
                  {cLayer.toFixed(3)}, of its final score {logit.toFixed(2)}
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
