import { useState } from "react";
import { esc } from "../lib";
import { useCanvasLoop, rotY, sphereDirs, type V3 } from "./spaceCanvas";
import type { Sel } from "../types";

/* "draws one", as an instrument (design-31): the surviving guesses float as a
   cluster, each disc's area the softmax of its REAL logit at the current
   temperature. Drag the dial and watch the odds reshape — at 0 the top disc
   swallows the field (greedy), higher and the also-rans grow a real chance. The
   token actually drawn on this run wears the red ring. Sizes are recomputed live
   from the engine's own logits; the run's own temperature and draw are stated. */

const MAX = 14; // discs shown (top survivors by logit)

export function DrawField({ sel, chosenId }: { sel: Sel; chosenId: number }) {
  const [temp, setTemp] = useState(sel.temp);
  const surv = sel.cand
    .filter((c) => c.cut === "")
    .sort((a, b) => b.logit - a.logit)
    .slice(0, MAX);
  const ready = surv.length > 0;

  const T = Math.max(0.01, temp);
  const mx = surv.length ? Math.max(...surv.map((c) => c.logit)) : 0;
  const exps = surv.map((c) => Math.exp((c.logit - mx) / T));
  const z = exps.reduce((a, b) => a + b, 0) || 1;
  const w = exps.map((e) => e / z);
  const dirs = sphereDirs(surv.length);
  const chosenIdx = surv.findIndex((c) => c.id === chosenId);
  const chosenW = chosenIdx >= 0 ? w[chosenIdx] : 0;
  const chosenTok = chosenIdx >= 0 ? esc(surv[chosenIdx].t) : "";

  const st = { w, dirs, chosenIdx, labels: surv.map((c) => esc(c.t)) };

  const canvas = useCanvasLoop(ready, ({ ctx, W, H, cx, cy, spin }) => {
    const { w: ww, dirs: D, chosenIdx: ci, labels } = st;
    const n = ww.length;
    if (!n) return;
    const scale = Math.min(W, H) * 0.5;
    const proj = (p: V3) => {
      const f = scale / (2.7 - p[2]);
      return { x: cx + p[0] * f, y: cy - p[1] * f, z: p[2] };
    };
    // draw far discs first (painter's order)
    const order = D.map((_, i) => i).sort(
      (a, b) => rotY(D[a], spin)[2] - rotY(D[b], spin)[2],
    );
    for (const i of order) {
      const s = proj(rotY(D[i].map((x) => x * 1.15) as V3, spin));
      const depth = (s.z + 1) / 2;
      const isWin = i === ci;
      const rad = 3 + Math.sqrt(ww[i]) * 46 * (0.6 + 0.5 * depth);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, 7);
      ctx.fillStyle = isWin
        ? `rgba(215,25,33,${0.22 + 0.5 * depth})`
        : `rgba(232,232,232,${(0.06 + 0.14 * depth) + ww[i] * 0.25})`;
      ctx.fill();
      if (isWin) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad + 3, 0, 7);
        ctx.strokeStyle = "rgba(215,25,33,0.95)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // label only the discs big enough to carry one
      if (ww[i] > 0.03 || isWin) {
        ctx.font = `${isWin ? 600 : 400} ${(11 + 3 * depth).toFixed(0)}px ui-monospace, monospace`;
        ctx.fillStyle = isWin ? "rgba(215,25,33,0.95)" : `rgba(232,232,232,${0.4 + 0.4 * depth})`;
        ctx.textAlign = "center";
        ctx.fillText(labels[i], s.x, s.y - rad - 5);
      }
    }
  }, { rotatable: true });

  if (!ready)
    return (
      <div className="fl-status" role="status">
        prompt token — you supplied it, the model did not draw it
      </div>
    );

  return (
    <div className="fl-spacewrap">
      <div className="fl-space">
        <canvas ref={canvas} />
        <div className="fl-space-ov fl-space-ctx">suiron · draws one · temp {temp.toFixed(2)}</div>
        <div className="fl-space-ov fl-space-read">
          at temp {temp.toFixed(2)}, <span className="w">“{chosenTok}”</span> holds{" "}
          <span className="p">{(chosenW * 100).toFixed(0)}%</span> of the odds
        </div>
      </div>
      <div className="fl-temp">
        <span>temp</span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={temp}
          onChange={(e) => setTemp(parseFloat(e.target.value))}
          aria-label="temperature"
        />
        <span className="fl-temp-v">{temp.toFixed(2)}</span>
      </div>
      <div className="fl-space-honest">
        disc area is the softmax of the real logits at this temperature — on this run it drew at temp{" "}
        {sel.temp.toFixed(2)}
        {sel.r == null ? " (greedy — the top by rule)" : `, landing at r = ${sel.r.toFixed(3)}`}
      </div>
    </div>
  );
}
