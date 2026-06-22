import { useEffect, useState } from "react";
import { getNeighbors } from "../api";
import { attnSources, esc } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { FocusTarget, Neighbor, Step, Trace } from "../types";

/* The geometry view — meaning, traversal, and prediction in one honest radial
   frame. The spine (docs/geometry-view.md): every spatial claim encodes a REAL
   quantity. Distance from the focus is the only such claim:
     - prediction read: radius = the candidate's logit deficit below the winner
       (ln(p_max / p_i), recovered exactly from the trace's T=1 softmax probs —
       not a recompute from a hidden state). Winner at the centre, in red.
     - meaning read: radius = cosine distance (1 − cos) to the inspected token's
       embedding row, from the neighbours primitive. Nearest neighbour in red.
   Edge opacity/width = real attention. Angle around the focus and any jitter are
   LAYOUT ONLY and labelled as carrying no meaning. No projection, ever. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// fixed layout space; the SVG scales to the band width via viewBox.
const W = 760;
const H = 520;
const CX = W / 2;
const CY = 226;
const R_IN = 48; // innermost ring radius (the most aligned / nearest sits here)
const R_OUT = 178; // outermost ring radius
const SRC_Y = 478; // attention-source strip baseline

type Read = "prediction" | "meaning";

interface Node {
  key: string;
  id: number;
  label: string;
  /** 0..1, real metric normalised to the frame (0 = nearest/most aligned) */
  t: number;
  /** human-readable real value for the title */
  detail: string;
  x: number;
  y: number;
  win: boolean;
}

