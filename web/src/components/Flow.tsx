import { useEffect, useRef, useState } from "react";
import { demoPrompt, fork, generate, getTrace, playDemo, step as stepMore } from "../api";
import { DEFAULT_PARAMS, esc, litToken, moments, shadowTrace } from "../lib";
import { currentLink, decodeLink, encodeLink, matchesResident, residentPrompt } from "../link";
import { AttentionInteractive } from "./AttentionInteractive";
import { Drawer } from "./Drawer";
import { EmbeddingRow } from "./EmbeddingRow";
import { Epilogue } from "./Epilogue";
import { ExplainerProvider } from "./Explainer";
import { GeometryCard } from "./Geometry";
import { KvCacheDemo } from "./KvCacheDemo";
import type { ExplainCtx } from "./Explanations";
import { AttnSpace } from "./AttnSpace";
import { DrawField } from "./DrawField";
import { HeadField } from "./HeadField";
import { LensSpace } from "./LensSpace";
import { LoopChain } from "./LoopChain";
import { TokenSpace } from "./TokenSpace";
import { RmsNormDemo } from "./RmsNormDemo";
import { RopeDemo } from "./RopeDemo";
import { SignalField } from "./SignalField";
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

/** The machine, at a glance (design-20): structure stated at the moment it
 *  becomes necessary. Live figures — the context size and layer count come
 *  from the trace; the vocabulary count is the model's real table height
 *  (the same figure the embedding drawer ships). `at` moves the you-are-here
 *  emphasis as the steps advance: read (looks back) → the ×N climb
 *  (sharpens) → scores (draws one). */
const VOCAB = 151_936;
type MapAt = "vectors" | "read" | "climb" | "scores";
function MachineMap({ trace, n, at }: { trace: Trace; n: number; at: MapAt }) {
  const here = {
    vectors: "the vectors",
    read: "read",
    climb: `all ${trace.layers} layers`,
    scores: "the scores",
  }[at];
  return (
    <div className="fl-map" aria-label={`the machine, at a glance — you are here: ${here}`}>
      <span className="fl-map-box">
        <b className={at === "vectors" ? "on" : undefined}>
          {n} vector{n === 1 ? "" : "s"}
        </b>
      </span>
      <span className="fl-map-arrow">→</span>
      <span className="fl-map-box">
        <b className={at === "read" ? "on" : undefined}>read</b>
        <span className="fl-map-sep"> → </span>think
      </span>
      <span className={"fl-map-x" + (at === "climb" ? " on" : "")}>× {trace.layers} layers</span>
      <span className="fl-map-arrow">→</span>
      <span className="fl-map-box">
        <b className={at === "scores" ? "on" : undefined}>{VOCAB.toLocaleString()} scores</b>
      </span>
    </div>
  );
}

/** one token as a chip; `tone` is presentation only */
function Chip({
  trace,
  pos,
  tone,
  delay,
  onPick,
}: {
  trace: Trace;
  pos: number;
  tone?: "dim" | "read" | "new";
  /** staggered-arrival delay in seconds (tokens step only) */
  delay?: number;
  /** inspect this token (absent = not a pick surface; pos 0 has no producer) */
  onPick?: (pos: number) => void;
}) {
  const tok = trace.tokens[pos];
  if (!tok) return null;
  const pickable = !!onPick && pos > 0;
  return (
    <span
      className={"fl-chip" + (tone ? " " + tone : "") + (pickable ? " pick" : "")}
      style={delay !== undefined ? { animationDelay: `${delay}s` } : undefined}
      data-id={tok.id}
      title={
        `id ${tok.id} · pos ${pos}` +
        (onPick ? (pos === 0 ? " · the seed — nothing produced it" : " · click to inspect") : "")
      }
      role={pickable ? "button" : undefined}
      tabIndex={pickable ? 0 : undefined}
      onClick={pickable ? () => onPick(pos) : undefined}
      onKeyDown={
        pickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(pos);
              }
            }
          : undefined
      }
    >
      {tone === "read" && <i className="fl-readhead">reading from here</i>}
      {esc(tok.t)}
    </span>
  );
}

/** the sentence so far: real resident tokens [0, n). The read head (the last
 *  context position) and the freshly drawn token are the only emphases. */
