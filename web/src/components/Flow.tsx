import { useEffect, useRef, useState } from "react";
import { demoPrompt, fork, generate, playDemo, step as stepMore } from "../api";
import { DEFAULT_PARAMS, esc } from "../lib";
import { currentLink, decodeLink, encodeLink, matchesResident, residentPrompt } from "../link";
import { Drawer } from "./Drawer";
import type { ExplainCtx } from "./Explanations";
import type { Experiment } from "../experiments";
import { DIVES } from "./flow/dives";
import { DrawerBody, type Knob } from "./flow/FlowDrawers";
import { StepStage } from "./flow/FlowSteps";
import { flowPath } from "./flow/flowPath";
import { MachineMap, STEPS, dockDelay } from "./flow/parts";
import { useTrace } from "./flow/useTrace";

/* The guided flow — the app's spine (docs/design.md). Five steps walk one real
   prediction in the causal order it happens: tokens → looks back → sharpens →
   draws one → loops. One idea per screen; every deep-dive opens as a single
   drawer over the current step and closes back to it. Everything here reads
   LIVE from the resident trace via the same machinery the expert stack uses.

   This file is the shell: state, actions, links, and the frame. The stage
   lives in flow/FlowSteps, the drawers in flow/FlowDrawers, the sub-step
   order in flow/flowPath. */

/** a flow deep link parsed once at load (design-10); the restore effect below
 *  rebuilds the run and reassembles the moment */
const FLOW_LINK = (() => {
  const l = decodeLink(window.location.hash);
  return l?.view === "flow" ? l : null;
})();

