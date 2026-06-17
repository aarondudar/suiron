import { fork } from "../api";
import { DEFAULT_PARAMS, esc } from "../lib";
import { BandHeader } from "./BandHeader";
import type { Step } from "../types";

export function Logits({
  step,
  cur,
  busy,
  setHoverCand,
}: {
  step: Step;
  cur: number;
  busy: boolean;
  setHoverCand: (id: number | null) => void;
}) {
  const top = step.top ?? [];
  const pmax = top.length ? top[0][2] : 1;

  // forking from position cur forces the candidate as token cur+1
  const doFork = (id: number) => {
    if (!busy) void fork(cur + 1, id, DEFAULT_PARAMS);
  };

  return (
    <section>
      <BandHeader
        idx="02"
        title="what the model expects next"
        sub="the model's ranked next-token guesses, as probabilities."
        explain={
          <>
            once the token has passed through all the layers, the model scores every one of the
            151,936 vocabulary tokens, and softmax turns those scores into probabilities — its
            belief before any randomness. click a bar to <b>force</b> that token and watch the
            rest regenerate from your choice.
          </>
        }
      />
      <div>
        {top.map(([id, text, p], i) => (
          <div
            className={"bar-row" + (busy ? " frozen" : " clickable") + (i === 0 ? " win" : "")}
            key={id}
            title={
              busy
                ? "wait for generation to finish"
                : `fork: force "${esc(text)}" as the next token`
            }
            onClick={() => doFork(id)}
            onMouseEnter={() => setHoverCand(id)}
            onMouseLeave={() => setHoverCand(null)}
          >
            <span className="bar-tok">{esc(text)}</span>
            <div className="bar-wrap">
              <div className="bar" style={{ width: `${((p / pmax) * 100).toFixed(1)}%` }} />
            </div>
            <span className="bar-p">{(p * 100).toFixed(1)}%</span>
            <span className="fork-hint">⑂ fork</span>
          </div>
        ))}
      </div>
    </section>
  );
}
