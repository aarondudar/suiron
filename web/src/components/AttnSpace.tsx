import { esc } from "../lib";
import { useCanvasLoop, REDUCED } from "./spaceCanvas";
import type { Trace } from "../types";

/* "looks back", as an instrument (design-31): the current word's vector sits
   where its context pulls it. Each earlier token is a point on the ring; the
   line to the centre is a real attention pull (summed over every layer and head
   at this position), and the red vector rests at the attention-weighted centroid
   — literally assembled from the words it attends to. Positions on the ring are
   reading-order layout; the pull strengths are the engine's real numbers. */

export function AttnSpace({ trace, prod }: { trace: Trace; prod: number }) {
  const step = prod > 1 ? trace.steps[prod] : undefined; // need ≥1 earlier non-sink token
  const ready = !!step && !!step.attn?.length;

  // aggregate attention over all layers + heads → one weight per EARLIER content
  // position (1..prod-1). Two exclusions so the demo actually teaches "gathering
  // meaning": self-attention (looks BACK), and the first-token sink — the spare
  // attention every model parks on token 0, which otherwise drowns out the real
  // semantic pulls. The sink is called out in the caption, not hidden.
  let weights: number[] = [];
  let labels: string[] = [];
  let strongest = { i: -1, w: 0 };
  const curTok = step ? esc(trace.tokens[prod].t) : "";
  if (step) {
    const cnt = Math.max(0, prod - 1); // positions 1..prod-1
    const w = new Array(cnt).fill(0);
    for (const layer of step.attn)
      for (const head of layer)
        for (const [src, wt] of head) if (src >= 1 && src < prod) w[src - 1] += wt;
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    weights = w.map((x) => x / tot);
    labels = trace.tokens.slice(1, prod).map((t) => esc(t.t));
    weights.forEach((x, i) => {
      if (x > strongest.w) strongest = { i, w: x };
    });
  }

  const st = { weights, labels, cur: curTok };

  const canvas = useCanvasLoop(ready, ({ ctx, W, H, cx, cy, t }) => {
    const { weights: w, labels: lab, cur } = st;
    const n = w.length;
    if (!n) return;
    const R = Math.min(W, H) * 0.34;
    const ease = REDUCED ? 1 : Math.min(1, t / 1.1);

    // ring positions (reading order, starting at top)
    const pos = w.map((_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
    });
    // the attention-weighted centroid (where the pulls place the vector)
    let vx = cx,
      vy = cy;
    let sx = 0,
      sy = 0;
    for (let i = 0; i < n; i++) {
      sx += pos[i].x * w[i];
      sy += pos[i].y * w[i];
    }
    vx = cx + (sx - cx) * ease;
    vy = cy + (sy - cy) * ease;

    // pull lines (strength = real weight)
    for (let i = 0; i < n; i++) {
      const hot = i === strongest.i;
      ctx.beginPath();
      ctx.moveTo(pos[i].x, pos[i].y);
      ctx.lineTo(vx, vy);
      ctx.strokeStyle = hot ? `rgba(215,25,33,${0.5 * ease})` : `rgba(232,232,232,${0.06 + w[i] * 0.5 * ease})`;
      ctx.lineWidth = 0.6 + w[i] * 6;
      ctx.stroke();
    }

    // source dots + labels
    for (let i = 0; i < n; i++) {
      const hot = i === strongest.i;
      const lit = 0.32 + w[i] * 0.68;
      ctx.beginPath();
      ctx.arc(pos[i].x, pos[i].y, 2.6 + w[i] * 9, 0, 7);
      ctx.fillStyle = hot ? "#d71921" : `rgba(232,232,232,${lit})`;
      ctx.fill();
      // label leans inward (toward centre) so it never clips off the frame edge
      const left = pos[i].x < cx;
      ctx.font = `${hot ? 600 : 400} 12px ui-monospace, monospace`;
      ctx.fillStyle = hot ? "rgba(215,25,33,0.95)" : `rgba(232,232,232,${0.3 + lit * 0.5})`;
      ctx.textAlign = left ? "left" : "right";
      ctx.fillText(lab[i], pos[i].x + (left ? 9 : -9), pos[i].y + 4);
    }

    // the current vector, pulled to the centroid
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(vx, vy);
    ctx.strokeStyle = "rgba(215,25,33,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, 7);
    ctx.fillStyle = "#5a5a5a";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(vx, vy, 6, 0, 7);
    ctx.fillStyle = "#d71921";
    ctx.fill();
    // the current token label rides just above its pulled vector
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.fillStyle = "rgba(232,232,232,0.92)";
    ctx.textAlign = "left";
    ctx.fillText(cur, vx + 9, vy + 4);
  });

  if (!ready)
    return (
      <div className="fl-status" role="status">
        {prod <= 1
          ? "nothing earlier to look back at yet — this is the very start of the sentence."
          : "reading the attention weights…"}
      </div>
    );

  return (
    <div className="fl-spacewrap">
      <div className="fl-space">
        <canvas ref={canvas} />
        <div className="fl-space-ov fl-space-ctx">suiron · looks back · attention</div>
        <div className="fl-space-ov fl-space-read">
          strongest pull:{" "}
          <span className="w">“{labels[strongest.i] ?? ""}”</span>{" "}
          <span className="p">{(strongest.w * 100).toFixed(0)}%</span> of the attention
        </div>
      </div>
      <div className="fl-space-honest">
        the ring is the earlier words — each pull’s strength is the real attention weight, summed
        over all {trace.layers} layers and {trace.heads} heads. the first-token “sink” (spare
        attention every model parks on word 1) is set aside so the meaning-carrying pulls show.
      </div>
    </div>
  );
}
