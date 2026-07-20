import { useEffect, useRef, useState } from "react";
import { fork, generate, getTrace, step as stepMore } from "../api";
import { DEFAULT_PARAMS, esc, litToken, moments, shadowTrace } from "../lib";
import { currentLink, decodeLink, encodeLink, matchesResident } from "../link";
import { AttentionInteractive } from "./AttentionInteractive";
import { Drawer } from "./Drawer";
import { Epilogue } from "./Epilogue";
import { ExplainerProvider } from "./Explainer";
import { KvCacheDemo } from "./KvCacheDemo";
import type { ExplainCtx } from "./Explanations";
import { LensClimb } from "./LensClimb";
import { RmsNormDemo } from "./RmsNormDemo";
import { RnormSparkline } from "./RnormSparkline";
import { RopeDemo } from "./RopeDemo";
import { TemperatureDemo } from "./TemperatureDemo";
import { TokenizeDemo } from "./TokenizeDemo";
import { TopKDemo } from "./TopKDemo";
import { TopPDemo } from "./TopPDemo";
import type { Experiment } from "../experiments";
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
 *  closes any other. */
const DIVES: Record<number, { id: string; label: string }[]> = {
  1: [{ id: "merges", label: "watch the text become tokens" }],
  2: [
    { id: "dot", label: "watch one score compute" },
    { id: "rope", label: "how it knows word order" },
  ],
  3: [
    { id: "rmsnorm", label: "the reset before every layer" },
    { id: "residual", label: "the signal, layer by layer" },
  ],
  4: [
    { id: "sampling", label: "bend the odds: temperature, top-k, top-p" },
    { id: "fork", label: "what if it had picked differently?" },
  ],
  5: [
    { id: "cache", label: "the cache that makes the loop fast" },
    { id: "worlds", label: "the two worlds" },
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

  // ←/→ walk the steps when the spine has the floor (no drawer, not typing).
  // Mirrors the continue button's gate: leaving step 0 needs a run.
  const canAdvance = hasRun || busy;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (drawer !== null) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") setPhase((p) => (p < 5 && (p > 0 || canAdvance) ? p + 1 : p));
      if (e.key === "ArrowLeft") setPhase((p) => Math.max(0, p - 1));
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [drawer, canAdvance]);

  const begin = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setInspect(null); // a new run walks its own frontier
    void generate(text, { ...params, n: 1 });
    goPhase(1);
  };
  const runAgain = () => {
    if (!trace || busy) return;
    setInspect(null);
    void stepMore(1, params);
    goPhase(1);
  };
  /** the finale's experiments run live in the flow: a curated prompt loops
   *  the learner back into the spine (same param merge as the expert view) */
  const runExperiment = (e: Experiment) => {
    if (busy) return;
    setInspect(null);
    setPrompt(e.prompt);
    void generate(e.prompt, { ...params, ...e.params });
    goPhase(1);
  };

  const railTo = (n: number) => {
    if (hasRun || busy) goPhase(n);
  };

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

  /** the dive affordances under a step: one quiet button per docked drawer.
   *  "the two worlds" only exists while a fork is resident. */
  const dive = (n: number) => {
    const ds = DIVES[n]?.filter((d) => d.id !== "worlds" || !!trace?.fork);
    if (!ds?.length) return null;
    return (
      <div className="fl-dive">
        {ds.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setKnob("temperature"); // a fresh open starts at the first knob
              setDrawer(d.id);
            }}
            disabled={!hasRun}
          >
            ↓ {d.label}
          </button>
        ))}
      </div>
    );
  };

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
              the model does one thing: <em>guess the next word</em>. type something, and watch it
              happen — one step at a time.
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
            {hasRun && (
              <div className="fl-note">
                a run is already loaded — continue walks it; begin starts fresh.
              </div>
            )}
            <div className="fl-about">
              a from-scratch inference engine in Rust — every number in this walkthrough is
              computed live by it, nothing is canned.{" "}
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
              first, your words become <em>tokens</em> — the pieces the model actually reads.
            </p>
            <Sentence trace={trace} n={n} stagger showIds />
            <div className="fl-note">
              {n} piece{n === 1 ? "" : "s"} · ids from the engine's tokenizer
            </div>
            {dive(1)}
          </>
        );
      }
      case 2:
        if (!hasRun) return waiting;
        return (
          <>
            <p className="fl-line">
              to guess what comes next, it <em>looks back</em> over everything written so far.
            </p>
            <Sentence trace={trace} n={cur} dim readHead onPick={setInspect} />
            {mark(["attention", "induction"])}
            {dive(2)}
          </>
        );
      case 3:
        if (!hasRun || !prodStep) return waiting;
        return (
          <>
            <p className="fl-line">
              it doesn't decide at once. the guess <em>sharpens</em> as it passes through all{" "}
              {trace.layers} layers.
            </p>
            <LensClimb trace={trace} prod={prod} prodStep={prodStep} />
            {dive(3)}
          </>
        );
      case 4: {
        if (!hasRun || !prodStep) return waiting;
        const top = prodStep.top ?? [];
        const chosenId = trace.tokens[cur].id;
        const covered = top.reduce((a, [, , p]) => a + p, 0);
        const winner = top.find(([id]) => id === chosenId);
        const winP = winner?.[2] ?? 0;
        const restPct = Math.max(0, 1 - winP) * 100;
        const sel = trace.steps[cur]?.sel;
        return (
          <>
            <p className="fl-line">
              then it <em>draws one</em>. usually the top guess — but temperature leaves room for
              chance.
            </p>
            <div className="fl-dist" role="img" aria-label="the real next-token distribution">
              {top.map(([id, t, p]) => (
                <div
                  key={id}
                  className={"fl-seg" + (id === chosenId ? " chosen" : "")}
                  style={{ width: `${p * 100}%` }}
                  title={`${esc(t)} · ${(p * 100).toFixed(1)}%`}
                />
              ))}
              <div className="fl-seg rest" style={{ width: `${Math.max(0, 1 - covered) * 100}%` }} />
            </div>
            <div className="fl-dist-legend">
              <span className="fl-win">
                {esc(trace.tokens[cur].t)} · {winner ? (winP * 100).toFixed(0) : "<1"}%
              </span>
              <span>everything else · {restPct < 1 ? "<1" : restPct.toFixed(0)}%</span>
            </div>
            <div className="fl-note">
              {sel
                ? sel.r == null
                  ? `temp ${sel.temp} · greedy — the top guess wins by rule`
                  : `the draw landed at r = ${sel.r.toFixed(3)}`
                : "prompt token — you supplied it, the model did not draw it"}
            </div>
            {mark(["output"])}
            {dive(4)}
          </>
        );
      }
      case 5:
        if (!hasRun) return waiting;
        // the loop step always shows the WHOLE run (the frontier sentence);
        // clicking a word opens its story back on "looks back"
        return (
          <>
            <Sentence
              trace={trace}
              n={frontier + 1}
              dim
              lastNew
              onPick={(i) => {
                setInspect(i);
                setPhase(2);
              }}
            />
            <div className="fl-note">click any word to see how it was made</div>
            <p className="fl-line">
              that word joins the sentence — and it does the <em>whole thing again</em>.
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
            {dive(5)}
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
    if (drawer === "sampling" && flowCtx?.sel) {
      const sel = flowCtx.sel;
      return (
        <>
          <div className="fl-drawer-note">
            the same real options as the bar behind — each knob recomputes from this draw's
            recorded logits; nothing re-runs the model.
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
      return <div className="fl-stub">no recorded draw at this position — run a step first.</div>;
    if (drawer === "fork" && flowCtx) {
      const top = (flowCtx.step.top ?? []).slice(0, 6);
      const chosenId = flowCtx.trace.tokens[cur]?.id;
      return (
        <>
          <div className="fl-drawer-note">
            the draw picked “{esc(flowCtx.trace.tokens[cur]?.t ?? "")}”. force one of the other
            real candidates and the engine re-runs from there — the sentence you watched changes.
          </div>
          <div className="fl-fork-opts">
            {top.map(([id, t, p]) => (
              <button
                key={id}
                className={"fl-fork-opt" + (id === chosenId ? " picked" : "")}
                disabled={id === chosenId || busy}
                onClick={() => {
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
            this run's replaced tail wasn't recorded, so the other world can't be shown — fork
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
    if (drawer === "rmsnorm" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            before each layer reads the vector, it resets it to a standard length — same
            direction, steadier numbers. this slice is from the current pass.
          </div>
          <RmsNormDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "residual" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            the vector the climb reads, measured after every layer — each layer adds its
            adjustment to this one running signal.
          </div>
          <RnormSparkline step={flowCtx.step} layer={flowCtx.layer} layers={flowCtx.trace.layers} />
        </>
      );
    if (drawer === "rope" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            before comparing two tokens, attention spins each one's vector by its position — that
            spin is how word order enters the math.
          </div>
          <RopeDemo ctx={flowCtx} />
        </>
      );
    if (drawer === "cache" && flowCtx)
      return (
        <>
          <div className="fl-drawer-note">
            why running it again is cheap: every earlier token's keys and values are already
            sitting here — the pass only computes the newest column.
          </div>
          <KvCacheDemo ctx={flowCtx} />
        </>
      );
    return (
      <div className="fl-stub">
        this deep-dive re-homes an existing module here — coming soon, one pass at a time. until
        then it lives in the <a href="?view=expert">expert view</a>.
      </div>
    );
  })();

  return (
    <div className="flow-wrap">
      <div className="flow">
        <div className="fl-under" inert={drawer !== null}>
        <div className="fl-head">
          <div className="fl-brand">
            suiron<span className="jp">推論</span>
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
              />
            ))}
          </div>
        </div>

        <div className="fl-stage" key={phase}>
          {phase >= 1 && phase <= 4 && trace && hasRun && cur !== frontier && (
            <div className="fl-inspect-bar">
              under the microscope: <b>{esc(trace.tokens[cur]?.t ?? "")}</b> · position {cur}
              <button onClick={() => setInspect(null)}>⨯ back to the newest</button>
            </div>
          )}
          {stage}
        </div>

        <div className="fl-foot">
          <button
            className="fl-nav"
            style={{ visibility: phase > 0 ? "visible" : "hidden" }}
            onClick={() => setPhase((p) => Math.max(0, p - 1))}
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
              `${phase} / 5 · ${STEPS[phase]}`
            ) : (
              "one prediction, five steps"
            )}
          </span>
          <button
            className="fl-nav primary"
            style={{ visibility: phase < 5 && (phase > 0 || hasRun || busy) ? "visible" : "hidden" }}
            onClick={() => setPhase((p) => Math.min(5, p + 1))}
          >
            continue
          </button>
        </div>
        </div>

        {drawer && openDive && (
          <Drawer label={openDive.label} onClose={() => setDrawer(null)}>
            {drawerBody}
          </Drawer>
        )}
      </div>

      <div className="fl-alt">
        <a href="?view=expert">expert view — the whole lab on one page</a>
      </div>
    </div>
  );
}
