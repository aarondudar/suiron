import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { attnSources, confBar, confColor, confidence, esc } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { FocusTarget, Step, Trace } from "../types";

const NARROW = "(max-width: 640px)";

export function TokenStrip({
  trace,
  step,
  cur,
  setCur,
  focus,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  setCur: (i: number) => void;
  /** the one thing the lab is lighting up (hover, the open Explainer, or a
   *  programmatic writer); this band reacts to the foci that touch tokens. */
  focus: FocusTarget;
}) {
  // unpack the foci this band visualizes
  const focusLayer = focus.kind === "layer" ? focus.layer : null;
  const candId = focus.kind === "candidate" ? focus.id : null;
  const focusTok = focus.kind === "token" ? focus.pos : null;
  const [arcs, setArcs] = useState(true);
  const [hoverTok, setHoverTok] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setTick] = useState(0); // reflow arcs on resize

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    const mq = window.matchMedia(NARROW);
    const onMq = () => setNarrow(mq.matches);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  // which token's attention sources to highlight inline: the hovered one, or —
  // on a phone, where arcs are off and there's no hover — the current token.
  const srcPos = hoverTok ?? focusTok ?? (narrow ? cur : null);
  const sources = srcPos != null && srcPos > 0 ? attnSources(trace.steps[srcPos], srcPos) : [];
  const srcSet = new Set(sources.map((s) => s.pos));
  const topSrc = sources[0]?.pos;

  useLayoutEffect(() => {
    // arcs are a desktop affordance; on narrow screens the inline source tint
    // replaces them (Bezier fans across wrapped lines read as noise on a phone)
    drawArcs(canvasRef.current, stripRef.current, step, cur, arcs && !narrow, focusLayer);
  });

  return (
    <section>
      <BandHeader
        idx="01"
        title={<Explain of="tokenization">tokens</Explain>}
        sub={SUB.tokens}
      >
        <Explain of="confidence" label="confidence" />
        <Explain of="loop" label="loop" />
        <label className="arc-toggle">
          <input type="checkbox" checked={arcs} onChange={(e) => setArcs(e.target.checked)} /> arcs
        </label>
      </BandHeader>
      {trace.fork && (
        <div className="fork-note">
          ⑂ forked at {trace.fork.pos} · before:{" "}
          <span className="fork-prev">{trace.fork.prev.slice(0, 120) || "(nothing)"}</span>
        </div>
      )}
      <div className="strip" ref={stripRef} onMouseLeave={() => setHoverTok(null)}>
        <canvas className="arc-layer" ref={canvasRef} />
        {trace.tokens.map((tok, i) => {
          const conf = confidence(trace, i);
          const isCur = i === cur;
          const forced = trace.steps[i]?.sel?.forced;
          return (
            <span
              key={i}
              data-explain-el={"token-" + i}
              className={
                "tok" +
                (i >= trace.n_prompt || forced ? " gen" : "") +
                (forced ? " forced" : "") +
                (isCur ? " cur" : "") +
                (srcSet.has(i) ? (i === topSrc ? " src-top" : " src") : "") +
                (candId !== null && tok.id === candId ? " cand-match" : "")
              }
              style={!isCur && conf !== null ? { color: confColor(conf) } : undefined}
              title={
                `id ${tok.id} · pos ${i}` +
                (conf !== null ? ` · p ${(conf * 100).toFixed(1)}%` : " · prompt")
              }
              onClick={() => setCur(i)}
              onMouseEnter={() => setHoverTok(i)}
            >
              {esc(tok.t)}
              {conf !== null && (
                <i className="conf-bar" style={{ width: `${confBar(conf) * 100}%` }} />
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** Bezier arcs from the current token to its strongest attention targets,
 *  aggregated over all layers and heads — or just one layer when a stack
 *  row is hovered. Strongest arc is red. */
function drawArcs(
  canvas: HTMLCanvasElement | null,
  strip: HTMLDivElement | null,
  step: Step,
  cur: number,
  enabled: boolean,
  focusLayer: number | null,
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

  // aggregate attention mass — all layers, or just the hovered one
  const layers =
    focusLayer !== null && step.attn[focusLayer] ? [step.attn[focusLayer]] : step.attn;
  const weight = new Map<number, number>();
  for (const layer of layers)
    for (const head of layer)
      for (const [p, v] of head) {
        if (p < cur) weight.set(p, (weight.get(p) ?? 0) + v);
      }
  if (!weight.size) return;

  // the attention sink (token 0) dominates any aggregate — show it as a
  // dashed ghost so the red arc can point at the strongest REAL target
  const sink = cur > 3 ? (weight.get(0) ?? 0) : 0;
  if (cur > 3) weight.delete(0);
  let top = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length && sink > 0) top = [[0, sink]]; // nothing but the sink
  if (!top.length) return;
  const max = top[0][1];

  const cells = strip.querySelectorAll<HTMLSpanElement>(".tok");
  const anchor = (i: number) => {
    const c = cells[i];
    return c ? { x: c.offsetLeft + c.offsetWidth / 2, y: c.offsetTop + 1 } : null;
  };
  const from = anchor(cur);
  if (!from) return;

  const arc = (to: { x: number; y: number }, lift: number) => {
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) - lift, to.x, to.y);
    g.stroke();
  };

  if (sink > 0) {
    const to = anchor(0);
    if (to) {
      g.setLineDash([3, 5]);
      g.strokeStyle = "#e8e8e8";
      g.globalAlpha = 0.18;
      g.lineWidth = 1;
      arc(to, 10 + Math.min(40, Math.abs(from.x - to.x) * 0.06));
      g.setLineDash([]);
    }
  }

  for (const [p, v] of [...top].reverse()) {
    const to = anchor(p);
    if (!to) continue;
    const t = v / max;
    g.strokeStyle = t === 1 ? "#d71921" : "#e8e8e8";
    g.globalAlpha = t === 1 ? 0.95 : 0.12 + 0.45 * t;
    g.lineWidth = 0.5 + 2.2 * t;
    arc(to, 14 + 26 * t + Math.min(40, Math.abs(from.x - to.x) * 0.06));
  }
  g.globalAlpha = 1;
}
