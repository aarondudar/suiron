import { createContext, useContext, useState, type ReactNode } from "react";
import type { FocusTarget } from "../types";
import { CONCEPTS, type Concept, type ExplainCtx, type ExplainRung } from "./Explanations";

/* The Explainer: one on-demand explanation surface, summoned per concept by
   quiet <Explain of="…"/> anchors. A right-side drawer on desktop, a bottom
   sheet on mobile. It renders the active concept generically (intro, rungs,
   interactive, highlight) and never branches on which concept it is. */

interface ExplainerApi {
  /** id of the open concept, or null when closed */
  active: string | null;
  /** the guided walk, when one is running: which stop the card belongs to.
   *  Interactives also use this to leave the walk's program focus alone. */
  walk: { index: number; total: number } | null;
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

/** A standalone hot-var scope for hosts outside ExplainerBody (the flow's
 *  woven-code drawer): without a provider the context default is a NO-OP and
 *  hovering a code variable silently does nothing. */
export function HotVarScope({ children }: { children: ReactNode }) {
  const [hot, setHot] = useState<string | null>(null);
  return <HotVarCtx.Provider value={{ hot, setHot }}>{children}</HotVarCtx.Provider>;
}

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

/** Renders one concept generically (intro → interactive → rungs) and owns the
 *  card-scoped hotVar for the woven view. Never branches on which concept.
 *  Rendered by ConceptCard (the inline card inside the concept's host band). */
export function ExplainerBody({ concept, ctx }: { concept: Concept; ctx: ExplainCtx }) {
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
