import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { FocusTarget } from "../types";
import { CONCEPTS, type Concept, type ExplainCtx, type ExplainRung } from "./Explanations";

/* The Explainer: one on-demand explanation surface, summoned per concept by
   quiet <Explain of="…"/> anchors. A right-side drawer on desktop, a bottom
   sheet on mobile. It renders the active concept generically (intro, rungs,
   interactive, highlight) and never branches on which concept it is. */

interface ExplainerApi {
  /** id of the open concept, or null when closed */
  active: string | null;
  /** docked mode (during a walk): no scrim, the page stays visible and lit */
  docked: boolean;
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

/** A per-concept trigger: the explained text itself opens the Explainer. Wrap
 *  the label or title in it — `<Explain of="temperature">temp</Explain>` — or
 *  pass `label` for the same as a string. The text reads normally at rest and
 *  highlights on hover / focus / tap (no separate "?" badge). It stops
 *  propagation so the host's primary click (force a token, edit an input,
 *  inspect) is untouched. The bare "?" disc remains only as a fallback when no
 *  text is given. */
export function Explain({ of, label, children }: { of: string; label?: string; children?: ReactNode }) {
  const { open } = useExplainer();
  const title = CONCEPTS[of]?.title ?? of;
  const content = children ?? label;
  return (
    <button
      type="button"
      className={content != null ? "explain-link" : "explain-anchor"}
      aria-label={`explain: ${title}`}
      title={`explain: ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        open(of);
      }}
    >
      {content ?? "?"}
    </button>
  );
}

/* Drawer-scoped linked highlighting for the woven "under the hood" view: the
   hovered/tapped name shared between the prose <Term>, the code variables, and
   the value readout. Deliberately NOT the global FocusTarget — these are
   micro-elements inside one open concept, reset whenever the concept changes. */
interface HotVar {
  hot: string | null;
  setHot: (v: string | null) => void;
}
const HotVarCtx = createContext<HotVar>({ hot: null, setHot: () => {} });
export const useHotVar = () => useContext(HotVarCtx);

/** A key term in the prose that links to a code variable + its value. Highlights
 *  (never red) in sync with the matching code name and the readout. */
export function Term({ name, children }: { name: string; children: ReactNode }) {
  const { hot, setHot } = useHotVar();
  return (
    <b
      className={"uh-term" + (hot === name ? " hot" : "")}
      onMouseEnter={() => setHot(name)}
      onMouseLeave={() => setHot(null)}
      onClick={() => setHot(hot === name ? null : name)}
    >
      {children}
    </b>
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
  const { active, docked, close } = useExplainer();

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
      {/* docked (walk) mode has no scrim so the lit instrument stays visible */}
      {!docked && <div className="explainer-scrim" onClick={close} />}
      <aside
        className={"explainer" + (docked ? " docked" : "")}
        role="dialog"
        aria-label={concept?.title ?? "explain"}
      >
        <div className="explainer-head">
          <span className="explainer-title">{concept?.title ?? active}</span>
          <button className="explainer-x" onClick={close} aria-label="close">
            ×
          </button>
        </div>
        <div className="explainer-body">
          {!concept || !ctx ? (
            <div className="explainer-intro">nothing to explain yet: run a prompt first.</div>
          ) : (
            // keyed by concept so hotVar (the woven linked-highlight) resets on switch
            <ExplainerBody key={active} concept={concept} ctx={ctx} />
          )}
        </div>
      </aside>
    </>
  );
}

/** Renders one concept generically (intro → interactive → rungs) and owns the
 *  drawer-scoped hotVar for the woven view. Never branches on which concept. */
function ExplainerBody({ concept, ctx }: { concept: Concept; ctx: ExplainCtx }) {
  const [hot, setHot] = useState<string | null>(null);
  return (
    <HotVarCtx.Provider value={{ hot, setHot }}>
      <div className="explainer-intro">{concept.intro(ctx)}</div>
      {concept.interactive?.(ctx)}
      {concept.rungs?.map((r, i) => (
        <Rung key={i} rung={r} ctx={ctx} />
      ))}
    </HotVarCtx.Provider>
  );
}
