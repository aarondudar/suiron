import { useEffect, useState, type ReactNode } from "react";
import { getLens, getNeighbors } from "../api";
import { useAutoplay } from "../autoplay";
import { attnSources, litToken, settledSeq } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain, useExplainer } from "./Explainer";
import { SUB, type ExplainCtx } from "./Explanations";
import { RoleTag } from "./RoleTag";
import { Stepper } from "./Stepper";
import type { FocusTarget, Lens, Neighbor, Step, Trace } from "../types";

/* The geometry view — meaning, traversal, prediction, and the climb in one
   honest radial frame. The spine (docs/geometry-view.md): every spatial claim
   encodes a REAL quantity. Distance from the focus is the only such claim:
     - prediction: radius = the candidate's logit deficit below the winner
       (from the trace's T=1 softmax probs). The winner sits closest, in red.
     - meaning: radius = cosine distance (1 − cos) to the inspected token's
       embedding row, from the neighbors primitive. Nearest neighbor in red.
     - the climb (logit lens): radius = the same deficit, but for the model's
       guess at the layer the slider sits on. Drag it and watch the winner move
       to the center as the layers resolve. Backend-independent.
   Attention edges are a clearly-labeled overlay (prediction only), monochrome,
   thickness/opacity = real attention. Red marks the single strongest node only.
   Angle around the focus and any jitter are LAYOUT ONLY. No projection, ever. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type Read = "prediction" | "meaning" | "lens";

interface Layout {
  W: number;
  H: number;
  cx: number;
  cy: number;
  rIn: number;
  rOut: number;
  srcY: number;
}
const FULL: Layout = { W: 760, H: 520, cx: 380, cy: 226, rIn: 48, rOut: 178, srcY: 478 };
const CARD: Layout = { W: 360, H: 312, cx: 180, cy: 156, rIn: 30, rOut: 124, srcY: 0 };

interface Node {
  key: string;
  id: number;
  label: string;
  literal: boolean;
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

/** Candidate placement shared by the prediction and lens reads: radius = the
 *  logit deficit below the top guess, recovered from the T=1 softmax probs.
 *  Winner (top-1) nearest and red. */
function topModel(rows: [number, string, number][], L: Layout, cap: number) {
  const top = rows.slice(0, cap);
  const pmax = top[0]?.[2] ?? 1;
  const gaps = top.map(([, , p]) => Math.max(0, Math.log(pmax / Math.max(p, 1e-9))));
  const gapMax = Math.max(...gaps, 1e-9);
  const nodes: Node[] = top.map(([id, t, p], i) => {
    const lt = litToken(t);
    const { x, y } = place(i, top.length, gaps[i] / gapMax, L);
    return {
      key: "c" + i, // by rank slot, so a re-place transitions in slot
      id,
      label: lt.text,
      literal: lt.literal,
      detail: `${(p * 100).toFixed(1)}%  ·  ${i === 0 ? "scored highest" : "scored lower, sits further out"}`,
      x,
      y,
      win: i === 0,
    };
  });
  const wl = top[0] ? litToken(top[0][1]) : null;
  return { nodes, winnerText: wl?.text ?? "", winnerProb: top[0]?.[2] ?? 0 };
}

/** gated, cached fetches — never fire on idle */
function useNeighbors(tokenId: number, enabled: boolean): Neighbor[] | null {
  const [nbrs, setNbrs] = useState<Neighbor[] | null>(null);
  useEffect(() => {
    if (!enabled || tokenId < 0) return;
    let dead = false;
    setNbrs(null);
    getNeighbors(tokenId, 12)
      .then((ns) => !dead && setNbrs(ns))
      .catch(() => !dead && setNbrs([]));
    return () => {
      dead = true;
    };
  }, [enabled, tokenId]);
  return nbrs;
}

/** `seq` is the settled trace sequence (settledSeq): the lens depends on the
 *  resident tokens, so a fork/regenerate at the same position must refetch. */
export function useLens(pos: number, enabled: boolean, seq: number): Lens | null {
  const [lens, setLens] = useState<Lens | null>(null);
  useEffect(() => {
    if (!enabled || pos < 0 || seq < 0) return;
    let dead = false;
    setLens(null);
    getLens(pos, 5)
      .then((l) => !dead && setLens(l))
      .catch(() => !dead && setLens(null));
    return () => {
      dead = true;
    };
  }, [enabled, pos, seq]);
  return lens;
}

