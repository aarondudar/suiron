import { useState } from "react";
import { useAutoplay } from "../autoplay";
import { headGlance, litToken } from "../lib";
import { Stepper } from "./Stepper";
import { useCanvasLoop } from "./spaceCanvas";
import type { Step, Trace } from "../types";

/* "the sixteen readers", as an instrument (design-31): attention isn't one
   spotlight but sixteen, each head glancing somewhere of its own. One dial per
   head — the needle points at the position it reads hardest (angle = that
   token's place in the sentence), its length that head's real share. Scrub the
   layers and watch the gazes swing. Pure render over the recorded attention
   edges; the one red needle is the layer's strongest read, dim dials are sinks
   (a head that found nothing, parked on the first token). */

export function HeadField({
  trace,
  step,
  prod,
}: {
  trace: Trace;
  step: Step;
  prod: number;
}) {
  const lastLayer = trace.layers - 1;
  const { i: layer, playing, setI, toggle } = useAutoplay(lastLayer, { stepMs: 320 });
  const L = Math.min(layer, lastLayer);
  const heads = step.attn[L] ?? [];
  const nPos = prod + 1;
  const glances = heads.map((edges) => headGlance(edges));

  // the layer's single strongest genuine read (skip sinks) — the only red
  let best = -1;
  for (let h = 0; h < glances.length; h++) {
    const g = glances[h];
    if (!g || (g.topPos === 0 && prod > 3)) continue;
    if (best < 0 || g.share > (glances[best]?.share ?? 0)) best = h;
  }
  const bestG = best >= 0 ? glances[best] : null;
  const bestTok = bestG ? litToken(trace.tokens[bestG.topPos]?.t ?? "") : null;

  // tap a dial to read that head (Aaron's #8): the readout names its target
  const [sel, setSel] = useState<number | null>(null);
  const selG = sel !== null ? glances[sel] : null;
  const selSink = !!selG && selG.topPos === 0 && prod > 3;
  const selTok = selG ? litToken(trace.tokens[selG.topPos]?.t ?? "") : null;

  const st = { glances, best, nPos, prod, sel };

  // dial grid geometry, shared by the draw loop and the tap hit-test
  const grid = (n: number, W: number, H: number) => {
    const cols = n <= 4 ? n : n <= 9 ? 3 : 4;
    const top = 26; // room for the context label
    const bot = 34; // room for the readout
    return { cols, rows: Math.ceil(n / cols), top, cw: W / cols, chh: (H - top - bot) / Math.ceil(n / cols) };
  };

  const canvas = useCanvasLoop(true, ({ ctx, W, H }) => {
    const { glances: gs, best: bi, nPos: np, prod: pd, sel: si } = st;
    const n = gs.length;
    if (!n) return;
    const { cols, top, cw, chh } = grid(n, W, H);
    const cellR = Math.min(cw, chh) * 0.3;
    for (let h = 0; h < n; h++) {
      const cx = (h % cols + 0.5) * cw;
      const cy = top + (Math.floor(h / cols) + 0.5) * chh;
      const isSel = h === si;
      // dial ring (lit when tapped)
      ctx.beginPath();
      ctx.arc(cx, cy, cellR, 0, 7);
      ctx.strokeStyle = isSel ? "#7a7a7a" : "#1b1b1b";
      ctx.lineWidth = isSel ? 1.4 : 1;
      ctx.stroke();
      const g = gs[h];
      const sink = !!g && g.topPos === 0 && pd > 3;
      const isBest = h === bi;
      // needle → the head's strongest source position, mapped around the dial
      if (g) {
        const ang = -Math.PI / 2 + (g.topPos / Math.max(1, np)) * Math.PI * 2;
        const len = cellR * (0.32 + 0.68 * g.share);
        const tx = cx + Math.cos(ang) * len;
        const ty = cy + Math.sin(ang) * len;
        const col = isBest ? "215,25,33" : "232,232,232";
        const a = isSel ? 0.95 : sink ? 0.16 : isBest ? 0.95 : 0.3 + g.share * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = `rgba(${col},${a})`;
        ctx.lineWidth = isBest || isSel ? 2 : 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, isBest || isSel ? 3.4 : 2.2, 0, 7);
        ctx.fillStyle = `rgba(${col},${a})`;
        ctx.fill();
      }
      // hub + head index
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6, 0, 7);
      ctx.fillStyle = "#5a5a5a";
      ctx.fill();
      ctx.font = `${isSel ? 600 : 400} 9px ui-monospace, monospace`;
      ctx.fillStyle = isSel ? "rgba(232,232,232,0.9)" : "rgba(122,122,122,0.8)";
      ctx.textAlign = "center";
      ctx.fillText(`h${h}`, cx, cy + cellR + 11);
    }
  });

  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const n = glances.length;
    if (!n) return;
    const { cols, rows, top, cw, chh } = grid(n, rect.width, rect.height);
    const col = Math.floor((e.clientX - rect.left) / cw);
    const row = Math.floor((e.clientY - rect.top - top) / chh);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    const h = row * cols + col;
    if (h >= n) return;
    setSel(sel === h ? null : h);
  };

  return (
    <div className="fl-spacewrap">
      <div className="fl-space fl-space-tall">
        <canvas ref={canvas} onClick={tap} style={{ cursor: "pointer" }} />
        <div className="fl-space-ov fl-space-ctx">suiron · 16 readers · layer {L}</div>
        <div className="fl-space-ov fl-space-read">
          {sel !== null ? (
            selG && selTok ? (
              <>
                head {sel} → {selSink ? <>the sink — found nothing worth fetching</> : (
                  <>
                    <span className="w">“{selTok.text}”</span>{" "}
                    <span className="p">{(selG.share * 100).toFixed(0)}%</span> of its attention
                  </>
                )}
              </>
            ) : (
              <>head {sel} — no recorded read at this layer</>
            )
          ) : bestG && bestTok ? (
            <>
              strongest: <span className="w">head {best}</span> →{" "}
              <span className="w">“{bestTok.text}”</span>{" "}
              <span className="p">{(bestG.share * 100).toFixed(0)}%</span>
            </>
          ) : (
            <>this layer: every head on the sink</>
          )}
        </div>
      </div>
      <div className="fl-space-honest">
        each needle points at the position that head reads hardest, its length the head’s real share
        of attention — dim dials are sinks (found nothing to fetch). tap a dial to read that head.
      </div>
      <Stepper i={layer} max={lastLayer} playing={playing} setI={setI} toggle={toggle} unit="layer" />
    </div>
  );
}
