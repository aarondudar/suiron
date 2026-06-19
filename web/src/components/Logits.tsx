import { fork } from "../api";
import { DEFAULT_PARAMS, esc } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { FocusTarget, Step } from "../types";

export function Logits({
  step,
  cur,
  busy,
  setHover,
}: {
  step: Step;
  cur: number;
  busy: boolean;
  setHover: (f: FocusTarget) => void;
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
        title={
          <>
            what the model expects next <Explain of="logits" />
          </>
        }
        sub={SUB.logits}
      />
      <div>
        {top.map(([id, text, p], i) => (
          <div
            className={"bar-row" + (busy ? " frozen" : " clickable") + (i === 0 ? " win" : "")}
            key={id}
            data-explain-el={"logit-" + i}
            title={
              busy
                ? "wait for generation to finish"
                : `fork: force "${esc(text)}" as the next token`
            }
            onClick={() => doFork(id)}
            onMouseEnter={() => setHover({ kind: "candidate", id })}
            onMouseLeave={() => setHover({ kind: "none" })}
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
