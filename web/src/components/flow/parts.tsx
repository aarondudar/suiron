import type { CSSProperties } from "react";
import { esc } from "../../lib";
import type { Trace } from "../../types";

/* Shared flow furniture: the step vocabulary, the entrance-order delays, the
   machine map, and the token chips. Split out of Flow.tsx (audit follow-up) —
   presentation only, no state. */

/** step vocabulary from docs/design.md — fix it there first (6 = the finale) */
export const STEPS = ["begin", "tokens", "looks back", "sharpens", "draws one", "loops", "the end"] as const;

export const VOCAB = 151_936;

/** The finale hosts the unchanged Epilogue, whose <Explain> anchors need an
 *  Explainer context. The flow has no concept cards, so they quietly no-op. */
export const NOOP_EXPLAINER = {
  active: null,
  walk: null,
  open: () => {},
  close: () => {},
  setProgramFocus: () => {},
};

/* the entrance order (docs/storyboard.md §3): staged delays on each tier via the
   --fl-d custom property, consumed by .fl-enter. H → beat → hero → C → A → dock.
   Under reduced motion the CSS drops the animation, so these are inert. */
const enterDelay = (s: string): CSSProperties => ({ ["--fl-d" as string]: s }) as CSSProperties;
export const hDelay = enterDelay("0s");
export const heroDelay = enterDelay("0.3s");
export const cDelay = enterDelay("0.6s");
export const aDelay = enterDelay("0.8s");
export const dockDelay = enterDelay("1s");

/** The machine map, demoted to chrome (docs/storyboard.md + copy addendum):
 *  the smallest strip, steps 2–4 only, script-owned string, one marker moving
 *  looks back (2) → the ×N rounds (3) → a guess (4). The word "rounds" relabels
 *  to "layers" at step 3, the moment the aside introduces the term (the map
 *  learns the word with the reader). "vectors" and "scores" never appear.
 *  On step 2 it enters once with a left-to-right draw (`intro`). */
type MapAt = "look" | "rounds" | "guess";
export function MachineMap({ trace, n, at, intro }: { trace: Trace; n: number; at: MapAt; intro?: boolean }) {
  const roundsWord = at === "look" ? "rounds" : "layers";
  return (
    <div
      className={"fl-map" + (intro ? " fl-map-intro" : "")}
      aria-label="the machine, at a glance"
    >
      <span className="fl-map-box">
        <b>{n} pieces</b>
      </span>
      <span className="fl-map-arrow">→</span>
      <span className="fl-map-box">
        <b className={at === "look" ? "on" : undefined}>look back</b>
      </span>
      <span className="fl-map-arrow">→</span>
      <span className="fl-map-box">
        <b>rework</b>
      </span>
      <span className="fl-map-sep"> · </span>
      <span className={"fl-map-x" + (at === "rounds" ? " on" : "")}>
        × {trace.layers} {roundsWord}
      </span>
      <span className="fl-map-arrow">→</span>
      <span className="fl-map-box">
        <b className={at === "guess" ? "on" : undefined}>a guess</b>
      </span>
    </div>
  );
}

/** one token as a chip (the tokens-step hero; the loop/worlds views draw their
 *  own chips). `delay` staggers the split-into-pieces arrival. */
function Chip({ trace, pos, delay }: { trace: Trace; pos: number; delay?: number }) {
  const tok = trace.tokens[pos];
  if (!tok) return null;
  return (
    <span
      className="fl-chip"
      style={delay !== undefined ? { animationDelay: `${delay}s` } : undefined}
      data-id={tok.id}
      title={`id ${tok.id} · pos ${pos}`}
    >
      {esc(tok.t)}
    </span>
  );
}

/** the sentence as tokens: real resident tokens [0, n) */
export function Sentence({
  trace,
  n,
  stagger,
  showIds,
}: {
  trace: Trace;
  n: number;
  stagger?: boolean;
  /** surface each chip's token id on hover (the tokens step) */
  showIds?: boolean;
}) {
  return (
    <div className={"fl-sentence" + (stagger ? " stagger" : "") + (showIds ? " fl-ids" : "")}>
      {trace.tokens.slice(0, n).map((_, i) => (
        <Chip key={i} trace={trace} pos={i} delay={stagger ? Math.min(i, 16) * 0.07 : undefined} />
      ))}
    </div>
  );
}
