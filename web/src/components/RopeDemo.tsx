import { useEffect, useState } from "react";
import { useAutoplay } from "../autoplay";
import { Stepper } from "./Stepper";
import type { ExplainCtx } from "./Explanations";
import type { WorkedDot } from "../types";

/* RoPE, running. Before attention compares two tokens, each one's query and key
   are rotated by an angle set by its position. This steps that rotation on real
   numbers: a component pair (x_i, x_{i+d/2}) is a point; RoPE spins it by the
   pair's angle (pos · base^(-2i/d)), sweeping from the pre-RoPE value to the
   post-RoPE value the score then uses. Lower pairs spin fast with position;
   higher pairs barely move — that spread is how position is encoded. Pure render
   over the inspect worked slice (q_pre, q, angles), fetched at the producing
   position (same q the worked dot product multiplies). */

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

  useEffect(() => {
    let dead = false;
    setData(null);
    if (ctx.prod < 0) return; // the first token has no producing pass
    // head 0 at the producing position — RoPE's angles are the same for every
    // head; this is the query the score uses
    fetch(`/api/v1/inspect?pos=${ctx.prod}&layer=0&head=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Resp | null) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.prod]);

  if (ctx.prod < 0) {
    return (
      <div className="rope-demo rope-status">
        The first token has no earlier position to be produced from. Select a later token to watch
        its query rotate.
      </div>
    );
  }
  const w = data?.worked;
  if (!data) return <div className="rope-demo rope-status">loading the producing pass…</div>;
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
        each pair rotates by its own angle (position × frequency): pair 0 spins fast with position,
        pair {half - 1} barely moves. rotation changes direction, never length.
      </div>

      <Stepper i={t} max={STEPS} playing={playing} setI={setI} toggle={toggle} unit="rotate" />

      {t >= STEPS && (
        <div className="rope-check">
          rotated query = the q the score multiplies{" "}
          <span className="dp-check">{maxErr < 5e-3 ? "· matches the engine" : `· differs (${maxErr.toFixed(4)})`}</span>
        </div>
      )}
    </div>
  );
}
