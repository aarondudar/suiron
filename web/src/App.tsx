import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generate, getTrace, stop } from "./api";
import { Controls } from "./components/Controls";
import { ConceptCard } from "./components/ConceptCard";
import { EmptyState } from "./components/EmptyState";
import { Epilogue } from "./components/Epilogue";
import { Explain, ExplainerProvider } from "./components/Explainer";
import { CARD_HOME, CONCEPTS, type ExplainCtx } from "./components/Explanations";
import { Geometry } from "./components/Geometry";
import { LayerStack } from "./components/LayerStack";
import { Logits } from "./components/Logits";
import { Quantization } from "./components/Quantization";
import { Selection } from "./components/Selection";
import { TokenStrip } from "./components/TokenStrip";
import { Welcome, WELCOME_SEEN_KEY } from "./components/Welcome";
import { WALK, WalkBar } from "./components/Walk";
import type { Experiment } from "./experiments";
import { currentLink, decodeLink, encodeLink, matchesResident, residentPrompt } from "./link";
import { DEFAULT_PARAMS, moments } from "./lib";
import type { FocusTarget, GenParams, Trace } from "./types";

// a deep link parsed once at load (docs/20); state initializers read it and the
// restore effect below rebuilds the run + view
const INITIAL_LINK = decodeLink(window.location.hash);

