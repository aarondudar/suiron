import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  prod,
  setCur,
  focus,
  card,
  dim,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  /** the producing position (cur-1): the read-head whose forward pass produced
   *  `cur`. -1 at the seed (the first token, which nothing produced). */
  prod: number;
  setCur: (i: number) => void;
  /** the one thing the lab is lighting up (hover, the open Explainer, or a
   *  programmatic writer); this band reacts to the foci that touch tokens. */
  focus: FocusTarget;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
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
  // A token was PRODUCED by the forward pass at the previous position, so its
  // sources come from steps[pos-1] (the pass that read the earlier tokens).
  const srcPos = hoverTok ?? focusTok ?? (narrow ? cur : null);
  const sources =
    srcPos != null && srcPos > 0 ? attnSources(trace.steps[srcPos - 1], srcPos) : [];
  const srcSet = new Set(sources.map((s) => s.pos));
  const topSrc = sources[0]?.pos;

  useLayoutEffect(() => {
    // arcs are a desktop affordance; on narrow screens the inline source tint
    // replaces them (Bezier fans across wrapped lines read as noise on a phone)
    drawArcs(canvasRef.current, stripRef.current, step, cur, prod, arcs && !narrow, !narrow, focusLayer);
  });

  return (
    <section className={dim ? "dimmed" : undefined}>
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
      {card}
      <div className="strip" ref={stripRef} onMouseLeave={() => setHoverTok(null)}>
        <canvas className="arc-layer" ref={canvasRef} />
        {trace.tokens.map((tok, i) => {
          const conf = confidence(trace, i);
          const isCur = i === cur;
          const isProd = i === prod && prod >= 0;
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
                (isProd ? " prod" : "") +
                (srcSet.has(i) ? (i === topSrc ? " src-top" : " src") : "") +
                (candId !== null && tok.id === candId ? " cand-match" : "")
              }
              style={!isCur && conf !== null ? { color: confColor(conf) } : undefined}
              title={
                `id ${tok.id} · pos ${i}` +
                (isProd ? " · read head (produced the inspected token)" : "") +
                (conf !== null ? ` · p ${(conf * 100).toFixed(1)}%` : " · prompt")
              }
              onClick={() => setCur(i)}
              onMouseEnter={() => setHoverTok(i)}
            >
              {isProd && <i className="tok-readhead">read head</i>}
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

/** The producing edge: a short dim connector from the read-head (prod) to the
 *  token it produced (cur), plus Bezier arcs from the read-head back to the
 *  earlier tokens it attended to (aggregated over all layers and heads, or one
 *  layer when a stack row is hovered). Strongest arc is red. The connector is
 *  drawn whenever there is room (desktop), independent of the arcs toggle. */
function drawArcs(
  canvas: HTMLCanvasElement | null,
  strip: HTMLDivElement | null,
  step: Step,
  cur: number,
  prod: number,
  enabled: boolean,
  showConnector: boolean,
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

  const cells = strip.querySelectorAll<HTMLSpanElement>(".tok");
  const anchor = (i: number) => {
    const c = cells[i];
    return c ? { x: c.offsetLeft + c.offsetWidth / 2, y: c.offsetTop + 1 } : null;
  };

  // the producing edge: read-head (prod) → produced token (cur). Dim, with a
  // small arrowhead at cur. Shown on desktop regardless of the arcs toggle.
  if (showConnector && prod >= 0 && prod !== cur) {
    const a = anchor(prod);
    const b = anchor(cur);
    if (a && b) {
      const midY = Math.min(a.y, b.y) - 10;
      g.strokeStyle = "#6a6a6a";
      g.fillStyle = "#6a6a6a";
      g.globalAlpha = 0.75;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + b.x) / 2, midY, b.x, b.y);
      g.stroke();
      // arrowhead pointing into cur
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - 4, b.y - 5);
      g.lineTo(b.x + 4, b.y - 5);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
  }

  // arcs need a producing pass (none at the seed) and the arcs affordance on
  if (!enabled || prod < 0 || !step.attn.length) return;

  // aggregate attention mass at the read-head (prod) — all layers, or just the
  // hovered one. Exclude prod itself (the self/diagonal).
  const layers =
    focusLayer !== null && step.attn[focusLayer] ? [step.attn[focusLayer]] : step.attn;
  const weight = new Map<number, number>();
  for (const layer of layers)
    for (const head of layer)
      for (const [p, v] of head) {
        if (p <= prod && p !== prod) weight.set(p, (weight.get(p) ?? 0) + v);
      }
  if (!weight.size) return;

  // the attention sink (token 0) dominates any aggregate — show it as a
  // dashed ghost so the red arc can point at the strongest REAL target
  const sink = prod > 3 ? (weight.get(0) ?? 0) : 0;
  if (prod > 3) weight.delete(0);
  let top = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length && sink > 0) top = [[0, sink]]; // nothing but the sink
  if (!top.length) return;
  const max = top[0][1];

  const from = anchor(prod);
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
