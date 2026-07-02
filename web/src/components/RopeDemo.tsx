import { useEffect, useState } from "react";
import { getInspect } from "../api";
import { useAutoplay } from "../autoplay";
import { settledSeq } from "../lib";
import { Stepper } from "./Stepper";
import type { ExplainCtx } from "./Explanations";
import type { WorkedDot } from "../types";

/* RoPE, running. Before attention compares two tokens, each one's query and key
   are rotated by an angle set by its position. This steps that rotation on real
   numbers: a component pair (x_i, x_{i+d/2}) is a point; RoPE spins it by the
   pair's angle (pos · base^(-2i/d)), sweeping from the pre-RoPE value to the
   post-RoPE value attention then uses. Lower pairs spin fast with position;
   higher pairs barely move — that spread is how position is encoded. An IDENTITY
   read: fetched at `cur`, the inspected token's own position, so the angles
   match the intro's "this token sits at position N" (at position 0 every angle
   is zero — the first token is the unrotated reference). */

interface Resp {
  worked?: WorkedDot;
}

const STEPS = 24;
const rot = (x0: number, x1: number, a: number): [number, number] => [
  x0 * Math.cos(a) - x1 * Math.sin(a),
  x0 * Math.sin(a) + x1 * Math.cos(a),
];

export function RopeDemo({ ctx }: { ctx: ExplainCtx }) {
  const [data, setData] = useState<Resp | null>(null);
  const { i: t, playing, setI, toggle } = useAutoplay(STEPS, { stepMs: 90 });

  const seq = settledSeq(ctx.trace);
  useEffect(() => {
    let dead = false;
    setData(null);
    if (seq < 0) return; // still generating
    // head 0 at this token's own position (RoPE's angles are the same for
    // every head); the rotated result is the query attention uses here
    getInspect<Resp>(ctx.cur, 0, 0)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.cur, seq]);

  const w = data?.worked;
  if (!data) return <div className="rope-demo rope-status">loading this token's pass…</div>;
  if (!w || !w.q_pre || !w.angles) return <div className="rope-demo rope-status">no rotation to show here.</div>;

  const half = w.angles.length;
  // fast / medium / slow pairs, to show the frequency spread
  const shown = [0, Math.floor(half / 2), half - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  const frac = Math.min(t, STEPS) / STEPS;

  // check: rotating the pre-RoPE query by the reported angles reproduces q
  let maxErr = 0;
  for (let i = 0; i < half; i++) {
    const [a, b] = rot(w.q_pre[i], w.q_pre[i + half], w.angles[i]);
    maxErr = Math.max(maxErr, Math.abs(a - w.q[i]), Math.abs(b - w.q[i + half]));
  }

  const B = 92;
  const C = B / 2;
  const R = 32;

  return (
    <div className="rope-demo">
      <div className="rope-plots">
        {shown.map((i) => {
          const x0 = w.q_pre[i];
          const x1 = w.q_pre[i + half];
          const r = Math.hypot(x0, x1) || 1;
          const phi0 = Math.atan2(x1, x0);
          const phi = phi0 + frac * w.angles[i];
          // SVG y is down; negate the sine so the rotation reads counter-clockwise
          const pt = (ang: number) => [C + R * Math.cos(ang), C - R * Math.sin(ang)] as const;
          const [px, py] = pt(phi0);
          const [cx, cy] = pt(phi);
          const deg = ((w.angles[i] * 180) / Math.PI).toFixed(0);
          return (
            <div className="rope-plot" key={i}>
              <svg viewBox={`0 0 ${B} ${B}`} role="img">
                <circle className="rope-ring" cx={C} cy={C} r={R} />
                <line className="rope-axis" x1={C - R} y1={C} x2={C + R} y2={C} />
                <line className="rope-axis" x1={C} y1={C - R} x2={C} y2={C + R} />
                <circle className="rope-pre" cx={px} cy={py} r={2.5} />
                <line className="rope-arm" x1={C} y1={C} x2={cx} y2={cy} />
                <circle className="rope-cur" cx={cx} cy={cy} r={3.5} />
              </svg>
              <div className="rope-label">
                pair {i} · θ {deg}° · r {r.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rope-note">
        {ctx.cur === 0 ? (
          <>
            at position 0 every angle is zero: the first token is the unrotated reference. select a
            later token to see its pairs spin.
          </>
        ) : (
          <>
            the dim dot is one pair of the query's numbers before rotation; the red dot is after. it
            stays on its ring: rotation changes direction, never length. each pair has its own speed
            (position × frequency), so pair 0 spins fast while pair {half - 1} barely moves.
          </>
        )}
      </div>

      <Stepper i={t} max={STEPS} playing={playing} setI={setI} toggle={toggle} unit="step" />

      {t >= STEPS && (
        <div className="rope-check">
          rotated query = the q attention uses at this position{" "}
          <span className="dp-check">{maxErr < 5e-3 ? "· matches the engine" : `· differs (${maxErr.toFixed(4)})`}</span>
        </div>
      )}
    </div>
  );
}
