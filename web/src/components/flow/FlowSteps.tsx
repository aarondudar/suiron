import { esc, N_PARAMS } from "../../lib";
import { currentLink, encodeLink } from "../../link";
import { EXPERIMENTS, type Experiment } from "../../experiments";
import type { Step, Trace } from "../../types";
import { AttnSpace } from "../AttnSpace";
import { DrawField } from "../DrawField";
import { Epilogue } from "../Epilogue";
import { ExplainerProvider } from "../Explainer";
import { LensSpace } from "../LensSpace";
import { LoopChain } from "../LoopChain";
import { HIDDEN, NOOP_EXPLAINER, Sentence, VOCAB, aDelay, cDelay, hDelay, heroDelay } from "./parts";

/* The stage, one step at a time (docs/design.md + docs/storyboard.md). Every
   string here is the copy-script's, verbatim; every number is live. Split out
   of Flow.tsx (audit follow-up) — same render, the shell owns the state. */

export interface StepStageProps {
  trace: Trace;
  phase: number;
  cur: number;
  prod: number;
  frontier: number;
  busy: boolean;
  /** an action just started a run and the poll hasn't caught up yet */
  launching: boolean;
  hasRun: boolean;
  demo: boolean;
  prodStep?: Step;
  exp: Experiment | null;
  prompt: string;
  setPrompt: (v: string) => void;
  begin: () => void;
  runAgain: () => void;
  runExperiment: (e: Experiment) => void;
  setPhase: (n: number) => void;
  setInspect: (i: number | null) => void;
  climbTop: string;
  lockLayer: number | null;
  onClimbGuess: (top: string, lock: number | null) => void;
}

export function StepStage(p: StepStageProps) {
  const {
    trace,
    phase,
    cur,
    prod,
    frontier,
    busy,
    launching,
    hasRun,
    demo,
    prodStep,
    exp,
    prompt,
    setPrompt,
    begin,
    runAgain,
    runExperiment,
    setPhase,
    setInspect,
    climbTop,
    lockLayer,
    onClimbGuess,
  } = p;

  const waiting = (
    <div className="fl-status" role="status">
      {busy || launching ? "the model is running…" : "no run yet — go back and begin."}
    </div>
  );

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
          <div className="fl-cap fl-enter" style={cDelay}>
            type a few words, or use this one
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
            Each piece is called a token, and the model knows a fixed list of{" "}
            <b>{VOCAB.toLocaleString()}</b> of them, its vocabulary. Every token in that list is
            stored as <b>{HIDDEN.toLocaleString()}</b> numbers that place it on a map of meaning:
            those lists alone are <b>{Math.round((VOCAB * HIDDEN) / 1e6)} million</b> of the
            model's <b>{Math.round(N_PARAMS / 1e6)} million</b> numbers.
          </div>
          {exp && (
            <div className="fl-mark">
              experiment · {exp.title} · {exp.hook}
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
            <LensSpace trace={trace} prod={prod} onGuess={onClimbGuess} />
          </div>
          {climbTop && (
            <div className="fl-cap fl-enter" style={cDelay}>
              its guess so far: “{climbTop}”
              {lockLayer !== null && <> · it locks on at layer {lockLayer}</>}
            </div>
          )}
          <div className="fl-note fl-enter" style={aDelay}>
            Each round is called a layer. A layer does two things: it looks back over the earlier
            words, the attention you just watched, then it reworks each token on its own and hands
            the result to the next layer.
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
                {sel.forced ? (
                  <>
                    “{topTok}” holds {pTop} of the tickets · no draw here, you forced “{chosen}”
                  </>
                ) : (
                  <>
                    “{topTok}” holds {pTop} of the tickets · the draw landed on “{chosen}”
                  </>
                )}
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
          <div className="fl-ex">
            <span className="fl-ex-label">or try one of these experiments:</span>
            {EXPERIMENTS.map((e) => (
              <button key={e.id} title={e.hook} disabled={busy} onClick={() => runExperiment(e)}>
                {e.title}
              </button>
            ))}
          </div>
        </>
      );
    case 6:
    case 7: {
      // the outro, two stops on the continue path: "how it scales" (the
      // boundary, the measured f32/q8 race, the glossary), then "an agent"
      // (the loop, wrapped — chat lives in the expert view; experiments run
      // right here). One epilogue half per screen, so neither read crowds
      // the other.
      const link = currentLink(trace, { cur, c: null, walk: null, layer: -1 });
      const expertHref = link ? "?view=expert#" + encodeLink(link) : "?view=expert";
      // the chat handoff carries the SAME run (Aaron, 2026-07-26: landing in
      // chat after the tour "seems just confusing" — it was dropping the run
      // and rebooting blank). ?chat=1 rides alongside the run link exactly
      // like the plain "expert view" link above; ExpertLab restores the run
      // first, then opens chat once it lands.
      const chatHref = link ? "?view=expert&chat=1#" + encodeLink(link) : "?view=expert&chat=1";
      return (
        <ExplainerProvider value={NOOP_EXPLAINER}>
          <div className="fl-finale">
            {/* the epilogue's copy was written beside the full instrument;
                keep its "above" references honest from here (design-13);
                the link carries the run, so "above" shows THIS run */}
            <div className="fl-note fl-enter" style={hDelay}>
              written beside the full instrument — where it says “above”, it means the{" "}
              <a href={expertHref}>expert view</a>.
            </div>
            {/* the outro obeys the same entrance order as the tour: note,
                a beat, then the epilogue half, then the closing action */}
            <div className="fl-enter" style={heroDelay}>
              <Epilogue
                onTryChat={() => {
                  // land in the expert view WITH the chat open (its settings
                  // applied there) AND this exact run resident — not a blank
                  // reboot next to it
                  window.location.href = chatHref;
                }}
                onRun={runExperiment}
                trace={trace}
                part={phase === 6 ? "scale" : "agent"}
              />
            </div>
            {phase === 7 && (
              // the tour's last action loops back into the machine: one more
              // token of the same prompt
              <div className="fl-center fl-enter" style={cDelay}>
                <button className="fl-again" onClick={runAgain} disabled={busy}>
                  {busy ? "running…" : "run it again"}
                </button>
              </div>
            )}
          </div>
        </ExplainerProvider>
      );
    }
    default:
      return null;
  }
}