/** The radial view itself. Shared by the full band and the compact drawer card. */
export function GeometryView({
  trace,
  step,
  cur,
  prod,
  read,
  compact = false,
  onHover,
}: {
  trace: Trace;
  step: Step; // the producing step (steps[prod]) — backs the prediction read
  cur: number; // the inspected token — backs the meaning read (its own vector)
  prod: number; // the producing position — backs the lens (its layer-by-layer climb)
  read: Read;
  compact?: boolean;
  onHover?: (f: FocusTarget) => void;
}) {
  const L = compact ? CARD : FULL;
  const lastLayer = trace.layers - 1;
  const tokenId = trace.tokens[cur]?.id ?? -1;
  const nbrs = useNeighbors(tokenId, read === "meaning");
  const lens = useLens(prod, read === "lens", settledSeq(trace));
  // the climb autoplays layer 0 → last in a loop (pausable; static at the final
  // layer under reduced-motion). Only active in the lens read.
  const {
    i: layerSel,
    playing: lensPlaying,
    setI: setSelLayer,
    toggle: toggleLens,
  } = useAutoplay(read === "lens" ? lastLayer : 0, { stepMs: 360 });
  const cap = compact ? (read === "meaning" ? 8 : 6) : read === "meaning" ? 12 : 10;

  let nodes: Node[] = [];
  let centerLabel = "";
  let centerLiteral = false;
  let figure = "";
  let figureCaption = "";

  if (read === "meaning") {
    const ring = (nbrs ?? []).filter((nb) => nb.id !== tokenId).slice(0, cap);
    const dMax = Math.max(...ring.map((nb) => 1 - nb.cos), 1e-9);
    nodes = ring.map((nb, i) => {
      const lt = litToken(nb.token);
      const { x, y } = place(i, ring.length, (1 - nb.cos) / dMax, L);
      return { key: "n" + nb.id, id: nb.id, label: lt.text, literal: lt.literal, detail: `cosine ${nb.cos.toFixed(3)}`, x, y, win: i === 0 };
    });
    const tl = litToken(trace.tokens[cur]?.t ?? "");
    const n0 = ring[0] ? litToken(ring[0].token) : null;
    centerLabel = `“${tl.text}”`;
    centerLiteral = tl.literal;
    figure = ring[0] ? ring[0].cos.toFixed(2) : "";
    figureCaption = n0 ? `nearest: “${n0.text}”` : "";
  } else {
    const rows = read === "lens" ? lens?.layers[layerSel]?.top ?? [] : step.top ?? [];
    const m = topModel(rows, L, cap);
    nodes = m.nodes;
    centerLabel = read === "lens" ? `output direction · layer ${layerSel}` : "output direction";
    figure = rows[0] ? (m.winnerProb * 100).toFixed(0) + "%" : "";
    figureCaption = !rows[0]
      ? ""
      : read === "lens"
        ? `top guess here: “${m.winnerText}”`
        : `points hardest at “${m.winnerText}”`;
  }

  // attention overlay — full band, prediction read only.
  const srcs = !compact && read === "prediction" && cur > 0 ? attnSources(step, cur, 5) : [];
  const wMax = Math.max(...srcs.map((s) => s.w), 1e-9);
  const srcX = (i: number) => (srcs.length === 1 ? L.cx : 150 + (i * (L.W - 300)) / (srcs.length - 1));

  const loading = (read === "meaning" && nbrs === null) || (read === "lens" && lens === null);
  const empty = read === "meaning" && nbrs !== null && nodes.length === 0;

  return (
    <div className={"geo-view" + (compact ? " compact" : "")}>
      {read === "lens" && (
        <Stepper
          i={layerSel}
          max={lastLayer}
          playing={lensPlaying}
          setI={setSelLayer}
          toggle={toggleLens}
          unit="layer"
        />
      )}

      <svg
        className={"geo-svg" + (REDUCED ? " still" : "")}
        viewBox={`0 0 ${L.W} ${L.H}`}
        role="img"
        aria-label={
          read === "lens"
            ? `logit lens at layer ${layerSel}: candidates by score, closest to the center is the current top guess`
            : read === "meaning"
              ? "nearest vocabulary entries to this token by cosine similarity"
              : "next-token candidates by score; the winner sits closest to the center"
        }
      >
        {[L.rIn, (L.rIn + L.rOut) / 2, L.rOut].map((r) => (
          <circle key={r} className="geo-guide" cx={L.cx} cy={L.cy} r={r} />
        ))}

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

        {nodes.map((n) => (
          <line key={"l" + n.key} className="geo-spoke" x1={L.cx} y1={L.cy} x2={n.x} y2={n.y} />
        ))}

        <circle className="geo-focus" cx={L.cx} cy={L.cy} r={6} />
        <text x={L.cx} y={L.cy - 16} className={"geo-focus-label" + (centerLiteral ? " geo-lit" : "")}>
          {centerLabel}
        </text>

        {nodes.map((n) => (
          <g
            key={n.key}
            className={"geo-node" + (n.win ? " win" : "")}
            onMouseEnter={() => onHover?.(read === "meaning" ? { kind: "none" } : { kind: "candidate", id: n.id })}
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
            {read === "lens" ? "computing the climb…" : "computing neighbors…"}
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

const TOGGLE: { read: Read; label: string; el: string }[] = [
  { read: "prediction", label: "what comes next", el: "geo-prediction" },
  { read: "meaning", label: "what it means", el: "geo-meaning" },
  { read: "lens", label: "the climb", el: "geo-lens" },
];

/** The full-width band: the toggle + the view + the honest-encoding label. */
export function Geometry({
  trace,
  step,
  cur,
  prod,
  active,
  setHover,
  card,
  dim,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  prod: number;
  active: string | null;
  setHover: (f: FocusTarget) => void;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
}) {
  const [read, setRead] = useState<Read>("prediction");

  // follow the Explainer: each concept opens its matching read. The manual
  // toggle still wins afterward.
  useEffect(() => {
    if (active === "embedding") setRead("meaning");
    else if (active === "logits" || active === "geometry") setRead("prediction");
    else if (active === "lens") setRead("lens");
  }, [active]);

  return (
    <section data-explain-el="geo" className={dim ? "dimmed" : undefined}>
      <BandHeader
        idx="04"
        title={<Explain of="geometry">the geometry of one prediction</Explain>}
        step="sharpens"
        sub={SUB.geometry}
      >
        <RoleTag
          trace={trace}
          pos={read === "meaning" ? cur : prod}
          kind={read === "meaning" ? "cur" : "prod"}
        />
        <div className="seg geo-toggle">
          {TOGGLE.map((t) => (
            <button
              key={t.read}
              className={"seg-opt" + (read === t.read ? " on" : "")}
              data-explain-el={t.el}
              onClick={() => setRead(t.read)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </BandHeader>
      {card}

      <div className="geo-wrap">
        <GeometryView trace={trace} step={step} cur={cur} prod={prod} read={read} onHover={setHover} />
        <p className="geo-honest">
          Closer to the center means the model scores it higher in <b>what comes next</b>, or sits
          at a higher cosine similarity to this token in <b>what it means</b>. <b>The climb</b> shows
          the same, for the model's guess at the layer the slider sits on. Distance is the only thing
          the position encodes; angle and any jitter are just layout. Edge thickness is the attention
          each earlier token contributed. <span className="geo-key">Red</span> marks the strongest.
        </p>
      </div>
    </section>
  );
}

const CARD_NOTE: Record<Read, string> = {
  meaning: "The closest vocabulary entries to this token by cosine similarity; the nearest is the most alike.",
  prediction: "The next-token candidates by how high the model scores each; the winner sits closest, in red.",
  lens: "What the model would predict if it stopped at each layer. Drag the slider to watch the winner climb to the center.",
};

/** The compact drawer card: a deliberately simplified view, reachable from
 *  inspecting a token. The concept fixes the read. */
export function GeometryCard({ ctx, read }: { ctx: ExplainCtx; read: Read }) {
  // during a walk the program focus belongs to the stop's highlight; hovering
  // the card must not clobber it
  const { setProgramFocus, walk } = useExplainer();
  const onHover = walk ? undefined : setProgramFocus;
  return (
    <div className="geo-card">
      <GeometryView trace={ctx.trace} step={ctx.step} cur={ctx.cur} prod={ctx.prod} read={read} compact onHover={onHover} />
      <p className="geo-card-note">{CARD_NOTE[read]}</p>
    </div>
  );
}
