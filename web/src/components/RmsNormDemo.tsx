import { useEffect, useState } from "react";
import { getInspect } from "../api";
import { settledSeq } from "../lib";
import { REDUCED } from "./spaceCanvas";
import type { ExplainCtx } from "./Explanations";
import type { WorkedNorm } from "../types";

/* RMSNorm, running. Before each layer step the token's vector is rescaled: divide
   every number by the vector's root-mean-square, then multiply by a learned
   per-dimension weight. This shows it on real numbers for this layer's attention
   norm — a few components going x → x/rms → ·weight = the normalized value the
   engine used. Dividing by rms is a uniform scale (length changes, direction is
   preserved); the learned weight then rescales each dimension. Pure render over
   the inspect worked-norm slice, fetched at the producing position. */

interface Resp {
  norm?: WorkedNorm;
}

const f = (x: number) => x.toFixed(3);

export function RmsNormDemo({ ctx }: { ctx: ExplainCtx }) {
  const [data, setData] = useState<Resp | null>(null);

  const seq = settledSeq(ctx.trace);
  useEffect(() => {
    let dead = false;
    setData(null);
    if (ctx.prod < 0 || seq < 0) return; // no producing pass yet / still generating
    getInspect<Resp>(ctx.prod, ctx.layer)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.prod, ctx.layer, seq]);

  if (ctx.prod < 0) {
    return (
      <div className="rms-demo rms-status">
        The first token has no producing pass. Select a later token to watch its vector normalize.
      </div>
    );
  }
  if (!data) return <div className="rms-demo rms-status">loading the producing pass…</div>;
  const n = data.norm;
  if (!n) return <div className="rms-demo rms-status">no norm to show here.</div>;

  const rows = n.pre.map((x, j) => {
    const scaled = x / n.rms;
    const out = scaled * n.weight[j];
    return { j, x, scaled, w: n.weight[j], out, err: Math.abs(out - n.post[j]) };
  });
  const maxErr = Math.max(...rows.map((r) => r.err));

  return (
    <div className="rms-demo">
      <div className="rms-formula">
        each number: x ÷ rms × weight, where rms = <b>{f(n.rms)}</b> (the root mean square of all{" "}
        {n.len.toLocaleString()} numbers)
      </div>

      <ResetBars rows={rows} rms={n.rms} />

      <div className="tbl-scroll">
        <table className="rms-tbl">
          <thead>
            <tr>
              <th>i</th>
              <th>x</th>
              <th>÷ rms</th>
              <th>× weight</th>
              <th>= norm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.j}>
                <td>{r.j}</td>
                <td>{f(r.x)}</td>
                <td>{f(r.scaled)}</td>
                <td>{f(r.w)}</td>
                <td className="rms-out">{f(r.out)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rms-note">
        the ÷ rms column is every number scaled by the same factor, which is why the vector's
        direction cannot change, only its length. the learned weight then rescales each dimension
        individually. showing the first {n.pre.length} of {n.len.toLocaleString()}.
      </div>
      <div className="rms-check">
        reconstructed = the engine's normalized vector{" "}
        <span className="dp-check">{maxErr < 5e-3 ? "· matches" : `· differs (${f(maxErr)})`}</span>
      </div>
    </div>
  );
}

/* The reset, watchable (Aaron's #12): the same real components as bars, morphing
   through the three stages — raw sizes, everything shrunk by one shared ÷rms,
   then each channel re-scaled by its learned weight. CSS transitions carry the
   morph; the stages walk once on open (instant under reduced-motion). */
const STAGES = [
  { key: "x", label: "raw x", cap: "the vector as the layer receives it — components at whatever size the running signal has grown to" },
  { key: "scaled", label: "÷ rms", cap: "every component divided by the same number: the shape is untouched, the size is standard" },
  { key: "out", label: "× weight", cap: "each channel re-scaled by its learned weight — what this layer's reader wants louder or quieter" },
] as const;

function ResetBars({
  rows,
  rms,
}: {
  rows: { x: number; scaled: number; out: number }[];
  rms: number;
}) {
  const [stage, setStage] = useState(REDUCED ? 2 : 0);
  // walk the stages once on open, then hand the buttons over
  useEffect(() => {
    if (REDUCED) return;
    let s = 0;
    const t = window.setInterval(() => {
      s++;
      setStage(s);
      if (s >= 2) window.clearInterval(t);
    }, 1100);
    return () => window.clearInterval(t);
  }, []);

  const maxAbs = Math.max(...rows.flatMap((r) => [Math.abs(r.x), Math.abs(r.scaled), Math.abs(r.out)]), 1e-6);
  const at = STAGES[stage];

  return (
    <div className="rms-reset">
      <div className="seg fl-knob-seg">
        {STAGES.map((s, i) => (
          <button key={s.key} className={"seg-opt" + (i === stage ? " on" : "")} onClick={() => setStage(i)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="rms-bars" role="img" aria-label={`the first ${rows.length} components at stage: ${at.label}`}>
        {rows.map((r, j) => {
          const v = r[at.key];
          const up = v >= 0;
          const h = (Math.abs(v) / maxAbs) * 50;
          return (
            <div className="rms-bar" key={j} title={`component ${j}: ${v.toFixed(3)}`}>
              <div
                className="rms-bar-fill"
                style={{ height: `${h}%`, top: up ? `${50 - h}%` : "50%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="rms-stage-cap">
        {at.cap}
        {stage === 1 ? ` (rms = ${rms.toFixed(3)})` : ""}
      </div>
    </div>
  );
}
