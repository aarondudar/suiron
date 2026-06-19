import { createContext, useContext, useEffect, useState } from "react";
import type { FocusTarget } from "../types";
import { CONCEPTS, type ExplainCtx, type ExplainRung } from "./Explanations";

/* The Explainer: one on-demand explanation surface, summoned per concept by
   quiet <Explain of="…"/> anchors. A right-side drawer on desktop, a bottom
   sheet on mobile. It renders the active concept generically (intro, rungs,
   interactive, highlight) and never branches on which concept it is. */

interface ExplainerApi {
  /** id of the open concept, or null when closed */
  active: string | null;
  open: (id: string) => void;
  close: () => void;
  /** FORWARD: the band-05 "token lifespan" stepper (a later step) writes the
   *  programmatic focus through here — the third focus source alongside hover
   *  and the open concept. Unused by the current UI, wired now so the stepper
   *  is a pure append. */
  setProgramFocus: (f: FocusTarget) => void;
}

const Ctx = createContext<ExplainerApi | null>(null);

export const ExplainerProvider = Ctx.Provider;

export function useExplainer(): ExplainerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useExplainer must be used inside an ExplainerProvider");
  return v;
}

/** A quiet per-concept anchor: a small superscript marker placed next to the
 *  thing it explains. Its own click only opens the Explainer — it stops
 *  propagation so the host's primary click (force a token, edit an input,
 *  inspect) is untouched. */
export function Explain({ of }: { of: string }) {
  const { open } = useExplainer();
  const title = CONCEPTS[of]?.title ?? of;
  return (
    <button
      type="button"
      className="explain-anchor"
      aria-label={`explain: ${title}`}
      title={`explain: ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        open(of);
      }}
    >
      ?
    </button>
  );
}

function Rung({ rung, ctx }: { rung: ExplainRung; ctx: ExplainCtx }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="explainer-rung">
      <button className={"expand" + (open ? " on" : "")} onClick={() => setOpen(!open)}>
        {rung.label}
      </button>
      {open && <div className="explainer-rung-body">{rung.body(ctx)}</div>}
    </div>
  );
}

export function Explainer({ ctx }: { ctx: ExplainCtx | null }) {
  const { active, close } = useExplainer();

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, close]);

  if (!active) return null;
  const concept = CONCEPTS[active];

  return (
    <>
      <div className="explainer-scrim" onClick={close} />
      <aside className="explainer" role="dialog" aria-label={concept?.title ?? "explain"}>
        <div className="explainer-head">
          <span className="explainer-title">{concept?.title ?? active}</span>
          <button className="explainer-x" onClick={close} aria-label="close">
            ×
          </button>
        </div>
        <div className="explainer-body">
          {!concept || !ctx ? (
            <div className="explainer-intro">nothing to explain yet — run a prompt first.</div>
          ) : (
            <>
              <div className="explainer-intro">{concept.intro(ctx)}</div>
              {concept.interactive?.(ctx)}
              {concept.rungs?.map((r, i) => (
                <Rung key={i} rung={r} ctx={ctx} />
              ))}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
