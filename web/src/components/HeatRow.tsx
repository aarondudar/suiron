import { useEffect, useRef } from "react";

const CELL = 9;

/* One layer's attention across the positions, as a contiguous row of cells.
   Stacked, consecutive rows form the band's real picture: layers down, token
   positions across, brightness the weight — both axes carrying a real quantity.

   It was a row of separated dots, which meant band 02 rendered depth as 28
   detached strips beside 28 near-identical sentences ("→ 'The' 81% sink",
   twenty-five times). The information was all there and none of it was legible
   as a shape. Cells that touch turn the same numbers into a picture where the
   sink column visibly ignites a few layers in (2026-08-14).

   Brightness is linear in the weight, with a floor so a position that was
   attended a little is distinguishable from one that was not attended at all.
   No perceptual curve: a bright cell means a big number. */
export function HeatRow({
  weights,
  nPos,
  h = 12,
}: {
  weights: number[];
  nPos: number;
  /** row height; the layer rows abut at this height to form the grid */
  h?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = nPos * CELL;
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
      const v = weights[p] ?? 0;
      if (v <= 0.004) {
        g.fillStyle = "#0d0d0d"; // attended nothing: the grid's ground
      } else if (p === maxI) {
        g.fillStyle = "#d71921"; // this layer's strongest read
      } else {
        g.fillStyle = `rgba(232, 232, 232, ${Math.min(1, 0.12 + v * 0.88)})`;
      }
      g.fillRect(p * CELL, 0, CELL - 1, h);
    }
  }, [weights, nPos, h]);

  return <canvas ref={ref} />;
}
