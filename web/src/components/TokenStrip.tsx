import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { confColor, confidence, esc } from "../lib";
import type { Step, Trace } from "../types";

export function TokenStrip({
  trace,
  step,
  cur,
  setCur,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  setCur: (i: number) => void;
}) {
  const [arcs, setArcs] = useState(true);
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setTick] = useState(0); // reflow arcs on resize

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    drawArcs(canvasRef.current, stripRef.current, trace, step, cur, arcs);
  });

  return (
    <section>
      <div className="label">
        <span className="idx">01</span>
        tokens — click or ←/→ to step · brightness = model's confidence
        <span className="note">
          {" "}— each cell is one token (byte-level BPE). dim borders = your prompt, dotted
          underline = generated. faded text = the model was unsure when it picked that token
          (hover for the probability). arcs show where the current token's attention reaches.
        </span>
        <label className="arc-toggle">
          <input type="checkbox" checked={arcs} onChange={(e) => setArcs(e.target.checked)} /> arcs
        </label>
      </div>
      <div className="strip" ref={stripRef}>
        <canvas className="arc-layer" ref={canvasRef} />
        {trace.tokens.map((tok, i) => {
          const conf = confidence(trace, i);
          const isCur = i === cur;
          return (
            <span
              key={i}
              className={"tok" + (i >= trace.n_prompt ? " gen" : "") + (isCur ? " cur" : "")}
              style={!isCur && conf !== null ? { color: confColor(conf) } : undefined}
              title={
                `id ${tok.id} · pos ${i}` +
                (conf !== null ? ` · p ${(conf * 100).toFixed(1)}%` : " · prompt")
              }
              onClick={() => setCur(i)}
            >
              {esc(tok.t)}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** Bezier arcs from the current token to its strongest attention targets,
 *  aggregated over all layers and heads. Strongest arc is red. */
function drawArcs(
  canvas: HTMLCanvasElement | null,
  strip: HTMLDivElement | null,
  trace: Trace,
  step: Step,
  cur: number,
  enabled: boolean,
) {
  if (!canvas || !strip) return;
  const dpr = window.devicePixelRatio || 1;
  const w = strip.clientWidth;
  const h = strip.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (!enabled || cur === 0 || !step.attn.length) return;

  // aggregate attention mass over every layer and head
  const weight = new Map<number, number>();
  for (const layer of step.attn)
    for (const head of layer)
      for (const [p, v] of head) {
        if (p < cur) weight.set(p, (weight.get(p) ?? 0) + v);
      }
  const top = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return;
  const max = top[0][1];

  const cells = strip.querySelectorAll<HTMLSpanElement>(".tok");
  const anchor = (i: number) => {
    const c = cells[i];
    return c ? { x: c.offsetLeft + c.offsetWidth / 2, y: c.offsetTop + 1 } : null;
  };
  const from = anchor(cur);
  if (!from) return;

  for (const [p, v] of [...top].reverse()) {
    const to = anchor(p);
    if (!to) continue;
    const t = v / max;
    const lift = 14 + 26 * t + Math.min(40, Math.abs(from.x - to.x) * 0.06);
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) - lift, to.x, to.y);
    g.strokeStyle = t === 1 ? "#d71921" : "#e8e8e8";
    g.globalAlpha = t === 1 ? 0.95 : 0.12 + 0.45 * t;
    g.lineWidth = 0.5 + 2.2 * t;
    g.stroke();
  }
  g.globalAlpha = 1;
}
