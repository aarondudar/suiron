import { useEffect, useRef, useState, type CSSProperties } from "react";
import { demoPrompt, fork, generate, getTrace, playDemo, step as stepMore } from "../api";
import { DEFAULT_PARAMS, esc, litToken, shadowTrace } from "../lib";
import { currentLink, decodeLink, encodeLink, matchesResident, residentPrompt } from "../link";
import { AttentionInteractive } from "./AttentionInteractive";
import { Drawer } from "./Drawer";
import { EmbeddingRow } from "./EmbeddingRow";
import { Epilogue } from "./Epilogue";
import { ExplainerProvider, HotVarScope } from "./Explainer";
import { GeometryCard } from "./Geometry";
import { KvCacheDemo } from "./KvCacheDemo";
import type { ExplainCtx } from "./Explanations";
import { AttnSpace } from "./AttnSpace";
import { DrawField } from "./DrawField";
import { HeadField } from "./HeadField";
import { LensClimb } from "./LensClimb";
import { LensSpace } from "./LensSpace";
import { LoopChain } from "./LoopChain";
import { pickAnchor } from "./TokenSpace";
import { RmsNormDemo } from "./RmsNormDemo";
import { RopeDemo } from "./RopeDemo";
import { TemperatureDemo } from "./TemperatureDemo";
import { TokenizeDemo } from "./TokenizeDemo";
import { TopKDemo } from "./TopKDemo";
import { TopPDemo } from "./TopPDemo";
import { UnderHood } from "./UnderHood";
import { UnembedDemo } from "./UnembedDemo";
import { EXPERIMENTS, type Experiment } from "../experiments";
import type { Trace } from "../types";

/* The guided flow — the app's spine (docs/design.md). Five steps walk one real
   prediction in the causal order it happens: tokens → looks back → sharpens →
   draws one → loops. One idea per screen; every deep-dive opens as a single
   drawer over the current step and closes back to it. Everything here reads
   LIVE from the resident trace via the same machinery the expert stack uses —
   the prototype (docs/prototype/core-loop.html) is the shape and pacing to
   match, never a data source. */

/** step vocabulary from docs/design.md — fix it there first (6 = the finale) */
const STEPS = ["begin", "tokens", "looks back", "sharpens", "draws one", "loops", "the end"] as const;

/** a flow deep link parsed once at load (design-10); the restore effect below
 *  rebuilds the run and reassembles the moment */
const FLOW_LINK = (() => {
  const l = decodeLink(window.location.hash);
  return l?.view === "flow" ? l : null;
})();

/** The finale hosts the unchanged Epilogue, whose <Explain> anchors need an
 *  Explainer context. The flow has no concept cards, so they quietly no-op. */
const NOOP_EXPLAINER = {
  active: null,
  walk: null,
  open: () => {},
  close: () => {},
  setProgramFocus: () => {},
};

/** the sampling drawer shows one knob at a time — the flow's own law applied
 *  inside the drawer (three stacked demos would bury the idea) */
const KNOBS = ["temperature", "top-k", "top-p"] as const;
type Knob = (typeof KNOBS)[number];

/* the entrance order (docs/storyboard.md §3): staged delays on each tier via the
   --fl-d custom property, consumed by .fl-enter. H → beat → hero → C → A → dock.
   Under reduced motion the CSS drops the animation, so these are inert. */
const enterDelay = (s: string): CSSProperties => ({ ["--fl-d" as string]: s }) as CSSProperties;
const hDelay = enterDelay("0s");
const heroDelay = enterDelay("0.3s");
const cDelay = enterDelay("0.6s");
const aDelay = enterDelay("0.8s");
const dockDelay = enterDelay("1s");

/** The flow's own trace poll — the same rhythm as the expert stack's
 *  (App.tsx), scoped here so the expert view stays untouched. Also reacts to
 *  busy flips so the running state is never stale. */
