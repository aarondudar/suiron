import { useEffect, useState } from "react";
import { getNeighbors } from "../api";
import { esc } from "../lib";
import { useCanvasLoop, rotY, sphereDirs, REDUCED, type V3 } from "./spaceCanvas";
import type { Neighbor, Trace } from "../types";

/* "tokens", as an instrument (design-31): a token isn't just a chip, it's a
   position in meaning-space. We drop one token in and let its real nearest
   neighbours settle around it — distance is the engine's actual cosine
   similarity over the whole 151,936-row embedding table (closer = more alike in
   meaning). Only the angle is layout; every distance is a real number. */

/** the most telling token to anchor the neighbourhood on: prefer the answer the
 *  model just produced (the last generated token), else the last contentful word
 *  of the prompt (function words like "is" cluster with other function words).
 *  Shared with the meaning drawer so the step and its drawer tell one story. */
export function pickAnchor(trace: Trace): number {
  const last = trace.tokens.length - 1;
  // the produced answer (e.g. " Paris") is the most satisfying neighbourhood to
  // show — but prefer the newest generated token that carries a letter (any
  // script): a repetition-trap run can end on a comma, and a comma's
  // neighbourhood teaches nothing
  for (let i = last; i >= trace.n_prompt; i--) {
    if (/\p{L}/u.test(trace.tokens[i]?.t ?? "")) return i;
  }
  if (last >= trace.n_prompt) return last;
  for (let i = last; i >= 0; i--) {
    if (/[A-Za-z]{3,}/.test((trace.tokens[i]?.t ?? "").trim())) return i;
  }
  return Math.max(0, last);
}

export function TokenSpace({ trace }: { trace: Trace; n?: number }) {
  const pi = pickAnchor(trace);
  const pickId = trace.tokens[pi]?.id ?? -1;
  const pickTok = esc(trace.tokens[pi]?.t ?? "");

  const [nbrs, setNbrs] = useState<Neighbor[] | null>(null);
  useEffect(() => {
    if (pickId < 0) return;
    let dead = false;
    setNbrs(null);
    getNeighbors(pickId, 12)
      .then((ns) => !dead && setNbrs(ns))
      .catch(() => !dead && setNbrs([]));
    return () => {
      dead = true;
    };
  }, [pickId]);

  const list = (nbrs ?? []).filter((x) => x.id !== pickId && x.cos < 0.9999).slice(0, 10);
  const ready = list.length > 0;
  const nearest = list[0];
  const cosMax = list.length ? list[0].cos : 1;
  const cosMin = list.length ? list[list.length - 1].cos : 0;
  const dirs = sphereDirs(list.length);

  const st = {
    list,
    dirs,
    cosMax,
    cosMin,
    labels: list.map((x) => esc(x.token)),
    center: pickTok,
  };

  const canvas = useCanvasLoop(ready, ({ ctx, W, H, cx, cy, spin, t }) => {
    const { list: L, dirs: D, cosMax: cMax, cosMin: cMin, labels, center } = st;
    const nn = L.length;
    if (!nn) return;
    const scale = Math.min(W, H) * 0.5;
    const proj = (p: V3) => {
      const f = scale / (2.8 - p[2]);
      return { x: cx + p[0] * f, y: cy - p[1] * f, z: p[2] };
    };
    const ease = REDUCED ? 1 : Math.min(1, t / 1.2);
    const span = Math.max(1e-4, cMax - cMin);
    const origin = proj(rotY([0, 0, 0], spin));

    // faint guide rings for depth
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

    for (let i = 0; i < nn; i++) {
      const norm = (L[i].cos - cMin) / span; // 1 = nearest
      const d = 0.55 + (1 - norm) * 1.05; // nearer cosine → nearer in space
      const dEased = d * ease + 1.95 * (1 - ease); // fly in from far, then settle
      const s = proj(rotY(D[i].map((x) => x * dEased) as V3, spin));
      const depth = (s.z + 1) / 2;
      const lit = 0.3 + 0.6 * depth;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = `rgba(232,232,232,${(0.04 + 0.12 * norm) * ease})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2 + 3.4 * norm * (0.6 + 0.6 * depth), 0, 7);
      ctx.fillStyle = `rgba(232,232,232,${lit * ease})`;
      ctx.fill();
      ctx.font = `400 ${(11 + 3 * depth).toFixed(0)}px ui-monospace, monospace`;
      ctx.fillStyle = `rgba(232,232,232,${(0.3 + 0.5 * lit) * ease})`;
      ctx.textAlign = "left";
      ctx.fillText(labels[i], s.x + 7, s.y + 4);
    }

    // the token itself, at the centre
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, 7);
    ctx.fillStyle = "#d71921";
    ctx.fill();
    ctx.font = "600 13px ui-monospace, monospace";
    ctx.fillStyle = "rgba(215,25,33,0.95)";
    ctx.textAlign = "left";
    ctx.fillText(center, origin.x + 9, origin.y + 4);
  }, { rotatable: true });

  if (!ready)
    return (
      <div className="fl-status" role="status">
        projecting the neighbourhood…
      </div>
    );

  return (
    <div className="fl-spacewrap">
      <div className="fl-space">
        <canvas ref={canvas} />
        <div className="fl-space-ov fl-space-ctx">suiron · tokens · meaning space</div>
        <div className="fl-space-ov fl-space-read">
          nearest to <span className="w">“{pickTok}”</span>:{" "}
          <span className="w">“{esc(nearest.token)}”</span>{" "}
          <span className="p">cos {nearest.cos.toFixed(2)}</span>
        </div>
      </div>
      <div className="fl-space-honest">
        distance is the real cosine similarity to “{pickTok}” over all 151,936 rows — closer means
        more alike in meaning, often across languages (translations file together); the angle is
        layout
      </div>
    </div>
  );
}
