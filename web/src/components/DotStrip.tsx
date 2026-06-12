import { useEffect, useRef } from "react";

const CELL = 9;
const R_MAX = 3.4;

/** One row of attention dots: magnitude = dot size, strongest = red. */
export function DotStrip({ weights, nPos }: { weights: number[]; nPos: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = nPos * CELL;
    const h = 14;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);

    let maxI = 0;
    for (let p = 0; p < nPos; p++) if (weights[p] > weights[maxI]) maxI = p;

    for (let p = 0; p < nPos; p++) {
      const v = weights[p];
      if (v <= 0.004) {
        g.fillStyle = "#1c1c1c";
        g.fillRect(p * CELL + CELL / 2, h / 2, 1, 1);
        continue;
      }
      const r = Math.max(0.8, Math.sqrt(v) * R_MAX);
      g.beginPath();
      g.arc(p * CELL + CELL / 2, h / 2, r, 0, 7);
      g.fillStyle = p === maxI ? "#d71921" : "#e8e8e8";
      g.globalAlpha = p === maxI ? 1 : Math.min(1, 0.35 + v);
      g.fill();
      g.globalAlpha = 1;
    }
  }, [weights, nPos]);

  return <canvas ref={ref} />;
}
