import { useEffect, useState } from "react";
import { getNeighbors } from "../api";
import { attnSources, litToken } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain, useExplainer } from "./Explainer";
import { SUB, type ExplainCtx } from "./Explanations";
import type { FocusTarget, Neighbor, Step, Trace } from "../types";

/* The geometry view — meaning, traversal, and prediction in one honest radial
   frame. The spine (docs/geometry-view.md): every spatial claim encodes a REAL
   quantity. Distance from the focus is the only such claim:
     - prediction read: radius = the candidate's logit deficit below the winner
       (recovered exactly from the trace's T=1 softmax probs — not a recompute
       from a hidden state). The winner sits closest, in red.
     - meaning read: radius = cosine distance (1 − cos) to the inspected token's
       embedding row, from the neighbors primitive. Nearest neighbor in red.
   Attention edges are a clearly-labeled overlay (their own region), monochrome,
   with thickness/opacity = real attention. Red is reserved for the single
   strongest node only. Angle around the focus and any jitter are LAYOUT ONLY.
   No projection, ever. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type Read = "prediction" | "meaning";

interface Layout {
  W: number;
  H: number;
  cx: number;
  cy: number;
  rIn: number;
  rOut: number;
  srcY: number;
}
// full band layout (with the attention "attended from" strip at the bottom)
const FULL: Layout = { W: 760, H: 520, cx: 380, cy: 226, rIn: 48, rOut: 178, srcY: 478 };
// compact drawer card: the candidate / neighbor fan ONLY (no attention strip),
// fewer nodes, larger relative text for the ~372px-wide drawer.
const CARD: Layout = { W: 360, H: 312, cx: 180, cy: 156, rIn: 30, rOut: 124, srcY: 0 };

interface Node {
  key: string;
  id: number;
  label: string;
  literal: boolean;
  t: number; // 0..1 real metric normalised to the frame (0 = nearest / strongest)
  detail: string;
  x: number;
  y: number;
  win: boolean; // the single strongest — the only thing drawn red
}

/** even angular spacing by rank, starting at the top. ANGLE IS LAYOUT ONLY. */
function place(i: number, n: number, t: number, L: Layout): { x: number; y: number } {
  const a = (-90 + (360 * i) / Math.max(1, n)) * (Math.PI / 180);
  const r = L.rIn + t * (L.rOut - L.rIn);
  return { x: L.cx + r * Math.cos(a), y: L.cy + r * Math.sin(a) };
}

/** The neighbors fetch, gated: only fires when `enabled` (the meaning read) and
 *  on token change, never on idle. One fetch path shared by the band and the
 *  drawer card. */
function useNeighbors(tokenId: number, enabled: boolean): Neighbor[] | null {
  const [nbrs, setNbrs] = useState<Neighbor[] | null>(null);
  useEffect(() => {
    if (!enabled || tokenId < 0) return;
    let dead = false;
    setNbrs(null); // loading
    getNeighbors(tokenId, 12)
      .then((ns) => !dead && setNbrs(ns))
      .catch(() => !dead && setNbrs([]));
    return () => {
      dead = true;
    };
  }, [enabled, tokenId]);
  return nbrs;
}

interface ReadModel {
  nodes: Node[];
  centerLabel: string;
  centerLiteral: boolean;
  figure: string;
  figureCaption: string;
}

