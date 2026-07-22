import { useAutoplay } from "../autoplay";
import { Stepper } from "./Stepper";
import { useCanvasLoop, REDUCED } from "./spaceCanvas";
import type { Step } from "../types";

/* "the signal", as an instrument (design-31): one running vector threads every
   layer, and its size (RMS) climbs as each layer adds its adjustment. This plots
   the real per-layer RMS as a filled waveform; scrub to walk the layers and
   watch the signal build. Pure render of step.rnorm — the engine's recorded
   magnitudes, nothing computed here. */

export function SignalField({ step }: { step: Step }) {
  const r = step.rnorm ?? [];
  const last = Math.max(0, r.length - 1);
  const { i, playing, setI, toggle } = useAutoplay(last, { stepMs: 120 });
  const ready = r.length >= 2;

  const st = { r, i };

  const canvas = useCanvasLoop(ready, ({ ctx, W, H, t }) => {
    const { r: rn, i: cur } = st;
    const n = rn.length;
    if (n < 2) return;
    const mL = 34;
    const mR = 16;
    const mT = 30;
    const mB = 26;
    const max = Math.max(...rn);
    const min = Math.min(...rn);
    const span = max - min || 1;
    const x = (k: number) => mL + (k / (n - 1)) * (W - mL - mR);
    const y = (v: number) => H - mB - ((v - min) / span) * (H - mT - mB);
    const reveal = REDUCED ? 1 : Math.min(1, t / 0.9); // draw-on
    const shown = 1 + reveal * (n - 1);

    // baseline + faint layer ticks
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mL, H - mB);
    ctx.lineTo(W - mR, H - mB);
    ctx.stroke();

    // filled area under the curve
    ctx.beginPath();
    ctx.moveTo(x(0), H - mB);
    for (let k = 0; k < n && k <= shown; k++) ctx.lineTo(x(k), y(rn[k]));
    ctx.lineTo(x(Math.min(n - 1, shown)), H - mB);
    ctx.closePath();
    ctx.fillStyle = "rgba(215,25,33,0.10)";
    ctx.fill();

    // the line
    ctx.beginPath();
    for (let k = 0; k < n && k <= shown; k++) {
      const px = x(k);
      const py = y(rn[k]);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = "rgba(232,232,232,0.7)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // current-layer guide + marker
    const cx = x(Math.min(cur, n - 1));
    const cy = y(rn[Math.min(cur, n - 1)]);
    ctx.strokeStyle = "rgba(215,25,33,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, mT - 6);
    ctx.lineTo(cx, H - mB);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, 7);
    ctx.fillStyle = "#d71921";
    ctx.fill();

    // endpoint labels
    ctx.font = "400 10px ui-monospace, monospace";
    ctx.fillStyle = "rgba(122,122,122,0.9)";
    ctx.textAlign = "left";
    ctx.fillText(`${min.toFixed(1)}`, 4, H - mB + 4);
    ctx.fillText(`${max.toFixed(1)}`, 4, mT + 2);
  });

  if (!ready) return <div className="fl-status" role="status">no per-layer signal recorded here.</div>;

  const li = Math.min(i, last);
  return (
    <div className="fl-spacewrap">
      <div className="fl-space fl-space-short">
        <canvas ref={canvas} />
        <div className="fl-space-ov fl-space-ctx">suiron · the signal · rms per layer</div>
        <div className="fl-space-ov fl-space-read">
          layer <b className="w">{li}</b> / {last} · rms <span className="p">{r[li]?.toFixed(1)}</span>
        </div>
      </div>
      <div className="fl-space-honest">
        the residual’s real RMS after each layer — {r[0]?.toFixed(1)} at layer 0 climbing to{" "}
        {r[last]?.toFixed(1)} at layer {last}; each layer adds to one running signal
      </div>
      <Stepper i={i} max={last} playing={playing} setI={setI} toggle={toggle} unit="layer" />
    </div>
  );
}