function Sentence({
  trace,
  n,
  dim,
  readHead,
  lastNew,
  stagger,
  showIds,
  onPick,
}: {
  trace: Trace;
  n: number;
  dim?: boolean;
  readHead?: boolean;
  lastNew?: boolean;
  stagger?: boolean;
  /** surface each chip's token id on hover (the tokens step) */
  showIds?: boolean;
  /** chips become inspect targets (pos 0 excluded) */
  onPick?: (pos: number) => void;
}) {
  return (
    <div className={"fl-sentence" + (stagger ? " stagger" : "") + (showIds ? " fl-ids" : "")}>
      {trace.tokens.slice(0, n).map((_, i) => (
        <Chip
          key={i}
          trace={trace}
          pos={i}
          onPick={onPick}
          delay={stagger ? Math.min(i, 16) * 0.07 : undefined}
          tone={
            lastNew && i === n - 1
              ? "new"
              : readHead && i === n - 1
                ? "read"
                : dim
                  ? "dim"
                  : undefined
          }
        />
      ))}
    </div>
  );
}

/** the dive points: which drawers dock to which step (docs/design.md's map).
 *  A step may dock several; the single-drawer rule still holds — opening one
 *  closes any other. `tab` is the dock handle; `label` stays the tooltip and
 *  the open drawer's title. */
