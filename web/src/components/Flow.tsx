import { useEffect, useState } from "react";
import { generate, getTrace, step as stepMore } from "../api";
import { DEFAULT_PARAMS, esc } from "../lib";
import { AttentionInteractive } from "./AttentionInteractive";
import { Drawer } from "./Drawer";
import { KvCacheDemo } from "./KvCacheDemo";
import type { ExplainCtx } from "./Explanations";
import { LensClimb } from "./LensClimb";
import { RopeDemo } from "./RopeDemo";
import { TemperatureDemo } from "./TemperatureDemo";
import { TokenizeDemo } from "./TokenizeDemo";
import { TopKDemo } from "./TopKDemo";
import { TopPDemo } from "./TopPDemo";
import type { Trace } from "../types";

/* The guided flow — the app's spine (docs/design.md). Five steps walk one real
   prediction in the causal order it happens: tokens → looks back → sharpens →
   draws one → loops. One idea per screen; every deep-dive opens as a single
   drawer over the current step and closes back to it. Everything here reads
   LIVE from the resident trace via the same machinery the expert stack uses —
   the prototype (docs/prototype/core-loop.html) is the shape and pacing to
   match, never a data source. */

/** step vocabulary from docs/design.md — fix it there first */
const STEPS = ["begin", "tokens", "looks back", "sharpens", "draws one", "loops"] as const;

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
}: {
  trace: Trace;
  pos: number;
  tone?: "dim" | "read" | "new";
  /** staggered-arrival delay in seconds (tokens step only) */
  delay?: number;
}) {
  const tok = trace.tokens[pos];
  if (!tok) return null;
  return (
    <span
      className={"fl-chip" + (tone ? " " + tone : "")}
      style={delay !== undefined ? { animationDelay: `${delay}s` } : undefined}
      data-id={tok.id}
      title={`id ${tok.id} · pos ${pos}`}
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
}: {
  trace: Trace;
  n: number;
  dim?: boolean;
  readHead?: boolean;
  lastNew?: boolean;
  stagger?: boolean;
  /** surface each chip's token id on hover (the tokens step) */
  showIds?: boolean;
}) {
  return (
    <div className={"fl-sentence" + (stagger ? " stagger" : "") + (showIds ? " fl-ids" : "")}>
      {trace.tokens.slice(0, n).map((_, i) => (
        <Chip
          key={i}
          trace={trace}
          pos={i}
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
  4: [{ id: "sampling", label: "bend the odds: temperature, top-k, top-p" }],
  5: [{ id: "cache", label: "the cache that makes the loop fast" }],
};

export function Flow() {
  const trace = useTrace();
  const [phase, setPhase] = useState(0);
  const [prompt, setPrompt] = useState("");
  /** the ONE open drawer (a DIVES id), or null. A single slot is the
   *  single-drawer rule: opening another replaces this one. */
  const [drawer, setDrawer] = useState<string | null>(null);
  const [knob, setKnob] = useState<Knob>("temperature");
  const params = DEFAULT_PARAMS;

  // moving to another step always returns to the spine first
  useEffect(() => setDrawer(null), [phase]);

  // the flow always walks the frontier: the production of the newest token
  const cur = trace ? trace.tokens.length - 1 : -1;
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
    void generate(text, params);
    setPhase(1);
  };
  const runAgain = () => {
    if (!trace || busy) return;
    void stepMore(1, params);
    setPhase(1);
  };

  const railTo = (n: number) => {
    if (hasRun || busy) setPhase(n);
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

  /** the dive affordances under a step: one quiet button per docked drawer */
  const dive = (n: number) => {
    const ds = DIVES[n];
    if (!ds) return null;
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
            <Sentence trace={trace} n={cur} dim readHead />
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
            {dive(4)}
          </>
        );
      }
      case 5:
        if (!hasRun) return waiting;
        return (
          <>
            <Sentence trace={trace} n={cur + 1} dim lastNew />
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
            {dive(5)}
          </>
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
