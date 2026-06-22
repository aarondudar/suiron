import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTrace } from "./api";
import { Controls } from "./components/Controls";
import { EmptyState } from "./components/EmptyState";
import { Explain, Explainer, ExplainerProvider } from "./components/Explainer";
import { CONCEPTS, type ExplainCtx } from "./components/Explanations";
import { Geometry } from "./components/Geometry";
import { LayerStack } from "./components/LayerStack";
import { Logits } from "./components/Logits";
import { Quantization } from "./components/Quantization";
import { Selection } from "./components/Selection";
import { TokenStrip } from "./components/TokenStrip";
import { focusSelector, WALK, WalkBar } from "./components/Walk";
import { DEFAULT_PARAMS } from "./lib";
import type { FocusTarget, GenParams, Trace } from "./types";

const NONE: FocusTarget = { kind: "none" };
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function App() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [cur, setCur] = useState(0);
  const [openLayer, setOpenLayer] = useState(-1);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS);

  // the open Explainer concept, and the focus the lab is lighting up. Focus has
  // three sources resolved by priority: a transient hover, a programmatic
  // writer (reserved for the band-05 stepper, fed via the Explainer context),
  // and the open concept's sticky highlight.
  const [active, setActive] = useState<string | null>(null);
  const [hoverFocus, setHoverFocus] = useState<FocusTarget>(NONE);
  const [progFocus, setProgFocus] = useState<FocusTarget>(NONE);
  /** the walk: index of the active stop, or null when not walking */
  const [walk, setWalk] = useState<number | null>(null);
  const walkRef = useRef(walk);
  walkRef.current = walk;
  /** front door: an example was launched with "take the tour"; open the walk
   *  once it produces a generated token (the tour itself steps manually) */
  const [pendingTour, setPendingTour] = useState(false);
  /** the one-time "take the guided tour" nudge after a plain run */
  const [hintDone, setHintDone] = useState(() => localStorage.getItem("suiron-tour-hint") === "1");

  const lastSeq = useRef(-1);
  const curRef = useRef(cur);
  curRef.current = cur;
  /** set by generate / step+1: the next growth advances the view to the
   *  frontier once, so a fresh run jumps to its output even after a scrub-back */
  const jumpRef = useRef(false);

  // poll: fast while the model is generating, slow when idle
  useEffect(() => {
    let timer: number;
    let dead = false;
    const tick = async () => {
      try {
        const t = await getTrace();
        if (dead) return;
        if (t.seq !== lastSeq.current) {
          const grewTo = t.tokens.length - 1;
          lastSeq.current = t.seq ?? -1;
          setTrace((prev) => {
            const grew = !prev || t.tokens.length > prev.tokens.length;
            // advance on a fresh run / step, or when already parked on the
            // frontier — never yank a user who scrubbed back mid-stream
            const atFrontier = prev && curRef.current === prev.tokens.length - 1;
            if (grew && grewTo >= 0 && (jumpRef.current || atFrontier)) {
              setCur(grewTo);
              jumpRef.current = false;
            }
            return t;
          });
        }
        timer = window.setTimeout(tick, t.busy ? 250 : 1200);
      } catch {
        timer = window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, []);

  // keyboard scrubbing
  const nTokens = trace?.tokens.length ?? 0;
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") setCur((c) => Math.min(nTokens - 1, c + 1));
      if (e.key === "ArrowLeft") setCur((c) => Math.max(0, c - 1));
    },
    [nTokens],
  );
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);

  // the Explainer context: anchors call open(); the future stepper writes the
  // programmatic focus through setProgramFocus.
  const explainer = useMemo(
    () => ({
      active,
      docked: walk !== null,
      open: (id: string) => setActive(id),
      close: () => setActive(null),
      setProgramFocus: setProgFocus,
    }),
    [active, walk],
  );

  const safeCur = trace ? Math.min(cur, trace.tokens.length - 1) : 0;
  const step = trace && trace.tokens.length ? trace.steps[safeCur] : undefined;

  // one context, built per render from trace + viewing state; nothing here
  // triggers an engine call.
  const ctx: ExplainCtx | null =
    trace && step
      ? {
          trace,
          cur: safeCur,
          step,
          sel: step.sel,
          params,
          layer: openLayer >= 0 ? openLayer : Math.floor(trace.layers / 2),
        }
      : null;

  // resolve the effective focus: hover (transient) > program > the open
  // concept's sticky highlight.
  const sticky: FocusTarget =
    active && ctx && CONCEPTS[active]?.highlight ? CONCEPTS[active].highlight!(ctx) : NONE;
  const focus: FocusTarget =
    hoverFocus.kind !== "none" ? hoverFocus : progFocus.kind !== "none" ? progFocus : sticky;

  // an `el` focus lights up any element carrying the matching data attribute,
  // so registering a new anchor is just markup.
  const elRef = focus.kind === "el" ? focus.ref : null;
  useEffect(() => {
    if (!elRef) return;
    const els = document.querySelectorAll(`[data-explain-el="${elRef}"]`);
    els.forEach((el) => el.classList.add("el-focus"));
    return () => els.forEach((el) => el.classList.remove("el-focus"));
  }, [elRef]);

  // ---- the walk: a guided read of the page, one token's whole life ----
  const exitWalk = () => {
    setWalk(null);
    setActive(null);
    setProgFocus(NONE);
  };
  // apply a walk stop: open its concept, light its instrument, optionally scroll.
  // ◀/▶/entry scroll; re-anchoring after a token change does not (the user moved).
  const applyStop = (i: number, scroll: boolean) => {
    if (!ctx || i < 0 || i >= WALK.length) {
      exitWalk();
      return;
    }
    const stop = WALK[i];
    if (stop.expandLayer) setOpenLayer(ctx.layer);
    setActive(stop.concept);
    const tgt = CONCEPTS[stop.concept]?.highlight?.(ctx) ?? NONE;
    setProgFocus(tgt);
    setWalk(i);
    if (scroll) {
      const sel = focusSelector(tgt);
      if (sel)
        requestAnimationFrame(() =>
          document
            .querySelector(sel)
            ?.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" }),
        );
    }
  };
  const dismissHint = () => {
    setHintDone(true);
    try {
      localStorage.setItem("suiron-tour-hint", "1");
    } catch {
      /* private mode — fine, just won't persist */
    }
  };
  const goToStop = (i: number) => {
    dismissHint(); // taking the tour retires the nudge
    applyStop(i, true);
  };

  // scrubbing or forking to another token keeps the walk alive and follows the
  // token: re-anchor the current stop to the new token, without yanking scroll.
  useEffect(() => {
    if (walkRef.current !== null) applyStop(walkRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeCur]);

  // Esc ends the walk
  useEffect(() => {
    if (walk === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setWalk(null);
        setActive(null);
        setProgFocus(NONE);
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [walk]);

  // front door: once the "run + tour" example has produced a generated token and
  // generation is idle, open the walk at its first stop. Generation itself is
  // never auto-run beyond the single requested example; the walk steps manually.
  useEffect(() => {
    if (!pendingTour || !trace || trace.busy) return;
    if (trace.tokens.length > trace.n_prompt) {
      setPendingTour(false);
      goToStop(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, pendingTour]);

  if (!trace) return <div className="label">connecting to suiron…</div>;

  const hasTokens = trace.tokens.length > 0;
  // while running, show what's actually running; otherwise what's selected
  const activeBackend = trace.busy ? trace.backend ?? params.backend : params.backend;

  return (
    <ExplainerProvider value={explainer}>
      <header>
        <div>
          <div className="brand">
            suiron<span className="jp">推論</span>
          </div>
          <div className="spec" data-explain-el="spec">
            <Explain of="model">
              {trace.model.toLowerCase()} · {trace.quant} · {trace.layers} layers · {trace.heads}h/
              {trace.kv_heads}kv · {trace.n_prompt} prompt +{" "}
              {Math.max(0, trace.tokens.length - trace.n_prompt)} generated
            </Explain>
          </div>
        </div>
        <div className="head-right">
          <div className="pos">
            <span className={"be-tag be-" + activeBackend}>{activeBackend}</span>
            token <b>{hasTokens ? safeCur : 0}</b> / {Math.max(0, trace.tokens.length - 1)}
            <span
              className={
                "dot-live" + (trace.busy ? " on" : "") + (activeBackend === "q8" ? " fast" : "")
              }
            />
          </div>
        </div>
      </header>

      <Controls
        busy={!!trace.busy}
        hasTokens={hasTokens}
        prompt={prompt}
        setPrompt={setPrompt}
        params={params}
        setParams={setParams}
        onGenerate={() => {
          jumpRef.current = true;
        }}
        onStep={() => {
          jumpRef.current = true;
        }}
        onWalk={() => goToStop(0)}
        canWalk={hasTokens && safeCur >= trace.n_prompt}
      />

      {!hasTokens && (
        <EmptyState
          trace={trace}
          onPick={setPrompt}
          params={params}
          onGenerate={() => {
            jumpRef.current = true;
            setPendingTour(true); // the empty-state chips are "run + take the tour"
          }}
        />
      )}

      {hasTokens && safeCur >= trace.n_prompt && walk === null && !hintDone && (
        <div className="tour-hint">
          new here?{" "}
          <button className="tour-hint-go" onClick={() => goToStop(0)}>
            ▶ take the guided tour
          </button>
          <button className="tour-hint-x" onClick={dismissHint} aria-label="dismiss">
            ×
          </button>
        </div>
      )}

      {hasTokens && step && (
        <>
          <div className="lifecycle-lead">
            one token's life, top to bottom: input → prediction → the next token
          </div>
          <TokenStrip trace={trace} step={step} cur={safeCur} setCur={setCur} focus={focus} />
          <LayerStack
            trace={trace}
            step={step}
            nPos={safeCur + 1}
            openLayer={openLayer}
            setOpenLayer={setOpenLayer}
            setHover={setHoverFocus}
            focus={focus}
          />
          <Logits step={step} cur={safeCur} busy={!!trace.busy} setHover={setHoverFocus} />
          <Geometry trace={trace} step={step} cur={safeCur} active={active} setHover={setHoverFocus} />
          <Selection sel={step.sel} isPrompt={safeCur < trace.n_prompt} />
          <div className="aside-divider">the same model, faster · an aside, not a step</div>
          <Quantization trace={trace} params={params} setParams={setParams} busy={!!trace.busy} />
        </>
      )}

      <footer>
        <span>
          suiron · 推論 · a from-scratch LLM inference engine in Rust, verified token-for-token
          against llama.cpp
        </span>
        <span>
          <a href="https://github.com/aarondudar/suiron" target="_blank" rel="noopener noreferrer">
            github.com/aarondudar/suiron
          </a>{" "}
          · Aaron Dudar
        </span>
      </footer>

      {walk !== null && (
        <WalkBar
          index={walk}
          title={WALK[walk].label}
          onPrev={() => goToStop(walk - 1)}
          onNext={() => goToStop(walk + 1)}
          onExit={exitWalk}
        />
      )}
      <Explainer ctx={ctx} />
    </ExplainerProvider>
  );
}