function buildRead(
  read: Read,
  trace: Trace,
  step: Step,
  cur: number,
  nbrs: Neighbor[] | null,
  L: Layout,
  cap: number,
): ReadModel {
  const nodes: Node[] = [];
  if (read === "prediction") {
    const top = (step.top ?? []).slice(0, cap);
    const pmax = top[0]?.[2] ?? 1;
    const gaps = top.map(([, , p]) => Math.max(0, Math.log(pmax / Math.max(p, 1e-9))));
    const gapMax = Math.max(...gaps, 1e-9);
    top.forEach(([id, t, p], i) => {
      const lt = litToken(t);
      const norm = gaps[i] / gapMax;
      const { x, y } = place(i, top.length, norm, L);
      nodes.push({
        key: "c" + id,
        id,
        label: lt.text,
        literal: lt.literal,
        t: norm,
        detail: `${(p * 100).toFixed(1)}%  ·  ${i === 0 ? "scored highest" : "scored lower, sits further out"}`,
        x,
        y,
        win: i === 0,
      });
    });
    const w = top[0];
    const wl = w ? litToken(w[1]) : null;
    return {
      nodes,
      centerLabel: "output direction",
      centerLiteral: false,
      figure: w ? (w[2] * 100).toFixed(0) + "%" : "",
      figureCaption: wl ? `points hardest at “${wl.text}”` : "",
    };
  }
  const ring = (nbrs ?? []).filter((nb) => nb.id !== trace.tokens[cur]?.id).slice(0, cap);
  const dists = ring.map((nb) => 1 - nb.cos);
  const dMax = Math.max(...dists, 1e-9);
  ring.forEach((nb, i) => {
    const lt = litToken(nb.token);
    const norm = dists[i] / dMax;
    const { x, y } = place(i, ring.length, norm, L);
    nodes.push({
      key: "n" + nb.id,
      id: nb.id,
      label: lt.text,
      literal: lt.literal,
      t: norm,
      detail: `cosine ${nb.cos.toFixed(3)}`,
      x,
      y,
      win: i === 0, // most similar — the strongest link
    });
  });
  const tl = litToken(trace.tokens[cur]?.t ?? "");
  const n0 = ring[0] ? litToken(ring[0].token) : null;
  return {
    nodes,
    centerLabel: `“${tl.text}”`,
    centerLiteral: tl.literal,
    figure: ring[0] ? ring[0].cos.toFixed(2) : "",
    figureCaption: n0 ? `nearest: “${n0.text}”` : "",
  };
}

/** The radial view itself. Shared by the full band and the compact drawer card.
 *  `compact` drops the attention overlay and trims node counts. `onHover`, when
 *  given, lights the page through a FocusTarget. */
export function GeometryView({
  trace,
  step,
  cur,
  read,
  compact = false,
  onHover,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  read: Read;
  compact?: boolean;
  onHover?: (f: FocusTarget) => void;
}) {
  const L = compact ? CARD : FULL;
  const tokenId = trace.tokens[cur]?.id ?? -1;
  const nbrs = useNeighbors(tokenId, read === "meaning");
  const cap = compact ? (read === "meaning" ? 8 : 6) : read === "meaning" ? 12 : 10;

  const { nodes, centerLabel, centerLiteral, figure, figureCaption } = buildRead(
    read,
    trace,
    step,
    cur,
    nbrs,
    L,
    cap,
  );

  // attention overlay — full band, prediction read only. Earlier tokens that fed
  // this position; edge thickness/opacity = REAL attention, x-position = layout.
  const srcs = !compact && read === "prediction" && cur > 0 ? attnSources(step, cur, 5) : [];
  const wMax = Math.max(...srcs.map((s) => s.w), 1e-9);
  const srcX = (i: number) => (srcs.length === 1 ? L.cx : 150 + (i * (L.W - 300)) / (srcs.length - 1));

  const loading = read === "meaning" && nbrs === null;
  const empty = read === "meaning" && nbrs !== null && nodes.length === 0;

  return (
    <div className={"geo-view" + (compact ? " compact" : "")}>
      <svg className={"geo-svg" + (REDUCED ? " still" : "")} viewBox={`0 0 ${L.W} ${L.H}`} role="img">
        {/* faint reference rings — scale, not data */}
        {[L.rIn, (L.rIn + L.rOut) / 2, L.rOut].map((r) => (
          <circle key={r} className="geo-guide" cx={L.cx} cy={L.cy} r={r} />
        ))}

        {/* attention overlay, its own clearly-labeled region below the fan */}
        {srcs.length > 0 && (
          <>
            <line className="geo-divider" x1={40} y1={L.srcY - 40} x2={L.W - 40} y2={L.srcY - 40} />
            <text x={40} y={L.srcY - 26} className="geo-region">
              attended from
            </text>
          </>
        )}
        {srcs.map((s, i) => {
          const x = srcX(i);
          const rel = s.w / wMax;
          const lt = litToken(trace.tokens[s.pos]?.t ?? "");
          return (
            <g key={"s" + s.pos}>
              <path
                className="geo-edge"
                d={`M ${x} ${L.srcY - 14} Q ${(x + L.cx) / 2} ${(L.srcY + L.cy) / 2} ${L.cx} ${L.cy}`}
                style={{ opacity: 0.22 + 0.6 * rel, strokeWidth: 1 + 2.6 * rel }}
              />
              <g
                className="geo-src"
                onMouseEnter={() => onHover?.({ kind: "token", pos: s.pos })}
                onMouseLeave={() => onHover?.({ kind: "none" })}
              >
                <circle cx={x} cy={L.srcY} r={4} />
                <text x={x} y={L.srcY + 18} className={"geo-src-label" + (lt.literal ? " geo-lit" : "")}>
                  {lt.text}
                </text>
              </g>
            </g>
          );
        })}

        {/* spokes — the line carries no weight; the node's distance does */}
        {nodes.map((n) => (
          <line key={"l" + n.key} className="geo-spoke" x1={L.cx} y1={L.cy} x2={n.x} y2={n.y} />
        ))}

        {/* the focus */}
        <circle className="geo-focus" cx={L.cx} cy={L.cy} r={6} />
        <text x={L.cx} y={L.cy - 16} className={"geo-focus-label" + (centerLiteral ? " geo-lit" : "")}>
          {centerLabel}
        </text>

        {/* the nodes */}
        {nodes.map((n) => (
          <g
            key={n.key}
            className={"geo-node" + (n.win ? " win" : "")}
            onMouseEnter={() => onHover?.(read === "prediction" ? { kind: "candidate", id: n.id } : { kind: "none" })}
            onMouseLeave={() => onHover?.({ kind: "none" })}
          >
            <title>{n.detail}</title>
            <circle cx={n.x} cy={n.y} r={n.win ? 5.5 : 4} />
            <text x={n.x} y={n.y - 9} className={"geo-node-label" + (n.literal ? " geo-lit" : "")}>
              {n.label}
            </text>
          </g>
        ))}

        {loading && (
          <text x={L.cx} y={L.cy + 4} className="geo-status">
            computing neighbors…
          </text>
        )}
        {empty && (
          <text x={L.cx} y={L.cy + 4} className="geo-status">
            no neighbors
          </text>
        )}
      </svg>

      {figure && (
        <div className="geo-cap">
          <span className="geo-figure">{figure}</span>
          <span className="geo-figure-cap">{figureCaption}</span>
        </div>
      )}
    </div>
  );
}