function useTrace(): Trace | null {
  const [trace, setTrace] = useState<Trace | null>(null);
  useEffect(() => {
    let timer: number;
    let dead = false;
    let lastSeq = -2;
    let lastBusy = false;
    const tick = async () => {
      try {
        const t = await getTrace();
        if (dead) return;
        if (t.seq !== lastSeq || !!t.busy !== lastBusy) {
          lastSeq = t.seq ?? -1;
          lastBusy = !!t.busy;
          setTrace(t);
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
  return trace;
}

const VOCAB = 151_936;
/** The machine map, demoted to chrome (docs/storyboard.md + copy addendum):
 *  the smallest strip, steps 2–4 only, script-owned string, one marker moving
 *  looks back (2) → the ×N rounds (3) → a guess (4). The word "rounds" relabels
 *  to "layers" at step 3, the moment the aside introduces the term (the map
 *  learns the word with the reader). "vectors" and "scores" never appear.
 *  On step 2 it enters once with a left-to-right draw (`intro`). */
type MapAt = "look" | "rounds" | "guess";
function MachineMap({ trace, n, at, intro }: { trace: Trace; n: number; at: MapAt; intro?: boolean }) {
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
function Sentence({
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

/** the dive points: which drawers dock to which step (docs/design.md's map).
 *  A step may dock several; the single-drawer rule still holds — opening one
 *  closes any other. `tab` is the dock handle; `label` stays the tooltip and
 *  the open drawer's title. */
/* `tab` is the dock handle on the spine — the copy-script ADDENDUM owns these
   verbatim. `label` is the drawer's title once open: the script's long
   "drawer button" phrase for the nine scripted drawers, and the handle itself
   for the four adopted drawers (which have no long phrase). Dock order follows
   the addendum's handle order per step. */
const DIVES: Record<number, { id: string; tab: string; label: string }[]> = {
  1: [
    { id: "merges", tab: "how pieces form", label: "watch the text become tokens" },
    { id: "meaning", tab: "the map of meaning", label: "the map of meaning" },
  ],
  2: [
    { id: "dot", tab: "score one look", label: "watch one look get scored" },
    { id: "heads", tab: "16 readers", label: "see all 16 ways it looks" },
    { id: "rope", tab: "word order", label: "how it knows word order" },
  ],
  3: [
    { id: "rmsnorm", tab: "kept steady", label: "how a layer keeps the numbers sane" },
    { id: "ffn", tab: "reworked", label: "reworked" },
    { id: "residual", tab: "guess by depth", label: "why early guesses exist at all" },
  ],
  4: [
    { id: "sampling", tab: "bend the odds", label: "bend the odds" },
    { id: "fork", tab: "fork it", label: "take the road not taken" },
    { id: "unembed", tab: "the readout", label: "the readout" },
  ],
  5: [
    { id: "cache", tab: "why it's fast", label: "why the loop is fast" },
    { id: "worlds", tab: "two worlds", label: "two worlds" },
  ],
};

export function Flow() {
  const trace = useTrace();
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
        goPhase(1);
      } else {
        openGoLive();
      }
      return;
    }
    resetRunView(); // a new run walks its own frontier
    setExp(null); // a run of your own retires the experiment framing
    void generate(text, { ...params, n: 1 });
    goPhase(1);
  };
  const runAgain = () => {
    if (!trace || busy) return;
    if (demo) {
      openGoLive();
      return;
    }
    resetRunView();
    void stepMore(1, params);
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
      goPhase(1);
      return;
    }
    void generate(e.prompt, { ...params, ...e.params });
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

  // the spine's full path (design-21): each step, then its drawers as
  // SUB-STEPS. continue/back/arrows walk this list end to end, so the depth
  // is the default path; the dock and the rail remain random access.
  const path: { phase: number; d: string | null }[] = [];
  for (let p = 1; p <= 5; p++) {
    path.push({ phase: p, d: null });
    for (const dv of divesFor(p)) path.push({ phase: p, d: dv.id });
  }
  const pathIdx = path.findIndex((s) => s.phase === phase && s.d === drawer);
  const applyStop = (s: { phase: number; d: string | null }) => {
    if (s.d && s.d !== drawer) {
      setKnob("temperature"); // a fresh open starts at the first knob
      setPickTok(null); // …and at the current token
      setFfnLayer(-1); // …and at the default layer
    }
    setPhase(s.phase);
    setDrawer(s.d);
  };
  const advance = () => {
    if (phase === 0) {
      if (hasRun || busy) goPhase(1);
      return;
    }
    if (pathIdx >= 0 && pathIdx + 1 < path.length) applyStop(path[pathIdx + 1]);
  };
  const retreat = () => {
    if (phase === 0) return;
    if (phase === 6) {
      goPhase(5);
      return;
    }
    if (pathIdx > 0) applyStop(path[pathIdx - 1]);
    else goPhase(0);
  };
  const canContinue =
    phase === 0 ? hasRun || busy : phase <= 5 && pathIdx >= 0 && pathIdx + 1 < path.length;
  // rail sub-progress (design-25): the current step's dot fills as continue
  // walks its drawers, so the primary progress cue moves even mid-step
  const subCount = 1 + dives.length;
  const subPos = drawer ? dives.findIndex((d) => d.id === drawer) + 1 : 0;
  const subFrac = subCount > 0 ? (subPos + 1) / subCount : 1;
  // signpost where continue goes: ↓ deeper into a drawer, → on to the next step
  const nextStop = pathIdx >= 0 ? path[pathIdx + 1] : undefined;
  const continueArrow = phase === 0 ? "→" : nextStop ? (nextStop.d ? "↓" : "→") : "";
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const retreatRef = useRef(retreat);
  retreatRef.current = retreat;
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
            setKnob("temperature"); // a fresh open starts at the first knob
            setPickTok(null); // …and at the current token
            setFfnLayer(-1); // …and at the default layer
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

  const waiting = (
    <div className="fl-status" role="status">
      {busy ? "the model is running…" : "no run yet — go back and begin."}
    </div>
  );

  const stage = (() => {
    switch (phase) {
      case 0:
        return (
          <>
            <p className="fl-line fl-enter" style={hDelay}>
              A language model does one thing: it guesses the next word. Let's watch one guess
              happen, from the inside, one step at a time.
            </p>
            <div className="fl-prompt-row fl-enter" style={heroDelay}>
              <input
                type="text"
                className="fl-blank"
                value={prompt}
                placeholder="The capital of France is"
                spellCheck={false}
                aria-label="prompt"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && begin()}
              />
              <button className="fl-begin" onClick={begin} disabled={busy || !prompt.trim()}>
                begin
              </button>
            </div>
            <div className="fl-cap fl-enter" style={cDelay}>type a few words, or use this one</div>
            <div className="fl-ex">
              <span className="fl-ex-label">or try:</span>
              {EXPERIMENTS.map((e) => (
                <button key={e.id} title={e.hook} disabled={busy} onClick={() => runExperiment(e)}>
                  {e.title}
                </button>
              ))}
            </div>
            {demo && (
              <div className="fl-note">
                recorded demo · this prompt plays instantly · anything else goes live (one 640 MB
                download, cached)
              </div>
            )}
          </>
        );
      case 1: {
        const n = hasRun ? cur : trace.tokens.length;
        if (!n) return waiting;
        return (
          <>
            <p className="fl-line fl-enter" style={hDelay}>
              First, your words are broken into the pieces the model actually reads.
            </p>
            <div className="fl-enter" style={heroDelay}>
              <Sentence trace={trace} n={n} showIds stagger />
            </div>
            <div className="fl-cap fl-enter" style={cDelay}>
              {n} tokens · this is exactly what the model sees
            </div>
            <div className="fl-note fl-enter" style={aDelay}>
              Each piece is called a token. The model knows a fixed list of{" "}
              {VOCAB.toLocaleString()} of them, its vocabulary, and every token has a number in that
              list.
            </div>
            {exp && (
              <div className="fl-mark">
                experiment · {exp.title} — {exp.hook}
              </div>
            )}
          </>
        );
      }
      case 2:
        if (!hasRun) return waiting;
        return (
          <>
            <p className="fl-line fl-enter" style={hDelay}>
              To guess what comes next, the model looks back over everything written so far, and it
              does not look at every word equally.
            </p>
            <div className="fl-enter" style={heroDelay}>
              <AttnSpace trace={trace} prod={prod} />
            </div>
            <div className="fl-cap fl-enter" style={cDelay}>
              reading from “{esc(trace.tokens[prod]?.t ?? "")}” · the stronger the pull, the harder
              it looks
            </div>
            <div className="fl-note fl-enter" style={aDelay}>
              This looking back is called attention. It is the only part of the whole process where
              words exchange information.
            </div>
          </>
        );
      case 3:
        if (!hasRun || !prodStep) return waiting;
        return (
          <>
            <p className="fl-line fl-enter" style={hDelay}>
              The model does not decide all at once. Its guess sharpens across {trace.layers} rounds
              of the same arithmetic, and you can watch it happen.
            </p>
            <div className="fl-enter" style={heroDelay}>
              <LensSpace
                trace={trace}
                prod={prod}
                onGuess={(t, l) => {
                  setClimbTop(t);
                  setLockLayer(l);
                }}
              />
            </div>
            {climbTop && (
              <div className="fl-cap fl-enter" style={cDelay}>
                its guess so far: “{climbTop}”
                {lockLayer !== null && <> · it locks on at layer {lockLayer}</>}
              </div>
            )}
            <div className="fl-note fl-enter" style={aDelay}>
              Each round is called a layer. Every layer runs the same two moves you have seen, look
              back, then rework, and hands its result to the next.
            </div>
          </>
        );
      case 4: {
        if (!hasRun || !prodStep) return waiting;
        const chosenId = trace.tokens[cur].id;
        const sel = trace.steps[cur]?.sel;
        const top0 = prodStep.top?.[0];
        const topTok = top0 ? esc(top0[1]) : "";
        const pTop = top0 ? `${(top0[2] * 100).toFixed(0)}%` : "";
        const chosen = esc(trace.tokens[cur]?.t ?? "");
        return (
          <>
            <p className="fl-line fl-enter" style={hDelay}>
              The model does not pick a word. It gives every token a probability, and then it
              draws, like pulling a ticket from a weighted hat.
            </p>
            {sel ? (
              <>
                <div className="fl-enter" style={heroDelay}>
                  <DrawField sel={sel} chosenId={chosenId} />
                </div>
                <div className="fl-cap fl-enter" style={cDelay}>
                  “{topTok}” holds {pTop} of the tickets · the draw landed on “{chosen}”
                </div>
              </>
            ) : (
              <div className="fl-status" role="status">
                prompt token — you supplied it, the model did not draw it
              </div>
            )}
            <div className="fl-note fl-enter" style={aDelay}>
              A probability is just the share of tickets. A setting called temperature reshapes the
              shares: low and the favourite almost always wins, high and the long shots get a real
              chance.
            </div>
          </>
        );
      }
      case 5:
        if (!hasRun) return waiting;
        // the loop step always shows the WHOLE run (the frontier sentence);
        // clicking a word opens its story back on "looks back"
        return (
          <>
            <p className="fl-line fl-enter" style={hDelay}>
              The drawn token joins the sentence, and the whole thing runs again. That is all a
              language model does, one token at a time, for every word it has ever written.
            </p>
            <div className="fl-enter" style={heroDelay}>
              <LoopChain
                trace={trace}
                frontier={frontier}
                onPick={(i) => {
                  setInspect(i);
                  setPhase(2);
                }}
              />
            </div>
            <div className="fl-cap fl-enter" style={cDelay}>
              “{esc(trace.tokens[frontier]?.t ?? "")}” appended · {trace.tokens.length} tokens now in
              play
            </div>
            <div className="fl-center fl-enter" style={aDelay}>
              <button className="fl-again" onClick={runAgain} disabled={busy}>
                {busy ? "running…" : "run it again"}
              </button>
            </div>
            <div className="fl-center">
              <button className="fl-end-link" onClick={() => setPhase(6)}>
                how this scales up
              </button>
            </div>
          </>
        );
      case 6:
        // the finale: the unchanged epilogue, opt-in after the loop closes.
        // chat lives in the expert view; experiments run right here.
        return (
          <ExplainerProvider value={NOOP_EXPLAINER}>
            <div className="fl-finale">
              {/* the epilogue's copy was written beside the full instrument;
                  keep its "above" references honest from here (design-13) */}
              <div className="fl-note">
                written beside the full instrument — where it says “above”, it means the{" "}
                <a href="?view=expert">expert view</a>.
              </div>
              <Epilogue
                onTryChat={() => {
                  window.location.href = "?view=expert";
                }}
                onRun={runExperiment}
              />
            </div>
          </ExplainerProvider>
        );
      default:
        return null;
    }
  })();

  // the open drawer's content: the ONE live proof (the worked dot product on
  // "looks back") plus stubs awaiting their re-homing passes
  const openDive = drawer
    ? Object.values(DIVES)
        .flat()
        .find((d) => d.id === drawer)
    : undefined;
  const drawerBody = (() => {
    if (drawer === "dot" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              How hard to look is a single number, and here is the arithmetic that makes it. Each
              token carries a list of numbers called a vector. The current token asks with one
              vector, the query; each earlier token answers with another, the key. Multiply them
              piece by piece, add it up, and that is the score.
            </p>
            <p className="fl-d-do">Step the multiply-and-add to the end.</p>
          </div>
          <AttentionInteractive ctx={flowCtx} />
        </>
      );
    if (drawer === "merges" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              The tokenizer builds tokens by merging, over and over, the pair of neighbouring
              pieces it has seen together most often. These are the real merges for your text, in
              the real order.
            </p>
            <p className="fl-d-do">Step through the merges.</p>
            <p className="fl-d-proof">
              The pieces you end on are exactly the tokens the model reads. Same ids, same order,
              checked against the engine.
            </p>
          </div>
          <TokenizeDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "meaning" && flowCtx) {
      // default = the same anchor as the step's meaning space (the produced
      // answer), so the step and its drawer tell one story; the chip row is
      // the visible, deliberate override
      const mPos = Math.max(0, Math.min(pickTok ?? pickAnchor(flowCtx.trace), frontier));
      const mCtx = { ...flowCtx, cur: mPos };
      return (
        <ExplainerProvider value={NOOP_EXPLAINER}>
          <div className="fl-drawer-note fl-d">
            <p>
              Each token is looked up as a vector, a long list of numbers that places it on the
              model's map of meaning. Nearby points mean similar things.
            </p>
            <p className="fl-d-do">Pick a token and see its closest neighbours on that map.</p>
            <p className="fl-d-proof">
              These neighbours are computed from the model's own numbers, not a thesaurus.
            </p>
          </div>
          <div className="fl-pick-row">
            {flowCtx.trace.tokens.map((tok, i) => (
              <button
                key={i}
                className={"fl-chip pickable" + (i === mPos ? " on" : "")}
                title={`id ${tok.id} · pos ${i}`}
                onClick={() => setPickTok(i)}
              >
                {esc(tok.t)}
              </button>
            ))}
          </div>
          <EmbeddingRow ctx={mCtx} />
          <GeometryCard ctx={mCtx} read="meaning" />
        </ExplainerProvider>
      );
    }
    if (drawer === "sampling" && flowCtx?.sel) {
      const sel = flowCtx.sel;
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              Three dials shape the draw. Temperature sharpens or flattens the shares. Top-k throws
              away all but the k likeliest tickets. Top-p keeps just enough tickets to cover a share
              p.
            </p>
            <p className="fl-d-do">Drag each dial and watch the odds redraw, live.</p>
            <p className="fl-d-proof">
              These are the engine's probabilities recomputed at each setting, not an illustration.
            </p>
          </div>
          <div className="seg fl-knob-seg">
            {KNOBS.map((k) => (
              <button
                key={k}
                className={"seg-opt" + (knob === k ? " on" : "")}
                onClick={() => setKnob(k)}
              >
                {k}
              </button>
            ))}
          </div>
          {knob === "temperature" && (
            <TemperatureDemo cand={sel.cand} temp={sel.temp} chosen={sel.chosen} />
          )}
          {knob === "top-k" && (
            <TopKDemo cand={sel.cand} k={sel.top_k} temp={sel.temp} chosen={sel.chosen} />
          )}
          {knob === "top-p" && (
            <TopPDemo cand={sel.cand} p={sel.top_p} temp={sel.temp} chosen={sel.chosen} />
          )}
        </>
      );
    }
    if (drawer === "sampling")
      return <div className="fl-stub">no recorded draw at this position. run a step first.</div>;
    if (drawer === "fork" && flowCtx) {
      const top = (flowCtx.step.top ?? []).slice(0, 6);
      const chosenId = flowCtx.trace.tokens[cur]?.id;
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              The draw could have landed elsewhere. Pick any candidate the model did not choose and
              make history go that way instead; the model continues for real from there.
            </p>
            <p className="fl-d-do">Click a grey candidate.</p>
            <p className="fl-d-proof">
              Both futures ran through the same engine. At the fork the odds were identical; only
              the draw differed.
            </p>
          </div>
          <div className="fl-fork-opts">
            {top.map(([id, t, p]) => (
              <button
                key={id}
                className={"fl-fork-opt" + (id === chosenId ? " picked" : "")}
                disabled={id === chosenId || busy}
                onClick={() => {
                  if (demo) {
                    // the recording can't rewrite history — that needs the engine
                    openGoLive();
                    return;
                  }
                  void fork(cur, id, params);
                  resetRunView(); // the fork makes a new frontier — walk it
                  setDrawer(null);
                  setPhase(5); // the changed sentence is the payoff
                }}
              >
                <span className="fl-fork-tok">{esc(t)}</span>
                <span className="fl-fork-p">{(p * 100).toFixed(1)}%</span>
                {id === chosenId && <span className="fl-fork-tag">picked</span>}
              </button>
            ))}
          </div>
        </>
      );
    }
    if (drawer === "worlds" && trace?.fork) {
      const shadow = shadowTrace(trace);
      const at = trace.fork.pos;
      if (!shadow)
        return (
          <div className="fl-stub">
            this run's replaced tail wasn't recorded, so the other world can't be shown. fork
            again to compare.
          </div>
        );
      const world = (tr: Trace, label: string, tag: string, model: boolean) => (
        <div className="fl-world">
          <div className="fl-world-label">{label}</div>
          <div className="fl-world-chips">
            {tr.tokens.map((tok, i) => (
              <span
                key={i}
                className={
                  "fl-chip" +
                  (i < at ? " dim" : "") +
                  (i === at ? (model ? " new" : " forced") : "")
                }
                title={`id ${tok.id} · pos ${i}`}
              >
                {i === at && <i className="fl-readhead">{tag}</i>}
                {/* the divergence token must be legible even when it is pure
                    whitespace — show it the way the geometry labels do */}
                {i === at ? litToken(tok.t).text : esc(tok.t)}
              </span>
            ))}
          </div>
        </div>
      );
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              You forked history earlier, or can now. Here both futures sit side by side: same
              model, same odds at the fork, different draw.
            </p>
            <p className="fl-d-do">Compare the two sentences token by token.</p>
            <p className="fl-d-proof">
              Both ran through the same engine; the divergence is only the draw.
            </p>
          </div>
          {world(trace, "this world", "you forced", false)}
          {world(shadow, "the other world", "the model chose", true)}
        </>
      );
    }
    if (drawer === "ffn" && flowCtx) {
      const nL = flowCtx.trace.layers;
      const at = ffnLayer >= 0 ? Math.min(ffnLayer, nL - 1) : flowCtx.layer;
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              After looking back, each token is reworked on its own: its vector is expanded,
              filtered, and compressed back. Unlike looking back, this step moves nothing between
              words.
            </p>
            <p className="fl-d-do">Watch which of the 3,072 filters fire for this token.</p>
            <p className="fl-d-proof">The activations shown are read from the run.</p>
          </div>
          <div className="attn-controls">
            <label className="uh-sel">
              layer{" "}
              <input
                type="number"
                min={0}
                max={nL - 1}
                value={at}
                onChange={(e) => setFfnLayer(Math.min(nL - 1, Math.max(0, +e.target.value)))}
              />
            </label>
          </div>
          <HotVarScope>
            <UnderHood ctx={flowCtx} stage="feedforward" layer={at} head={0} />
          </HotVarScope>
        </>
      );
    }
    if (drawer === "unembed" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              The final vector is compared against every token the model knows. Each comparison is
              one number, a logit; softmax turns the whole list into probabilities.
            </p>
            <p className="fl-d-do">Scrub the list and watch scores become shares.</p>
            <p className="fl-d-proof">The shares equal the engine's, and they sum to 1.</p>
          </div>
          <UnembedDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "rmsnorm" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              Twenty-eight rounds of arithmetic would blow the numbers up or shrink them to
              nothing. Before each move, the layer rescales the token's vector to a steady size.
              That rescaling is called RMSNorm.
            </p>
            <p className="fl-d-do">Watch one real vector get rescaled.</p>
            <p className="fl-d-proof">
              The rescaled values equal the engine's, and the size after is the same at every layer.
            </p>
          </div>
          <RmsNormDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "residual" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              Each layer does not replace the token's vector, it adds to it. The running total is
              called the residual, and because it exists, you can stop at any layer and read out
              what the model would guess so far. That readout is the climb you just watched; its
              formal name is the logit lens.
            </p>
            <p className="fl-d-do">Drag the layer slider and read the guess at each depth.</p>
            <p className="fl-d-proof">
              At the last layer the readout equals the model's real answer exactly. That is the test
              that keeps this honest.
            </p>
          </div>
          {/* storyboard RULING: "guess by depth" docks the lens-depth reader
              (the layer slider reading the guess at each depth); SignalField
              retired to the expert view, its copy never matched it. */}
          <LensClimb trace={flowCtx.trace} prod={flowCtx.prod} prodStep={flowCtx.step} />
        </>
      );
    if (drawer === "heads" && flowCtx && prodStep)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              The model looks back 16 different ways at once. Each is called a head, and each learns
              its own habit: some watch the previous word, some hunt for repeats, some track
              grammar.
            </p>
            <p className="fl-d-do">Hover a head to see where it looks in your sentence.</p>
            <p className="fl-d-proof">These weights are read from the run, not drawn for effect.</p>
          </div>
          <HeadField trace={flowCtx.trace} step={prodStep} prod={prod} />
        </>
      );
    if (drawer === "rope" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              Word order matters: 'dog bites man' is not 'man bites dog'. Before the scores are
              made, each query and key is rotated by an angle that depends on its position, so the
              same word asks a different question from a different place.
            </p>
            <p className="fl-d-do">Slide the position and watch the rotation.</p>
            <p className="fl-d-proof">
              The rotated values match the engine's, which is how it knows where each word sits.
            </p>
          </div>
          <RopeDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "cache" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note fl-d">
            <p>
              Each pass, only the newest token is new; everything the model worked out about the
              earlier ones is kept in a cache and reused. That is why the loop does not slow down as
              the sentence grows.
            </p>
            <p className="fl-d-do">Step a token and watch one column get added, not recomputed.</p>
            <p className="fl-d-proof">
              The cached values are the ones the engine reads on the next pass.
            </p>
          </div>
          <KvCacheDemo ctx={flowCtx} />
        </>
      );
    return (
      <div className="fl-stub">
        this deep-dive re-homes an existing module here. coming soon, one pass at a time. until
        then it lives in the <a href="?view=expert">expert view</a>.
      </div>
    );
  })();

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
                  {phase === n && subCount > 1 && (
                    <span className="fl-dot-fill" style={{ width: `${subFrac * 100}%` }} />
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
          {stage}
        </div>

        {drawer && openDive && (
          <Drawer label={openDive.label} onClose={() => setDrawer(null)}>
            {drawerBody}
          </Drawer>
        )}
        </div>

        {dock}

        <div className="fl-foot">
          <button
            className="fl-nav"
            style={{ visibility: phase > 0 ? "visible" : "hidden" }}
            onClick={retreat}
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
            style={{ visibility: canContinue ? "visible" : "hidden" }}
            onClick={advance}
          >
            continue {continueArrow}
          </button>
        </div>
      </div>

      <div className="fl-alt">
        <a href="?view=expert">expert view — the whole lab on one page</a>
      </div>
    </div>
  );
}
