import { useRef } from "react";
import { esc } from "../lib";
import { useCanvasLoop, REDUCED } from "./spaceCanvas";
import type { Trace } from "../types";

/* "loops", as an instrument (design-31): pull back and the whole run is a chain
   — each token a link that ran the entire machine, the newest drawn one still
   glowing red, then an arrow curving back: repeat. Click any link to open how it
   was made (back on "looks back"). Nothing computed here — it's the real token
   sequence laid out as the loop it is. */

export function LoopChain({
  trace,
  frontier,
  onPick,
}: {
  trace: Trace;
  frontier: number;
  onPick: (i: number) => void;
}) {
  const toks = trace.tokens.slice(0, frontier + 1);
  const ready = toks.length > 0;
  const nPrompt = trace.n_prompt;
  const pos = useRef<{ x: number; y: number }[]>([]);

  const st = { labels: toks.map((t) => esc(t.t)), nPrompt, last: frontier };

  const canvas = useCanvasLoop(ready, ({ ctx, W, H, cx, cy, t }) => {
    const { labels, nPrompt: np, last } = st;
    const n = labels.length;
    if (!n) return;
    const mL = 40;
    const span = W - mL * 2;
    const amp = Math.min(26, H * 0.12);
    const P: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? cx : mL + (i / (n - 1)) * span;
      const y = cy - 6 + (REDUCED ? 0 : Math.sin(i * 0.7 + t * 0.6) * amp);
      P.push({ x, y });
    }
    pos.current = P;

    // links between consecutive tokens (generation direction →)
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(P[i - 1].x, P[i - 1].y);
      ctx.lineTo(P[i].x, P[i].y);
      ctx.strokeStyle = "rgba(232,232,232,0.16)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // loop-back arrow from the last link, curving over the top: "repeat"
    if (n >= 2) {
      const a = P[n - 1];
      const b = P[Math.max(0, n - 2)];
      const topY = Math.min(...P.map((p) => p.y)) - amp - 16;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(a.x + 40, topY, b.x - 40, topY, b.x, b.y);
      ctx.strokeStyle = REDUCED ? "rgba(215,25,33,0.4)" : `rgba(215,25,33,${0.28 + 0.12 * Math.sin(t * 2)})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "rgba(215,25,33,0.7)";
      ctx.font = "400 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("↻ repeat", (a.x + b.x) / 2, topY - 4);
    }

    // nodes + labels (prompt dim, drawn brighter, newest red)
    for (let i = 0; i < n; i++) {
      const isNew = i === last;
      const isDrawn = i >= np;
      const r = isNew ? 6 : 3.6;
      ctx.beginPath();
      ctx.arc(P[i].x, P[i].y, r, 0, 7);
      ctx.fillStyle = isNew ? "#d71921" : isDrawn ? "rgba(232,232,232,0.85)" : "rgba(232,232,232,0.4)";
      ctx.fill();
      if (isNew && !REDUCED) {
        const pulse = 6 + 4 * Math.sin(t * 5);
        ctx.beginPath();
        ctx.arc(P[i].x, P[i].y, pulse + 6, 0, 7);
        ctx.strokeStyle = `rgba(215,25,33,${0.3 - 0.02 * pulse})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      const below = i % 2 === 1;
      ctx.font = `${isNew ? 600 : 400} 12px ui-monospace, monospace`;
      ctx.fillStyle = isNew
        ? "rgba(215,25,33,0.95)"
        : `rgba(232,232,232,${isDrawn ? 0.8 : 0.45})`;
      ctx.textAlign = "center";
      ctx.fillText(labels[i], P[i].x, P[i].y + (below ? 20 : -12));
    }
  });

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bd = 18 * 18;
    pos.current.forEach((p, i) => {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) onPick(best);
  };

  if (!ready) return null;

  return (
    <div className="fl-spacewrap">
      <div className="fl-space">
        <canvas ref={canvas} onClick={click} style={{ cursor: "pointer" }} />
        <div className="fl-space-ov fl-space-ctx">suiron · loops · the sentence so far</div>
        <div className="fl-space-ov fl-space-read">click any link to see how it was made</div>
      </div>
      <div className="fl-space-honest">
        {trace.n_prompt} of your tokens + {frontier + 1 - trace.n_prompt} drawn — each link ran the
        whole machine to make the next
      </div>
    </div>
  );
}
