import { useEffect, useRef } from "react";
import { useAutoplay } from "../autoplay";
import { esc, settledSeq } from "../lib";
import { useLens } from "./Geometry";
import { Stepper } from "./Stepper";
import type { Step, Trace } from "../types";

/* "sharpens", reimagined as an instrument (design-31): the flat logit-lens bars
   become one space of word-directions with a single traveling vector that swings
   and LOCKS onto the winner as you climb the layers.

   Faithful, not decorative: the vector is the real probability-weighted sum of
   the candidate directions at the current layer (Σ pₖ·dirₖ), read live from the
   same getLens primitive the bars used — so the layer, the word it points at,
   the %, and the lock-on layer are all the engine's real numbers. Only the words'
   fixed positions on the sphere are an illustration (labelled as such); the
   motion is the data. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
type V3 = [number, number, number];
const K = 7; // candidates tracked (final layer's top-K)

/** deterministic, evenly-spread unit directions (fibonacci sphere) — the fixed
 *  illustrative layout the vector travels through */
function sphereDirs(n: number): V3[] {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const out: V3[] = [];
  for (let k = 0; k < n; k++) {
    const y = n === 1 ? 0 : 0.85 - (k / (n - 1)) * 1.7; // spread ~[-0.85, 0.85]
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * k;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

export function LensSpace({
  trace,
  prod,
  prodStep,
}: {
  trace: Trace;
  prod: number;
  prodStep: Step;
}) {
  const lens = useLens(prod, true, settledSeq(trace));
  const last = lens ? lens.layers.length - 1 : 0;
  const ready = !!(lens && lens.layers.length); // the canvas only mounts once data lands
  const { i, playing, setI, toggle } = useAutoplay(last, { stepMs: 150 });

  // climb once when the data lands; reduced-motion starts on the finished state
  const started = useRef(false);
  useEffect(() => {
    if (!lens || started.current || REDUCED) return;
    started.current = true;
    toggle();
  }, [lens, toggle]);

  const cv = useRef<HTMLCanvasElement>(null);
  // everything the draw loop needs, refreshed each render (so one rAF loop can
  // read live state without restarting)
  const st = useRef<{
    dirs: V3[];
    labels: string[];
    probs: number[]; // per-candidate prob at the current layer
    winner: number; // index of the final winner among the K
    argmax: number; // index of the current top among the K (-1 if none tracked)
    locked: boolean;
  }>({ dirs: [], labels: [], probs: [], winner: 0, argmax: -1, locked: false });

  // per-render: derive the real numbers for the current layer
  let atLayer = 0;
  let lastLayer = 0;
  let readWord = "";
  let readP = 0;
  let leadLayer: number | null = null;
  let agrees = false;
  let winTok = "";
  let done = false;
  if (lens && lens.layers.length) {
    const at = lens.layers[Math.min(i, last)];
    const rows = lens.layers[last].top.slice(0, K);
    const dirs = sphereDirs(rows.length);
    const probOf = (id: number) => at.top.find(([tid]) => tid === id)?.[2] ?? 0;
    const probs = rows.map((r) => probOf(r[0]));
    let argmax = -1;
    let amax = 0;
    probs.forEach((p, k) => {
      if (p > amax) {
        amax = p;
        argmax = k;
      }
    });
    const winner = 0; // rows are the final layer sorted → [0] is the winner
    const winnerId = rows[0]?.[0];
    const leadIdx = winnerId != null ? lens.layers.findIndex((L) => L.top[0]?.[0] === winnerId) : -1;
    leadLayer = leadIdx >= 0 ? lens.layers[leadIdx].layer : null;
    const locked = leadIdx >= 0 && i >= leadIdx;

    st.current = { dirs, labels: rows.map((r) => esc(r[1])), probs, winner, argmax, locked };

    atLayer = at.layer;
    lastLayer = lens.layers[last].layer;
    const curTop = at.top[0];
    readWord = esc(curTop?.[1] ?? "");
    readP = curTop?.[2] ?? 0;
    winTok = esc(rows[0]?.[1] ?? "");
    const engineTop = prodStep.top?.[0];
    agrees = !!rows[0] && !!engineTop && rows[0][0] === engineTop[0];
    done = i >= last;
  }

  // one rAF loop for spin + depth; reads st.current so it never restarts. Runs
  // once the data (and therefore the canvas) is in the DOM.
  useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas?.getContext("2d");
    if (!ready || !canvas || !ctx) return;
    let raf = 0;
    let spin = 0;
    let W = 0,
      H = 0,
      cx = 0,
      cy = 0;
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

    const rotY = (p: V3, a: number): V3 => {
      const c = Math.cos(a),
        s = Math.sin(a);
      return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    };
    const scale = () => Math.min(W, H) * 0.58;
    const proj = (p: V3) => {
      const f = scale() / (2.6 - p[2]);
      return { x: cx + p[0] * f, y: cy - p[1] * f, z: p[2] };
    };

    const trail: { x: number; y: number }[] = [];

    const frame = () => {
      // the element may have had no layout at mount — track its real size
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
      if (!REDUCED) spin += 0.0022;
      const { dirs, labels, probs, winner, argmax, locked } = st.current;
      ctx.clearRect(0, 0, W, H);

      // faint guide rings (depth)
      ctx.strokeStyle = "#141414";
      ctx.lineWidth = 1;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        for (let a = 0; a <= 64; a++) {
          const ang = (a / 64) * Math.PI * 2;
          const s = proj(rotY([Math.cos(ang), (r - 1) * 0.55, Math.sin(ang)], spin));
          if (a === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }

      if (!dirs.length) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // the traveling vector: real probability-weighted direction of the candidates
      let vx = 0,
        vy = 0,
        vz = 0;
      for (let k = 0; k < dirs.length; k++) {
        vx += dirs[k][0] * probs[k];
        vy += dirs[k][1] * probs[k];
        vz += dirs[k][2] * probs[k];
      }
      let mag = Math.hypot(vx, vy, vz);
      if (mag < 0.04) {
        // unformed early layers → sit at the centroid (no preference yet)
        vx = dirs.reduce((s, d) => s + d[0], 0);
        vy = dirs.reduce((s, d) => s + d[1], 0);
        vz = dirs.reduce((s, d) => s + d[2], 0);
        mag = Math.hypot(vx, vy, vz) || 1;
      }
      const v: V3 = [vx / mag, vy / mag, vz / mag];

      // candidate dots + labels
      for (let k = 0; k < dirs.length; k++) {
        const s = proj(rotY(dirs[k].map((x) => x * 1.15) as V3, spin));
        const depth = (s.z + 1) / 2;
        const isWin = k === winner;
        const isTop = k === argmax;
        const hot = isWin && (isTop || locked);
        const lit = isTop ? 1 : 0.26 + 0.5 * depth;
        const col = hot ? "215,25,33" : "232,232,232";
        ctx.beginPath();
        ctx.arc(s.x, s.y, isWin ? 4.6 : 3 * (0.6 + 0.6 * depth), 0, 7);
        ctx.fillStyle = `rgba(${col},${isWin ? Math.max(0.5, lit) : lit})`;
        ctx.fill();
        ctx.font = `${isTop ? 600 : 400} ${(11 + 3 * depth).toFixed(0)}px ui-monospace, monospace`;
        ctx.fillStyle = `rgba(${col},${0.32 + 0.55 * lit})`;
        ctx.textAlign = "left";
        ctx.fillText(labels[k] ?? "", s.x + 8, s.y + 4);
      }

      // vector origin → tip, with a fading red trail
      const o = proj(rotY([0, 0, 0], spin));
      const tp = proj(rotY(v.map((x) => x * 1.15) as V3, spin));
      trail.push({ x: tp.x, y: tp.y });
      if (trail.length > 26) trail.shift();
      for (let t = 1; t < trail.length; t++) {
        ctx.beginPath();
        ctx.moveTo(trail[t - 1].x, trail[t - 1].y);
        ctx.lineTo(trail[t].x, trail[t].y);
        ctx.strokeStyle = `rgba(215,25,33,${(t / trail.length) * 0.22})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.strokeStyle = locked ? "rgba(215,25,33,0.95)" : "rgba(232,232,232,0.82)";
      ctx.lineWidth = 2.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, locked ? 6 : 4.4, 0, 7);
      ctx.fillStyle = locked ? "#d71921" : "#e8e8e8";
      ctx.fill();
      if (locked && !REDUCED) {
        const pulse = 6 + 4 * Math.sin(spin * 6);
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, pulse + 8, 0, 7);
        ctx.strokeStyle = `rgba(215,25,33,${0.32 - 0.02 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(o.x, o.y, 2.4, 0, 7);
      ctx.fillStyle = "#5a5a5a";
      ctx.fill();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [ready]);

  if (!lens || !lens.layers.length)
    return (
      <div className="fl-status" role="status">
        computing the climb — one forward pass, read at every layer…
      </div>
    );

  const locked = st.current.locked;
  return (
    <div className="fl-spacewrap">
      <div className="fl-space">
        <canvas ref={cv} />
        <div className="fl-space-ov fl-space-ctx">suiron · sharpens · {lastLayer + 1} layers</div>
        <div className="fl-space-ov fl-space-lock" style={{ opacity: locked ? 1 : 0 }}>
          ● locked on “{winTok}”{leadLayer !== null ? ` · layer ${leadLayer}` : ""}
        </div>
        <div className="fl-space-ov fl-space-read">
          layer <b className="w">{atLayer}</b> / {lastLayer} · pointing at{" "}
          <span className="w">“{readWord}”</span> <span className="p">{(readP * 100).toFixed(0)}%</span>
        </div>
      </div>
      <div className="fl-space-honest">
        the words’ positions illustrate direction — the layer, the word and the % are the live
        logit-lens
      </div>

      <Stepper i={i} max={last} playing={playing} setI={setI} toggle={toggle} unit="layer" />

      {done && (
        <div className="fl-note" role="status">
          {agrees
            ? `“${winTok}”${
                leadLayer !== null ? ` takes the lead at layer ${leadLayer}` : ""
              } — the engine’s real prediction ✓`
            : "the last layer differs from the engine’s prediction — inspect in the expert view"}
        </div>
      )}
    </div>
  );
}