/** The full-width band: the toggle + the view + the honest-encoding label. */
export function Geometry({
  trace,
  step,
  cur,
  active,
  setHover,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  active: string | null;
  setHover: (f: FocusTarget) => void;
}) {
  const [read, setRead] = useState<Read>("prediction");

  // follow the Explainer: the embedding concept opens the meaning read, the
  // logits concept the prediction read. The manual toggle still wins afterward.
  useEffect(() => {
    if (active === "embedding") setRead("meaning");
    else if (active === "logits") setRead("prediction");
  }, [active]);

  return (
    <section data-explain-el="geo">
      <BandHeader
        idx="04"
        title={<Explain of="geometry">the geometry of one prediction</Explain>}
        sub={SUB.geometry}
      >
        <div className="seg geo-toggle">
          {(["prediction", "meaning"] as Read[]).map((r) => (
            <button
              key={r}
              className={"seg-opt" + (read === r ? " on" : "")}
              data-explain-el={r === "meaning" ? "geo-meaning" : "geo-prediction"}
              onClick={() => setRead(r)}
            >
              {r === "prediction" ? "what comes next" : "what it means"}
            </button>
          ))}
        </div>
      </BandHeader>

      <div className="geo-wrap">
        <GeometryView trace={trace} step={step} cur={cur} read={read} onHover={setHover} />
        <p className="geo-honest">
          Distance from the center is the only spatial claim, and it is real: in{" "}
          <b>what comes next</b>, closer in means the model scores the token higher; in{" "}
          <b>what it means</b>, closer in means a higher cosine similarity to this token. Edge
          thickness is the real attention each earlier token fed in. Angle and any jitter are layout
          only; they carry no meaning. <span className="geo-key">Red</span> marks the single
          strongest — the winning candidate, or the nearest neighbor.
        </p>
      </div>
    </section>
  );
}

/** The compact drawer card: a deliberately simplified view (the candidate /
 *  neighbor fan only, no attention overlay), reachable from inspecting a token.
 *  The concept fixes the read. Hovering a node lights the page through the
 *  Explainer's programmatic focus, except during a walk (which owns that focus). */
export function GeometryCard({ ctx, read }: { ctx: ExplainCtx; read: Read }) {
  const { setProgramFocus, docked } = useExplainer();
  const onHover = docked ? undefined : setProgramFocus;
  return (
    <div className="geo-card">
      <GeometryView trace={ctx.trace} step={ctx.step} cur={ctx.cur} read={read} compact onHover={onHover} />
      <p className="geo-card-note">
        {read === "meaning"
          ? "The closest vocabulary entries to this token by cosine similarity; the nearest is the most alike."
          : "The next-token candidates by how high the model scores each; the winner sits closest, in red."}
      </p>
    </div>
  );
}