const DIVES: Record<number, { id: string; tab: string; label: string }[]> = {
  1: [
    { id: "merges", tab: "merges", label: "watch the text become tokens" },
    { id: "meaning", tab: "meaning", label: "what a word means to the model" },
  ],
  2: [
    { id: "dot", tab: "one score", label: "watch one score compute" },
    { id: "heads", tab: "16 readers", label: "the sixteen readers" },
    { id: "rope", tab: "word order", label: "how it knows word order" },
  ],
  3: [
    { id: "ffn", tab: "think", label: "read, then think: the other half of a layer" },
    { id: "rmsnorm", tab: "the reset", label: "the reset before every layer" },
    { id: "residual", tab: "the signal", label: "the signal, layer by layer" },
  ],
  4: [
    { id: "unembed", tab: "the scores", label: "how a direction becomes scores" },
    { id: "sampling", tab: "the knobs", label: "bend the odds: temperature, top-k, top-p" },
    { id: "fork", tab: "what if?", label: "what if it had picked differently?" },
  ],
  5: [
    { id: "cache", tab: "the cache", label: "the cache that makes the loop fast" },
    { id: "worlds", tab: "two worlds", label: "the two worlds" },
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

  const begin = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    // demo boot (docs/19): the recording's own prompt plays instantly;
    // anything else needs the real engine, so it opens go-live
    if (demo) {
      if (text === demoPrompt()) {
        setInspect(null);
        setExp(null);
        playDemo();
        goPhase(1);
      } else {
        openGoLive();
      }
      return;
    }
    setInspect(null); // a new run walks its own frontier
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
    setInspect(null);
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
    setInspect(null);
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

  // the token's story: real trace-derived moments (attention lock, induction,
  // runaway/near-tie). A marker no real value supports does not render —
  // moments()'s own contract. The decision marker lives in LensClimb.
  const marks = trace && hasRun && prod >= 0 ? moments(trace, prod) : [];
  const mark = (kinds: string[]) =>
    marks
      .filter((m) => kinds.includes(m.kind))
      .map((m) => (
        <div className="fl-mark" key={m.kind}>
          {m.label}
        </div>
      ));

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
    <div className="fl-dock">
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
            <p className="fl-line">
              we've all used AI. some of us every day. but what <em>is</em> it? not a metaphor,
              not magic: a machine that does exactly one thing. <em>guess the next word from the previous context.</em> over and
              over. type something and watch every step.
            </p>
            <div className="fl-prompt-row">
              <input
                type="text"
                value={prompt}
                placeholder="The capital of France is"
                spellCheck={false}
                aria-label="prompt"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && begin()}
              />
              <button className="fl-begin" onClick={begin} disabled={busy || !prompt.trim()}>
                ▶ begin
              </button>
            </div>
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
            {hasRun && (
              <div className="fl-note">
                press continue to walk the current run; or press begin to start fresh.
              </div>
            )}
            <div className="fl-about">
              a from-scratch inference engine in Rust —{" "}
              {demo
                ? "every number here is from one real run of it; go live and your browser computes them itself."
                : "every number in this walkthrough is computed live by it, nothing is canned."}{" "}
              <a href="?view=expert">more in the expert view</a>
            </div>
          </>
        );
      case 1: {
        const n = hasRun ? cur : trace.tokens.length;
        if (!n) return waiting;
        return (
          <>
            <p className="fl-line">
              AI models don't read the way you do. they break down text into <em>tokens.</em> often common
              groupings of letters or entire words.
            </p>
            <Sentence trace={trace} n={n} showIds />
            <div className="fl-note">
              {n} piece{n === 1 ? "" : "s"} from the engine's tokenizer · each is then looked up as
              a <b>vector</b> — a position in a space of meaning, where words used alike sit close
              together.
            </div>
            <TokenSpace trace={trace} n={n} />
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
            <p className="fl-line">
              a word means different things in different company. so to guess what's next, each
              word <em>looks back</em> and gathers meaning from the words before it. that
              gathering is <b>attention</b>.
            </p>
            <AttnSpace trace={trace} prod={prod} />
            <div className="fl-note">
              a score decides how much each earlier word counts — the dot product two words compute.
              it happens inside every one of the model's {trace.layers} layers. open the worked score
              below to watch one by hand.
            </div>
            {mark(["attention", "induction"])}
          </>
        );
      case 3:
        if (!hasRun || !prodStep) return waiting;
        return (
          <>
            <p className="fl-line">
              one look back isn't enough. the model repeats it — look back, then think — through
              all {trace.layers} layers, and the guess <em>sharpens</em> at each one.
            </p>
            <LensSpace trace={trace} prod={prod} prodStep={prodStep} />
            <div className="fl-note">
              why it sharpens toward this answer and not another was set earlier, in training — the
              numbers were tuned on enormous amounts of text until predictions like this came out
              right. you can watch the mechanism here; you can't read the reason off the numbers.
            </div>
          </>
        );
      case 4: {
        if (!hasRun || !prodStep) return waiting;
        const chosenId = trace.tokens[cur].id;
        const sel = trace.steps[cur]?.sel;
        return (
          <>
            <p className="fl-line">
              now it has a ranked list of guesses, and it <em>draws one</em>. temperature is the
              dial{sel ? ` — ${sel.temp} on this run` : ""}: at 0 it takes the top by rule; turn it
              up and the lower guesses get a real chance.
            </p>
            {sel ? (
              <DrawField sel={sel} chosenId={chosenId} />
            ) : (
              <div className="fl-status" role="status">
                prompt token — you supplied it, the model did not draw it
              </div>
            )}
            {mark(["output"])}
          </>
        );
      }
      case 5:
        if (!hasRun) return waiting;
        // the loop step always shows the WHOLE run (the frontier sentence);
        // clicking a word opens its story back on "looks back"
        return (
          <>
            <LoopChain
              trace={trace}
              frontier={frontier}
              onPick={(i) => {
                setInspect(i);
                setPhase(2);
              }}
            />
            <p className="fl-line">
              the drawn word joins the sentence. then, the whole machine runs <em>again</em>. that's
              all of it. every AI you've used is this loop: guess the next word, add it, repeat.
            </p>
            <div className="fl-center">
              <button className="fl-again" onClick={runAgain} disabled={busy}>
                {busy ? "↻ running…" : "↻ run it again"}
              </button>
            </div>
            <div className="fl-note">
              the loop so far: {trace.n_prompt} of your tokens +{" "}
              {trace.tokens.length - trace.n_prompt} drawn
            </div>
            {trace.fork && (
              <div className="fl-note">
                the road not taken: “
                {trace.fork.prev.length > 60
                  ? trace.fork.prev.slice(0, 60) + "…"
                  : trace.fork.prev}
                ”
              </div>
            )}
            <div className="fl-center">
              <button className="fl-end-link" onClick={() => setPhase(6)}>
                → the end: what you just watched
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
    if (drawer === "dot" && flowCtx) return <AttentionInteractive ctx={flowCtx} />;
    if (drawer === "merges" && flowCtx)
      return (
        <>
          {/* /api/v1/merges walks the PROMPT: generated tokens were drawn whole
              and never went through the byte-pair walk — say so up front */}
          <div className="fl-drawer-note">
            your prompt, piece by piece. tokens the model generated were drawn whole — they never
            merged.
          </div>
          <TokenizeDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "meaning" && flowCtx) {
      const mPos = Math.max(0, Math.min(pickTok ?? cur, frontier));
      const mCtx = { ...flowCtx, cur: mPos };
      return (
        <ExplainerProvider value={NOOP_EXPLAINER}>
          <div className="fl-drawer-note">
            every token is a row in the model's 151,936 × 1,024 embedding table — not just a list
            of numbers but a position in a space of meanings, where words used alike sit close
            together. pick a word: its row, and its nearest neighbors by that closeness, recompute.
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
          <div className="fl-drawer-note">
            these scores are fixed — the knob only changes how one gets picked, no re-run.{" "}
            {knob === "temperature" &&
              "temperature flattens or sharpens the odds: low lets the top guess dominate, higher gives the also-rans a real chance."}
            {knob === "top-k" &&
              "top-k keeps only the k highest guesses and discards the rest before the draw — drag k to widen or narrow the shortlist."}
            {knob === "top-p" &&
              "top-p keeps the smallest group of top guesses whose odds add up to p, then draws from just those — drag p to loosen or tighten it."}
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
          <div className="fl-drawer-note">
            the draw picked “{esc(flowCtx.trace.tokens[cur]?.t ?? "")}”. force one of the other
            real candidates and the engine re-runs from there and the sentence changes.
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
                  setInspect(null); // the fork makes a new frontier — walk it
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
          <div className="fl-drawer-note">
            one draw, two histories. the shared prefix is dim; everything after position {at}{" "}
            belongs to its own world. red marks the model's own choice — the token you forced is
            tagged, not red.
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
          <div className="fl-drawer-note">
            every layer is read (attention), then <em>think</em>: two-thirds of the model's
            weights live in this block. the engine's real source, with this pass's real numbers
            threaded in — hover a name to see its value. change the layer: the code never
            changes, the numbers always do.
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
          <UnderHood ctx={flowCtx} stage="feedforward" layer={at} head={0} />
        </>
      );
    }
    if (drawer === "unembed" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            the last vector is scored against the same table the words came in through. tied
            embeddings: reading and writing share one matrix. each dot product below is a{" "}
            <b>logit</b> — one raw score per candidate word. a final step called <b>softmax</b> turns
            the whole list of logits into percentages that add up to 100%.
          </div>
          <UnembedDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "rmsnorm" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            before each layer reads the vector, it resets it to a standard length. same
            direction, steadier numbers. this slice is from the current pass.
          </div>
          <RmsNormDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "residual" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            the vector the climb reads, measured after every layer. the plot tracks its{" "}
            <b>RMS</b> — root-mean-square, a single number for how big the vector is overall. each
            layer adds its adjustment to this one running signal, and you can watch it grow.
          </div>
          <SignalField step={flowCtx.step} />
        </>
      );
    if (drawer === "heads" && flowCtx && prodStep)
      return (
        <>
          <div className="fl-drawer-note">
            attention isn't one spotlight — it's {flowCtx.trace.heads} heads, each reading its own
            place, and their jobs shift with depth. scrub the layers: early heads tend to read
            nearby words (grammar); deeper, some lock onto the content word that matters; and many
            settle on the <b>sink</b> — position 0, where a head points when it finds nothing worth
            fetching. red marks the layer's single strongest read.
          </div>
          <HeadField trace={flowCtx.trace} step={prodStep} prod={prod} />
        </>
      );
    if (drawer === "rope" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            before comparing two tokens, attention spins each one's vector by an angle set by its
            position. so the same word in slot 2 and slot 9 end up pointing differently — word order
            rides <em>inside</em> the vector, with no separate "position" number bolted on. each dial
            below is one pair of the vector's numbers; watch it rotate by this token's position.
          </div>
          <RopeDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "cache" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            why running it again is cheap: every earlier token's keys and values are already
            sitting here. the pass only computes the newest column.
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
          {hasRun && phase >= 1 && phase <= 4 && (
            <MachineMap
              trace={trace}
              n={cur}
              at={phase === 1 ? "vectors" : phase === 2 ? "read" : phase === 3 ? "climb" : "scores"}
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