const NONE: FocusTarget = { kind: "none" };
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function App() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [cur, setCur] = useState(0);
  const [openLayer, setOpenLayer] = useState(-1);
  const [prompt, setPrompt] = useState(INITIAL_LINK?.p ?? "");
  const [params, setParams] = useState<GenParams>(
    INITIAL_LINK
      ? {
          ...DEFAULT_PARAMS,
          n: INITIAL_LINK.n,
          temp: INITIAL_LINK.temp,
          top_k: INITIAL_LINK.top_k,
          top_p: INITIAL_LINK.top_p,
          seed: INITIAL_LINK.seed,
        }
      : DEFAULT_PARAMS,
  );

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
  /** the first-visit welcome overlay; remembered so returning visitors are not
   *  re-prompted, reopenable from the header "about" affordance */
  const [welcomeOpen, setWelcomeOpen] = useState(
    () => localStorage.getItem(WELCOME_SEEN_KEY) !== "1",
  );
  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      /* private mode — fine, just won't persist */
    }
  }, []);
  /** demo mode (docs/19): a read that isn't in the shipped recording raises a
   *  transient honest note */
  const [demoMiss, setDemoMiss] = useState(false);
  useEffect(() => {
    let timer: number;
    const onMiss = () => {
      setDemoMiss(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDemoMiss(false), 4000);
    };
    window.addEventListener("suiron-demo-miss", onMiss);
    return () => {
      window.removeEventListener("suiron-demo-miss", onMiss);
      window.clearTimeout(timer);
    };
  }, []);
  const openGoLive = () => window.dispatchEvent(new CustomEvent("suiron-open-golive"));

  /** the running curated experiment (docs/21); its watch-for line frames the
   *  run until the user generates something of their own */
  const [exp, setExp] = useState<Experiment | null>(null);
  const runExperiment = useCallback(
    (e: Experiment) => {
      if (trace?.demo) {
        // the recording can't run other prompts; experiments need the engine
        openGoLive();
        return;
      }
      const p: GenParams = { ...DEFAULT_PARAMS, backend: params.backend, ...e.params };
      setPrompt(e.prompt);
      setParams(p);
      setExp(e);
      jumpRef.current = true;
      if (trace && trace.tokens.length === 0) setPendingTour(true); // first run: offer the tour
      void generate(e.prompt, p);
      requestAnimationFrame(() =>
        window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }),
      );
    },
    [trace, params.backend],
  );

  /** the epilogue chat dropdown. While open it owns the single resident model:
   *  opening halts any running lab generation and locks the main controls. */
  const [chatOpen, setChatOpen] = useState(false);
  const toggleChat = useCallback(
    (v: boolean) => {
      // in demo mode there is no engine to chat with — offer going live instead
      if (v && trace?.demo) {
        openGoLive();
        return;
      }
      setChatOpen(v);
      if (v) void stop(); // chat takes over the resident model
    },
    [trace?.demo],
  );
  // open chat from the epilogue and bring the (now chat) prompt box into view
  const onTryChat = useCallback(() => {
    toggleChat(true);
    requestAnimationFrame(() =>
      document
        .querySelector('[data-explain-el="ctl-params"]')
        ?.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" }),
    );
  }, [toggleChat]);

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
      walk: walk !== null ? { index: walk, total: WALK.length } : null,
      open: (id: string) => setActive(id),
      close: () => setActive(null),
      setProgramFocus: setProgFocus,
    }),
    [active, walk],
  );

  const safeCur = trace ? Math.min(cur, trace.tokens.length - 1) : 0;
  const step = trace && trace.tokens.length ? trace.steps[safeCur] : undefined;
  // Inspecting a token is a read of HOW IT WAS PRODUCED. The forward pass that
  // produced `cur` ran at the previous position, so the production bands
  // (attention, the prediction, the lens) read `prodStep = steps[cur-1]`. The
  // draw that picked `cur` stays at `steps[cur].sel`. `cur` is the seed (the
  // first token) when there is no producing step.
  const prod = safeCur - 1;
  const prodStep = trace && prod >= 0 ? trace.steps[prod] : undefined;

  // one context, built per render from trace + viewing state; nothing here
  // triggers an engine call.
  const ctx: ExplainCtx | null =
    trace && step
      ? {
          trace,
          cur: safeCur,
          prod,
          step: prodStep ?? step, // the producing step (falls back to cur's own at the seed)
          sel: step.sel, // the draw that picked `cur`
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
  // apply a walk stop: open its concept (the card scrolls itself into view when
  // it lands off-screen) and light its instrument. Re-anchoring after a token
  // change re-runs this with the same concept, which changes nothing visual.
  const applyStop = (i: number) => {
    if (!ctx || i < 0 || i >= WALK.length) {
      exitWalk();
      return;
    }
    const stop = WALK[i];
    let tgt = CONCEPTS[stop.concept]?.highlight?.(ctx) ?? NONE;
    if (stop.expandLayer) {
      // point the attention stop at this prompt's attention-lock layer, and
      // light that same layer (not the stale default)
      let layer = ctx.layer;
      if (stop.expandMoment === "attention-lock") {
        const m = moments(ctx.trace, ctx.prod).find((mk) => mk.kind === "attention");
        if (m?.layer !== undefined) layer = m.layer;
      }
      setOpenLayer(layer);
      if (stop.expandMoment) tgt = { kind: "layer", layer };
    }
    setActive(stop.concept);
    setProgFocus(tgt);
    setWalk(i);
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
    applyStop(i);
  };

  // scrubbing or forking to another token keeps the walk alive and follows the
  // token: re-anchor the current stop to the new token.
  useEffect(() => {
    if (walkRef.current !== null) applyStop(walkRef.current);
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

  // ---- deep links (docs/20): restore the linked moment, keep the URL current ----
  const pendingLink = useRef(INITIAL_LINK);
  /** trace.seq when the restore re-run was fired; null = not fired */
  const linkFiredAt = useRef<number | null>(null);
  const [linkMiss, setLinkMiss] = useState(false);
  useEffect(() => {
    const link = pendingLink.current;
    if (!link || !trace || trace.busy) return;
    const applyView = () => {
      pendingLink.current = null;
      setLinkMiss(false);
      const last = trace.tokens.length - 1;
      if (link.cur !== undefined && last >= 0) setCur(Math.max(0, Math.min(last, link.cur)));
      if (link.layer !== undefined) setOpenLayer(link.layer);
      if (link.walk !== undefined) goToStop(Math.max(0, Math.min(WALK.length - 1, link.walk)));
      else if (link.c && CONCEPTS[link.c]) setActive(link.c);
    };
    // the resident run already is this link (a demo link, a reload, or our own
    // re-run once it settles): just apply the view
    if (matchesResident(link, trace)) {
      applyView();
      return;
    }
    if (linkFiredAt.current !== null) {
      // our re-run settled on something else (engine truth wins): show it as-is
      if (trace.seq !== linkFiredAt.current && trace.tokens.length > trace.n_prompt) applyView();
      return;
    }
    if (trace.demo) {
      // the recording can't run other prompts; the link survives go-live and
      // restores on the real engine afterwards
      setLinkMiss(true);
      return;
    }
    // rebuild the run: deterministic at the link's fixed seed
    linkFiredAt.current = trace.seq ?? 0;
    jumpRef.current = link.cur === undefined; // the link's cur decides the view
    generate(link.p, {
      ...DEFAULT_PARAMS,
      n: link.n,
      temp: link.temp,
      top_k: link.top_k,
      top_p: link.top_p,
      seed: link.seed,
      backend: params.backend,
    }).catch(() => {
      pendingLink.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace]);

  // write the current moment into the hash (replace, never push) so the address
  // bar is always a shareable link; silent while a restore is still pending
  useEffect(() => {
    if (pendingLink.current || !trace || trace.busy) return;
    const l = currentLink(trace, { cur: safeCur, c: active, walk, layer: openLayer });
    if (!l && !window.location.hash) return;
    const timer = window.setTimeout(() => {
      history.replaceState(
        null,
        "",
        l ? "#" + encodeLink(l) : window.location.pathname + window.location.search,
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [trace, safeCur, active, walk, openLayer]);

  // copy a link to this exact view, built from live state so it is never stale
  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    if (!trace) return;
    const l = currentLink(trace, { cur: safeCur, c: active, walk, layer: openLayer });
    if (!l) return;
    const url =
      window.location.origin +
      window.location.pathname +
      window.location.search +
      "#" +
      encodeLink(l);
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (!trace) return <div className="label">connecting to suiron…</div>;

  const hasTokens = trace.tokens.length > 0;
  // while running, show what's actually running; otherwise what's selected
  const activeBackend = trace.busy ? trace.backend ?? params.backend : params.backend;

  // the open concept's card renders inside its host band (docs/16); with no
  // tokens only band 00 exists, so everything falls back there. All other
  // bands dim while a card is open (the spotlight).
  const home = active ? (CARD_HOME[active] ?? "00") : null;
  const host = home === null ? null : hasTokens ? home : "00";
  const cardFor = (band: string) => (host === band ? <ConceptCard ctx={ctx} /> : undefined);
  // the spotlight must never dim the band the lab is pointing INTO: when the
  // open card (or a hover) highlights an element in another band, that band
  // stays lit alongside the host.
  const focusBand = (() => {
    switch (focus.kind) {
      case "token":
        return "01";
      case "layer":
        return "02";
      case "candidate":
        return "03";
      case "el": {
        const r = focus.ref;
        if (r === "spec" || r.startsWith("ctl-")) return "00";
        if (r.startsWith("token-")) return "01";
        if (r.startsWith("layer-dots-")) return "02";
        if (r.startsWith("logit-")) return "03";
        if (r.startsWith("geo")) return "04";
        if (r === "draw-bar") return "05";
        if (r === "epilogue") return "epilogue";
        return null;
      }
      default:
        return null;
    }
  })();
  const dimFor = (band: string) => host !== null && host !== band && band !== focusBand;

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
            <button className="about-link" onClick={() => setWelcomeOpen(true)}>
              about
            </button>
            {hasTokens &&
              currentLink(trace, { cur: safeCur, c: active, walk, layer: openLayer }) && (
                <button
                  className="about-link"
                  onClick={copyLink}
                  title="copy a link to this exact view"
                >
                  {copied ? "copied ✓" : "share"}
                </button>
              )}
          </div>
        </div>
        <div className="head-right">
          <div className="pos">
            {trace.demo && (
              <button
                className="rec-tag"
                title="this is a recording of one real run; go live to drive the model yourself"
                onClick={openGoLive}
              >
                recorded · go live
              </button>
            )}
            <span className={"be-tag be-" + activeBackend}>{activeBackend}</span>
            {!hasTokens ? (
              <>token <b>0</b></>
            ) : prod >= 0 ? (
              <>token <b>{safeCur}</b> · from <b>{prod}</b></>
            ) : (
              <>token <b>0</b> · start</>
            )}
            <span
              className={
                "dot-live" + (trace.busy ? " on" : "") + (activeBackend === "q8" ? " fast" : "")
              }
            />
          </div>
        </div>
      </header>

      {demoMiss && (
        <div className="demo-miss">
          not in this recording ·{" "}
          <button className="tour-hint-go" onClick={openGoLive}>
            go live to compute anything
          </button>
        </div>
      )}

      {linkMiss && (
        <div className="demo-miss">
          this link points at a prompt that isn't in the shipped recording ·{" "}
          <button className="tour-hint-go" onClick={openGoLive}>
            go live to run it
          </button>
          <button className="tour-hint-x" onClick={() => setLinkMiss(false)} aria-label="dismiss">
            ×
          </button>
        </div>
      )}

      <Controls
        busy={!!trace.busy}
        chatOpen={chatOpen}
        onChatToggle={toggleChat}
        demo={!!trace.demo}
        onGoLive={openGoLive}
        card={cardFor("00")}
        dim={dimFor("00")}
        hasTokens={hasTokens}
        prompt={prompt}
        setPrompt={setPrompt}
        params={params}
        setParams={setParams}
        onGenerate={() => {
          setExp(null); // a run of your own retires the experiment framing
          jumpRef.current = true;
        }}
        onStep={() => {
          jumpRef.current = true;
        }}
        onWalk={() => goToStop(0)}
        canWalk={hasTokens && safeCur >= trace.n_prompt}
      />

      {!hasTokens && <EmptyState onRun={runExperiment} />}

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
          {exp && residentPrompt(trace) === exp.prompt && (
            <div className="watch-for">
              <span className="watch-for-tag">experiment · {exp.title}</span> {exp.watchFor}
            </div>
          )}
          {prodStep && (
            <div className="lifecycle-lead">
              how this token was produced, top to bottom: the read head (the token before it) reads
              the context → the prediction forms → the draw picks it
            </div>
          )}
          <TokenStrip
            trace={trace}
            step={prodStep ?? step}
            cur={safeCur}
            prod={prod}
            setCur={setCur}
            focus={focus}
            card={cardFor("01")}
            dim={dimFor("01")}
          />
          {prodStep ? (
            <>
              <LayerStack
                trace={trace}
                step={prodStep}
                nPos={safeCur}
                openLayer={openLayer}
                setOpenLayer={setOpenLayer}
                setHover={setHoverFocus}
                focus={focus}
                lensActive={active === "lens"}
                card={cardFor("02")}
                dim={dimFor("02")}
              />
              <Logits
                trace={trace}
                step={prodStep}
                cur={safeCur}
                busy={!!trace.busy}
                demo={!!trace.demo}
                setHover={setHoverFocus}
                card={cardFor("03")}
                dim={dimFor("03")}
              />
              <Geometry
                trace={trace}
                step={prodStep}
                cur={safeCur}
                prod={prod}
                active={active}
                setHover={setHoverFocus}
                card={cardFor("04")}
                dim={dimFor("04")}
              />
              <Selection
                trace={trace}
                cur={safeCur}
                sel={step.sel}
                isPrompt={safeCur < trace.n_prompt}
                card={cardFor("05")}
                dim={dimFor("05")}
              />
            </>
          ) : (
            <div className="seed-note">
              This is the first token in the sequence. The model did not predict it; generation
              starts from the tokens you provide. Move right (→) to a token the model produced to
              see how it was made.
            </div>
          )}
          <div className="aside-divider">the same model, faster · an aside, not a step</div>
          <Quantization
            trace={trace}
            params={params}
            setParams={setParams}
            busy={!!trace.busy}
            card={cardFor("06")}
            dim={dimFor("06")}
          />
          <Epilogue
            onTryChat={onTryChat}
            onRun={runExperiment}
            card={cardFor("epilogue")}
            dim={dimFor("epilogue")}
          />
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
          onShare={copyLink}
          shared={copied}
          onExit={exitWalk}
        />
      )}
      <Welcome open={welcomeOpen} onClose={closeWelcome} />
    </ExplainerProvider>
  );
}