export function Flow() {
  const { trace, refresh } = useTrace();
  const [phase, setPhase] = useState(0);
  const [prompt, setPrompt] = useState(FLOW_LINK?.p ?? "");
  /** the ONE open drawer (a DIVES id), or null. A single slot is the
   *  single-drawer rule: opening another replaces this one. */
  const [drawer, setDrawer] = useState<string | null>(null);
  const [knob, setKnob] = useState<Knob>("temperature");
  /** the climb's shown-depth guess + lock layer, reported up by LensSpace so the
   *  step-3 caption C can render them (the instrument prints no prose itself) */
  const [climbTop, setClimbTop] = useState("");
  const [lockLayer, setLockLayer] = useState<number | null>(null);
  /** which token is under the microscope; null = follow the frontier */
  const [inspect, setInspect] = useState<number | null>(null);
  /** the running curated experiment; its hook frames the run on step 1 */
  const [exp, setExp] = useState<Experiment | null>(null);
  /** the meaning drawer's picked token; null = the current token */
  const [pickTok, setPickTok] = useState<number | null>(null);
  /** the ffn drawer's inspected layer; -1 = the default (mid-stack) */
  const [ffnLayer, setFfnLayer] = useState(-1);
  /** a restored link brings its own sampler params; otherwise the defaults */
  const params = FLOW_LINK
    ? {
        ...DEFAULT_PARAMS,
        n: FLOW_LINK.n,
        temp: FLOW_LINK.temp,
        top_k: FLOW_LINK.top_k,
        top_p: FLOW_LINK.top_p,
        seed: FLOW_LINK.seed,
      }
    : DEFAULT_PARAMS;

  /** moving to another step always returns to the spine first — expressed in
   *  the nav itself (not an effect) so a restored link can land on a step
   *  WITH its drawer open */
  const goPhase = (n: number) => {
    setDrawer(null);
    setPhase(Math.max(0, Math.min(6, n)));
  };

  // the flow walks the frontier by default; an inspected token re-anchors
  // steps 2–4 to ITS production (clamped — a fork can shrink the run)
  const frontier = trace ? trace.tokens.length - 1 : -1;
  const cur = inspect === null ? frontier : Math.max(0, Math.min(inspect, frontier));
  const prod = cur - 1;
  const busy = !!trace?.busy;
  const hasRun = !!trace && trace.tokens.length > trace.n_prompt && prod >= 0;
  const prodStep = trace && hasRun ? trace.steps[prod] : undefined;
  /** the static build boots on a recording (docs/19): the flow walks it, but
   *  running anything new needs go-live (the same gate the expert view uses) */
  const demo = !!trace?.demo;
  const openGoLive = () => window.dispatchEvent(new CustomEvent("suiron-open-golive"));

  // ←/→ walk the same sub-step path as continue/back (not while typing)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // arrows walk the same sub-step path as the continue/back buttons
      if (e.key === "ArrowRight") advanceRef.current();
      if (e.key === "ArrowLeft") retreatRef.current();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  /** a new frontier invalidates every view anchored to the old one: the
   *  inspected token, the meaning-drawer pick, and the climb's caption values */
  const resetRunView = () => {
    setInspect(null);
    setPickTok(null);
    setClimbTop("");
    setLockLayer(null);
  };

  /* a run was just started but the poll has not seen it yet — the stage shows
     one steady "running…" state instead of flashing "no run yet" first (the
     first-begin flicker). Cleared the moment the trace reflects the new run. */
  const [launching, setLaunching] = useState(false);
  const launchedAt = useRef<number | null>(null);
  const markLaunch = () => {
    launchedAt.current = trace?.seq ?? -1;
    setLaunching(true);
    refresh();
  };
  useEffect(() => {
    if (!launching || !trace) return;
    if (trace.busy || (trace.seq ?? -1) !== launchedAt.current) setLaunching(false);
  }, [launching, trace]);

  const begin = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    // demo boot (docs/19): the recording's own prompt plays instantly;
    // anything else needs the real engine, so it opens go-live
    if (demo) {
      if (text === demoPrompt()) {
        resetRunView();
        setExp(null);
        playDemo();
        markLaunch();
        goPhase(1);
      } else {
        openGoLive();
      }
      return;
    }
    resetRunView(); // a new run walks its own frontier
    setExp(null); // a run of your own retires the experiment framing
    generate(text, { ...params, n: 1 })
      .then(() => refresh())
      .catch(() => {});
    markLaunch();
    goPhase(1);
  };
  const runAgain = () => {
    if (!trace || busy) return;
    if (demo) {
      openGoLive();
      return;
    }
    resetRunView();
    stepMore(1, params)
      .then(() => refresh())
      .catch(() => {});
    markLaunch();
    goPhase(1);
  };
  /** the finale's experiments run live in the flow: a curated prompt loops
   *  the learner back into the spine (same param merge as the expert view) */
  const runExperiment = (e: Experiment) => {
    if (busy) return;
    // in the demo, only the recording's own experiment can play; the rest go live
    if (demo && e.prompt !== demoPrompt()) {
      openGoLive();
      return;
    }
    resetRunView();
    setExp(e);
    setPrompt(e.prompt);
    if (demo) {
      playDemo();
      markLaunch();
      goPhase(1);
      return;
    }
    generate(e.prompt, { ...params, ...e.params })
      .then(() => refresh())
      .catch(() => {});
    markLaunch();
    goPhase(1);
  };

  const railTo = (n: number) => {
    if (hasRun || busy) goPhase(n);
  };

  // the box reflects the resident run (design-13): prefill once when loading
  // over an existing run, never clobbering typed or link-restored text
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !trace) return;
    // demo boot: the recording holds its tokens back, so prefill its prompt —
    // one click on begin then plays it
    if (!trace.tokens.length) {
      const dp = trace.demo ? demoPrompt() : null;
      if (dp) {
        prefilled.current = true;
        setPrompt((p) => p || dp);
      }
      return;
    }
    prefilled.current = true;
    setPrompt((p) => {
      if (p) return p;
      const rp = residentPrompt(trace);
      return rp && !rp.startsWith("<|im_start|>") ? rp : p;
    });
  }, [trace]);

  // ---- flow deep links (design-10): restore the linked moment, keep the URL current ----
  const pendingLink = useRef(FLOW_LINK);
  /** trace.seq when the restore re-run was fired; null = not fired */
  const linkFiredAt = useRef<number | null>(null);
  useEffect(() => {
    const link = pendingLink.current;
    if (!link || !trace || trace.busy) return;
    const apply = () => {
      pendingLink.current = null;
      const last = trace.tokens.length - 1;
      if (link.cur !== undefined && link.cur < last) setInspect(Math.max(1, link.cur));
      if (link.step !== undefined) setPhase(Math.max(0, Math.min(6, link.step)));
      if (link.d && Object.values(DIVES).flat().some((dd) => dd.id === link.d)) setDrawer(link.d);
    };
    // the resident run already is this link (a reload, or our re-run settling)
    if (matchesResident(link, trace)) {
      apply();
      return;
    }
    if (linkFiredAt.current !== null) {
      // our re-run settled on something else (engine truth wins): show it as-is
      if (trace.seq !== linkFiredAt.current && trace.tokens.length > trace.n_prompt) apply();
      return;
    }
    if (trace.demo) {
      // the recording can't rebuild arbitrary prompts; drop the restore honestly
      pendingLink.current = null;
      return;
    }
    linkFiredAt.current = trace.seq ?? 0;
    generate(link.p, {
      ...DEFAULT_PARAMS,
      n: link.n,
      temp: link.temp,
      top_k: link.top_k,
      top_p: link.top_p,
      seed: link.seed,
    }).catch(() => {
      pendingLink.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace]);

  // keep the hash mirroring the current moment (replace, never push); silent
  // while a restore is pending so we don't clobber the incoming link
  useEffect(() => {
    if (pendingLink.current || !trace || trace.busy) return;
    const l = currentLink(trace, {
      cur,
      c: null,
      walk: null,
      layer: -1,
      flow: { step: phase, d: drawer },
    });
    if (!l && !window.location.hash) return;
    const timer = window.setTimeout(() => {
      history.replaceState(
        null,
        "",
        l ? "#" + encodeLink(l) : window.location.pathname + window.location.search,
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [trace, cur, phase, drawer]);

  // copy a link to this exact moment, built from live state so it is never stale
  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    if (!trace) return;
    const l = currentLink(trace, {
      cur,
      c: null,
      walk: null,
      layer: -1,
      flow: { step: phase, d: drawer },
    });
    if (!l) return;
    const url =
      window.location.origin + window.location.pathname + window.location.search + "#" + encodeLink(l);
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  // the same context shape the expert stack builds (App.tsx) — the re-homed
  // module keeps its props and engine calls untouched
  const flowCtx: ExplainCtx | null =
    trace && hasRun && prodStep
      ? {
          trace,
          cur,
          prod,
          step: prodStep,
          sel: trace.steps[cur]?.sel,
          params,
          layer: Math.floor(trace.layers / 2),
        }
      : null;

  /** the drawer dock (design-18): handles on the frame's bottom edge, one
   *  per docked drawer. Stays live while a drawer is open — the active
   *  handle closes it, another handle switches in place (the single-drawer
   *  rule as visible mechanics). "the two worlds" needs a resident fork. */
  const divesFor = (p: number) =>
    hasRun ? (DIVES[p] ?? []).filter((d) => d.id !== "worlds" || !!trace?.fork) : [];
  const dives = phase >= 1 && phase <= 5 ? divesFor(phase) : [];

  /** a fresh drawer open starts at the first knob, the current token, and the
   *  default layer */
  const freshOpen = () => {
    setKnob("temperature");
    setPickTok(null);
    setFfnLayer(-1);
  };

  const nav = flowPath({
    phase,
    drawer,
    hasRun,
    busy,
    dives,
    divesFor,
    goPhase,
    setPhase,
    setDrawer,
    onFreshOpen: freshOpen,
  });
  const advanceRef = useRef(nav.advance);
  advanceRef.current = nav.advance;
  const retreatRef = useRef(nav.retreat);
  retreatRef.current = nav.retreat;

  const dock = dives.length > 0 && (
    // chrome, but it enters last on step entry (storyboard §3); key={phase}
    // replays the entrance each step, then it stays put.
    <div className="fl-dock fl-enter" style={dockDelay} key={phase}>
      <span className="fl-dock-label">go deeper</span>
      {dives.map((d) => (
        <button
          key={d.id}
          className={"fl-handle" + (drawer === d.id ? " on" : "")}
          title={d.label}
          onClick={() => {
            if (drawer === d.id) {
              setDrawer(null); // the active handle closes its drawer
              return;
            }
            freshOpen();
            setDrawer(d.id);
          }}
        >
          {d.tab}
          {drawer === d.id && " ×"}
        </button>
      ))}
    </div>
  );

  if (!trace)
    return (
      <div className="flow-wrap">
        <div className="label">connecting to suiron…</div>
      </div>
    );

  const openDive = drawer
    ? Object.values(DIVES)
        .flat()
        .find((d) => d.id === drawer)
    : undefined;

  return (
    <div className={"flow-wrap" + (drawer ? " wide" : "")}>
      <div className="flow">
        <div className="fl-brackets" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="fl-head">
          <div className="fl-head-top">
            <div className="fl-brand">
              suiron
              {hasRun && (
                <button className="fl-share" onClick={copyLink} title="copy a link to this exact moment">
                  {copied ? "copied ✓" : "share"}
                </button>
              )}
            </div>
            <div className="fl-rail" role="tablist" aria-label="steps">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={"fl-dot" + (phase >= n ? " on" : "") + (phase === n ? " cur" : "")}
                  aria-label={`step ${n} · ${STEPS[n]}`}
                  title={`step ${n} · ${STEPS[n]}`}
                  aria-current={phase === n}
                  onClick={() => railTo(n)}
                >
                  {phase === n && nav.subCount > 1 && (
                    <span className="fl-dot-fill" style={{ width: `${nav.subFrac * 100}%` }} />
                  )}
                </button>
              ))}
            </div>
          </div>
          {hasRun && phase >= 2 && phase <= 4 && (
            <MachineMap
              trace={trace}
              n={cur}
              at={phase === 2 ? "look" : phase === 3 ? "rounds" : "guess"}
              intro={phase === 2}
            />
          )}
        </div>

        <div className="fl-stagewrap">
        <div className="fl-stage" key={phase} inert={drawer !== null}>
          {phase >= 1 && phase <= 4 && trace && hasRun && cur !== frontier && (
            <div className="fl-inspect-bar">
              under the microscope: <b>{esc(trace.tokens[cur]?.t ?? "")}</b> · position {cur}
              <button onClick={() => setInspect(null)}>⨯ back to the newest</button>
            </div>
          )}
          <StepStage
            trace={trace}
            phase={phase}
            cur={cur}
            prod={prod}
            frontier={frontier}
            busy={busy}
            launching={launching}
            hasRun={hasRun}
            demo={demo}
            prodStep={prodStep}
            exp={exp}
            prompt={prompt}
            setPrompt={setPrompt}
            begin={begin}
            runAgain={runAgain}
            runExperiment={runExperiment}
            setPhase={setPhase}
            setInspect={setInspect}
            climbTop={climbTop}
            lockLayer={lockLayer}
            onClimbGuess={(t, l) => {
              setClimbTop(t);
              setLockLayer(l);
            }}
          />
        </div>

        {drawer && openDive && (
          <Drawer label={openDive.label} onClose={() => setDrawer(null)}>
            <DrawerBody
              drawer={drawer}
              trace={trace}
              flowCtx={flowCtx}
              cur={cur}
              frontier={frontier}
              busy={busy}
              demo={demo}
              knob={knob}
              setKnob={setKnob}
              pickTok={pickTok}
              setPickTok={setPickTok}
              ffnLayer={ffnLayer}
              setFfnLayer={setFfnLayer}
              openGoLive={openGoLive}
              onFork={(id) => {
                fork(cur, id, params)
                  .then(() => refresh())
                  .catch(() => {});
                resetRunView(); // the fork makes a new frontier — walk it
                markLaunch();
                setDrawer(null);
                setPhase(5); // the changed sentence is the payoff
              }}
            />
          </Drawer>
        )}
        </div>

        {dock}

        <div className="fl-foot">
          <button
            className="fl-nav"
            style={{ visibility: phase > 0 ? "visible" : "hidden" }}
            onClick={nav.retreat}
          >
            back
          </button>
          <span className="fl-meta">
            {busy ? (
              <>
                <span className="fl-live-dot" /> running
              </>
            ) : phase === 6 ? (
              STEPS[6]
            ) : phase > 0 ? (
              `${phase} / 5 · ${STEPS[phase]}${openDive ? " · " + openDive.tab : ""}`
            ) : (
              "one prediction, five steps"
            )}
          </span>
          <button
            className="fl-nav primary"
            style={{ visibility: nav.canContinue ? "visible" : "hidden" }}
            onClick={nav.advance}
          >
            continue {nav.continueArrow}
          </button>
        </div>
      </div>

      <div className="fl-alt">
        <a href="?view=expert">expert view — the whole lab on one page</a>
      </div>
    </div>
  );
}
