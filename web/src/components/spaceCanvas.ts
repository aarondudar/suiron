import { useEffect, useRef } from "react";

/* Shared plumbing for the design-31 "instrument" visuals: a DPR-correct canvas
   with one rAF loop that survives late layout (re-measures until the element has
   a real size), a slow spin for depth, and a clear each frame. Each visual just
   supplies a draw(frame) that reads its own live state ref — the loop never
   restarts, so scrubbing/animating stays smooth. */

export const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export type V3 = [number, number, number];

export interface Frame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  cx: number;
  cy: number;
  spin: number;
  t: number; // seconds since the loop started
}

export function useCanvasLoop(ready: boolean, draw: (f: Frame) => void) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas?.getContext("2d");
    if (!ready || !canvas || !ctx) return;
    let raf = 0;
    let spin = 0;
    let t0 = 0;
    let W = 0;
    let H = 0;
    let cx = 0;
    let cy = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2;
    };
    resize();
    window.addEventListener("resize", resize);
    const frame = (ms: number) => {
      if (!t0) t0 = ms;
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
      if (!REDUCED) spin += 0.0022;
      ctx.clearRect(0, 0, W, H);
      drawRef.current({ ctx, W, H, cx, cy, spin, t: (ms - t0) / 1000 });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [ready]);
  return cv;
}

/** rotate a point about the Y axis (for the pseudo-3D depth spin) */
export const rotY = (p: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

/** even, deterministic unit directions on a sphere (fibonacci) — the illustrative
 *  layout the data travels through */
export function sphereDirs(n: number): V3[] {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const out: V3[] = [];
  for (let k = 0; k < n; k++) {
    const y = n === 1 ? 0 : 0.85 - (k / (n - 1)) * 1.7;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * k;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}