/** even angular spacing by rank, starting at the top. ANGLE IS LAYOUT ONLY. */
function place(i: number, n: number, t: number): { x: number; y: number } {
  const a = (-90 + (360 * i) / Math.max(1, n)) * (Math.PI / 180);
  const r = R_IN + t * (R_OUT - R_IN);
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

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
  // logits concept the prediction read. Manual toggle still wins afterward.
  useEffect(() => {
    if (active === "embedding") setRead("meaning");
    else if (active === "logits") setRead("prediction");
  }, [active]);

  const tokenId = trace.tokens[cur]?.id ?? -1;
  const tokenText = trace.tokens[cur]?.t ?? "";

  // neighbours: fetched ONLY in the meaning read, and only when the inspected
  // token changes. Never runs on idle / in the prediction read.
  const [nbrs, setNbrs] = useState<Neighbor[] | null>(null);
  useEffect(() => {
    if (read !== "meaning" || tokenId < 0) return;
    let dead = false;
    setNbrs(null); // loading
    getNeighbors(tokenId, 12)
      .then((ns) => !dead && setNbrs(ns))
      .catch(() => !dead && setNbrs([]));
    return () => {
      dead = true;
    };
  }, [read, tokenId]);

  const nodes: Node[] = [];
  let centreLabel = "";
  let figure = "";
  let figureCaption = "";

  if (read === "prediction") {
    const top = (step.top ?? []).slice(0, 10);
    const pmax = top[0]?.[2] ?? 1;
    const gaps = top.map(([, , p]) => Math.max(0, Math.log(pmax / Math.max(p, 1e-9))));
    const gapMax = Math.max(...gaps, 1e-9);
    top.forEach(([id, t, p], i) => {
      const norm = gaps[i] / gapMax;
      const { x, y } = place(i, top.length, norm);
      nodes.push({
        key: "c" + id,
        id,
        label: esc(t),
        t: norm,
        detail: `${(p * 100).toFixed(1)}%  ·  ${gaps[i] === 0 ? "top logit" : `${gaps[i].toFixed(2)} logits below top`}`,
        x,
        y,
        win: i === 0,
      });
    });
    centreLabel = "output direction";
    if (top[0]) {
      figure = (top[0][2] * 100).toFixed(0) + "%";
      figureCaption = `points hardest at “${esc(top[0][1])}”`;
    }
  } else {
    const ring = (nbrs ?? []).filter((nb) => nb.id !== tokenId);
    const dists = ring.map((nb) => 1 - nb.cos);
    const dMax = Math.max(...dists, 1e-9);
    ring.forEach((nb, i) => {
      const norm = dists[i] / dMax;
      const { x, y } = place(i, ring.length, norm);
      nodes.push({
        key: "n" + nb.id,
        id: nb.id,
        label: esc(nb.token),
        t: norm,
        detail: `cosine ${nb.cos.toFixed(3)}`,
        x,
        y,
        win: i === 0, // ring[0] is the most similar (strongest link)
      });
    });
    centreLabel = `“${esc(tokenText)}”`;
    if (ring[0]) {
      figure = ring[0].cos.toFixed(2);
      figureCaption = `nearest: “${esc(ring[0].token)}”`;
    }
  }

  // attention sources (prediction read only): the earlier tokens that fed this
  // position. Edge opacity/width = REAL attention; their x-position is layout.
  const srcs = read === "prediction" && cur > 0 ? attnSources(step, cur, 5) : [];
  const wMax = Math.max(...srcs.map((s) => s.w), 1e-9);
  const srcX = (i: number) =>
    srcs.length === 1 ? CX : 150 + (i * (W - 300)) / (srcs.length - 1);

  const loading = read === "meaning" && nbrs === null;
  const empty = read === "meaning" && nbrs !== null && nodes.length === 0;

  return (
    <section data-explain-el="geo">
      <BandHeader
        idx="04"
        title={
          <>
            the geometry of one prediction <Explain of="geometry" />
          </>
        }
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
        <svg className={"geo-svg" + (REDUCED ? " still" : "")} viewBox={`0 0 ${W} ${H}`} role="img">
          {/* faint reference rings — scale, not data */}
          {[R_IN, (R_IN + R_OUT) / 2, R_OUT].map((r) => (
            <circle key={r} className="geo-guide" cx={CX} cy={CY} r={r} />
          ))}

          {/* attention overlay: earlier tokens feeding the output direction */}
          {srcs.map((s, i) => {
            const x = srcX(i);
            const op = 0.18 + 0.72 * (s.w / wMax);
            return (
              <g key={"s" + s.pos}>
                <path
                  className="geo-edge"
                  d={`M ${x} ${SRC_Y - 14} Q ${(x + CX) / 2} ${(SRC_Y + CY) / 2} ${CX} ${CY}`}
                  style={{ opacity: op, strokeWidth: 1 + 2.4 * (s.w / wMax) }}
                />
                <g
                  className="geo-src"
                  onMouseEnter={() => setHover({ kind: "token", pos: s.pos })}
                  onMouseLeave={() => setHover({ kind: "none" })}
                >
                  <circle cx={x} cy={SRC_Y} r={4} />
                  <text x={x} y={SRC_Y + 18} className="geo-src-label">
                    {esc(trace.tokens[s.pos]?.t ?? "")}
                  </text>
                </g>
              </g>
            );
          })}

          {/* spokes from focus to each node — the line carries no weight, the
              node's distance does. kept faint so radius reads first. */}
          {nodes.map((n) => (
            <line key={"l" + n.key} className="geo-spoke" x1={CX} y1={CY} x2={n.x} y2={n.y} />
          ))}

          {/* the focus */}
          <circle className="geo-focus" cx={CX} cy={CY} r={6} />
          <text x={CX} y={CY - 16} className="geo-focus-label">
            {centreLabel}
          </text>

          {/* the nodes */}
          {nodes.map((n) => (
            <g
              key={n.key}
              className={"geo-node" + (n.win ? " win" : "")}
              onMouseEnter={() =>
                setHover(
                  read === "prediction"
                    ? { kind: "candidate", id: n.id }
                    : { kind: "none" },
                )
              }
              onMouseLeave={() => setHover({ kind: "none" })}
            >
              <title>{n.detail}</title>
              <circle cx={n.x} cy={n.y} r={n.win ? 5.5 : 4} />
              <text x={n.x} y={n.y - 9} className="geo-node-label">
                {n.label}
              </text>
            </g>
          ))}

          {loading && (
            <text x={CX} y={CY + 4} className="geo-status">
              computing neighbours…
            </text>
          )}
          {empty && (
            <text x={CX} y={CY + 4} className="geo-status">
              no neighbours
            </text>
          )}
        </svg>

        <div className="geo-side">
          {figure && (
            <div className="geo-figure-box">
              <div className="geo-figure">{figure}</div>
              <div className="geo-figure-cap">{figureCaption}</div>
            </div>
          )}
          <p className="geo-honest">
            distance from the centre is the only spatial claim, and it is real: in{" "}
            <b>what comes next</b> it is the candidate's logit below the top guess; in{" "}
            <b>what it means</b> it is cosine similarity to this token. edge opacity is real
            attention. angle and any jitter are layout only — they carry no meaning. nearest is{" "}
            <span className="geo-key">red</span>.
          </p>
        </div>
      </div>
    </section>
  );
}
