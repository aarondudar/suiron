import { useEffect, useRef } from "react";
import { ExplainerBody, useExplainer } from "./Explainer";
import { CONCEPTS, type ExplainCtx } from "./Explanations";

/* The concept card: the explanation living inside the band it explains. App
   renders exactly one of these, handed to the active concept's host band (per
   CARD_HOME) and mounted right under that band's header; every other band dims
   (the spotlight). Renders the concept generically via ExplainerBody — the
   registry (intros, interactives, rungs) is untouched, only the surface moved
   here from the old right-hand drawer. Esc or × closes. When the card opens
   off-screen (a cross-band jump), it scrolls itself into view; when it is
   already visible (browsing concepts within one band), it stays put. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ConceptCard({ ctx }: { ctx: ExplainCtx | null }) {
  const { active, close, walk } = useExplainer();
  const ref = useRef<HTMLDivElement>(null);

  // Esc closes the card (App's own Esc additionally exits a running walk)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, close]);

  // bring the card into view when it opens somewhere off-screen
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const r = el.getBoundingClientRect();
    const visible = r.top >= 0 && r.top < window.innerHeight * 0.7;
    if (!visible)
      el.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" });
  }, [active]);

  if (!active) return null;
  const concept = CONCEPTS[active];

  return (
    <div
      className="concept-card"
      data-explain-card
      role="region"
      aria-label={concept?.title ?? "explain"}
      ref={ref}
    >
      <div className="card-head">
        <span className="card-title">{concept?.title ?? active}</span>
        {walk && (
          <span className="card-stop">
            {walk.index + 1} / {walk.total}
          </span>
        )}
        <button className="card-x" onClick={close} aria-label="close">
          ×
        </button>
      </div>
      {!concept || !ctx ? (
        <div className="card-empty">nothing to explain yet: run a prompt first.</div>
      ) : (
        // keyed by concept so hotVar (the woven linked-highlight) resets on switch
        <ExplainerBody key={active} concept={concept} ctx={ctx} />
      )}
    </div>
  );
}
