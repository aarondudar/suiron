/* The walk: a guided read of the page top to bottom, one token's whole life.
   Each stop opens a concept (its inline card mounts in the host band and
   scrolls itself into view) and lights the real instrument via the program
   focus. Manual stepping only — no autoplay. The list is the entire
   choreography; the orchestration lives in App. */

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

// one token's whole life, in strict page order — the tour only ever moves DOWN
// the instrument (band 00 → 01 → 02… → the epilogue), never back up: born from
// the text, turned into a vector, placed, processed layer by layer,
// accumulated, scored, resolved, chosen, stored smaller, and then repeated.
// (`settings` is not a stop: the draw grounds temperature/seed where they
// matter, and the settings stay anchored in band 00.)
export const WALK: WalkStop[] = [
  { concept: "model", label: "what this is" },
  { concept: "tokenization", label: "tokens" },
  { concept: "embedding", label: "the vector" },
  { concept: "position", label: "where it sits" },
  { concept: "attention", label: "attention", expandLayer: true, expandMoment: "attention-lock" },
  { concept: "kvcache", label: "what it remembers" },
  { concept: "feedforward", label: "feed-forward" },
  { concept: "residual", label: "the running total" },
  { concept: "logits", label: "the prediction" },
  { concept: "geometry", label: "what comes next" },
  { concept: "lens", label: "the climb" },
  { concept: "draw", label: "the draw" },
  { concept: "quantization", label: "stored smaller" },
  { concept: "loop", label: "and then repeat" },
];

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
