import { useEffect, useRef } from "react";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* The shared space backdrop (design-31): one subtle drifting starfield behind
   the whole app, giving the sci-fi ground the re-skin sits on. Deliberately
   barely-there — a backdrop, not a feature; readability wins every time.
   Static under reduced-motion. Pure Canvas, no deps. */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let W = 0,
      H = 0,
      raf = 0,
      t = 0;
    type Star = { x: number; y: number; r: number; a: number; ph: number; vx: number; vy: number };
    let stars: Star[] = [];
    const seed = () => {
      const n = Math.min(560, Math.round((W * H) / 3400));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.4 + Math.random() * 1.3,
        a: 0.05 + Math.random() * 0.32,
        ph: Math.random() * 6.28,
        vx: (Math.random() - 0.5) * 0.05,
        vy: (Math.random() - 0.5) * 0.05,
      }));
    };
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        if (!REDUCED) {
          s.x += s.vx;
          s.y += s.vy;
          if (s.x < 0) s.x += W;
          else if (s.x > W) s.x -= W;
          if (s.y < 0) s.y += H;
          else if (s.y > H) s.y -= H;
        }
        const tw = REDUCED ? 1 : 0.55 + 0.45 * Math.sin(t + s.ph);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fillStyle = `rgba(200,206,214,${s.a * tw})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
