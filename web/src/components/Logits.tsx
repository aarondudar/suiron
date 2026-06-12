import { fork } from "../api";
import { DEFAULT_PARAMS, esc } from "../lib";
import type { Step } from "../types";

export function Logits({
  step,
  cur,
  busy,
}: {
  step: Step;
  cur: number;
  busy: boolean;
}) {
  const top = step.top ?? [];
  const pmax = top.length ? top[0][2] : 1;

  // forking from position cur forces the candidate as token cur+1
  const doFork = (id: number) => {
    if (!busy) void fork(cur + 1, id, DEFAULT_PARAMS);
  };

  return (
    <section>
      <div className="label">
        <span className="idx">02</span>
        what the model expects next · click a candidate to force it and fork reality
        <span className="note">
          {" "}— softmax over all 151,936 logits after the last layer. clicking a bar rewinds
          to this position, stamps YOUR choice in as the next token, and lets the model
          continue from the altered history — a counterfactual.
        </span>
      </div>
      <div>
        {top.map(([id, text, p], i) => (
          <div
            className={"bar-row clickable" + (i === 0 ? " win" : "")}
            key={id}
            title={`fork: force "${esc(text)}" as the next token`}
            onClick={() => doFork(id)}
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
