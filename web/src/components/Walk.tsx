import type { FocusTarget } from "../types";

/* The walk: a guided read of the page top to bottom, one token's whole life.
   Each stop opens the Explainer (docked) to a concept, lights the real
   instrument via the program focus, and scrolls that element into view. Manual
   stepping only — no autoplay. The list is the entire choreography; the orchestration
   lives in App (it owns the focus + drawer + scroll state). */

export interface WalkStop {
  /** the concept the drawer opens to (also supplies the highlight + scroll target) */
  concept: string;
  /** short label shown in the control bar */
  label: string;
  /** attention stop opens a layer's detail so its heads are visible */
  expandLayer?: boolean;
  /** optional prompt-derived layer to expand instead of the default: the curated
   *  moment of this kind decides which layer mattered for this prompt */
  expandMoment?: "attention-lock";
}

// one token's whole life, in order: born from the text, turned into a vector,
// placed, processed layer by layer, accumulated, scored, resolved, chosen.
export const WALK: WalkStop[] = [
  { concept: "model", label: "what this is" },
  { concept: "settings", label: "the settings" },
  { concept: "tokenization", label: "tokens" },
  { concept: "embedding", label: "the vector" },
  { concept: "position", label: "where it sits" },
  { concept: "attention", label: "attention", expandLayer: true, expandMoment: "attention-lock" },
  { concept: "feedforward", label: "feed-forward" },
  { concept: "residual", label: "the running total" },
  { concept: "logits", label: "the prediction" },
  { concept: "geometry", label: "what comes next" },
  { concept: "lens", label: "the climb" },
  { concept: "draw", label: "the draw" },
  { concept: "loop", label: "and then repeat" },
];

/** The element a focus target points at, as a `data-explain-el` selector. The
 *  walk scrolls to this; returns null when there is nothing to scroll to. */
export function focusSelector(f: FocusTarget): string | null {
  switch (f.kind) {
    case "token":
      return `[data-explain-el="token-${f.pos}"]`;
    case "layer":
      return `[data-explain-el="layer-dots-${f.layer}"]`;
    case "el":
      return `[data-explain-el="${f.ref}"]`;
    default:
      return null;
  }
}

export function WalkBar({
  index,
  title,
  onPrev,
  onNext,
  onExit,
}: {
  index: number;
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const total = WALK.length;
  return (
    <div className="walk-bar" role="toolbar" aria-label="walk this token">
      <button className="walk-step" onClick={onPrev} title="previous stage" aria-label="previous">
        ◀
      </button>
      <span className="walk-where">
        <b>{index + 1}</b> / {total} · {title}
      </span>
      <button className="walk-step" onClick={onNext} title="next stage" aria-label="next">
        ▶
      </button>
      <button className="walk-x" onClick={onExit} title="end walk" aria-label="end walk">
        ×
      </button>
    </div>
  );
}
