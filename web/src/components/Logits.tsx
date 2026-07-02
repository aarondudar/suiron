import type { ReactNode } from "react";
import { fork } from "../api";
import { DEFAULT_PARAMS, esc } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import { RoleTag } from "./RoleTag";
import type { FocusTarget, Step, Trace } from "../types";

export function Logits({
  trace,
  step,
  cur,
  busy,
  setHover,
  card,
  dim,
}: {
  trace: Trace;
  step: Step;
  cur: number;
  busy: boolean;
  setHover: (f: FocusTarget) => void;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
}) {
  const top = step.top ?? [];
  const pmax = top.length ? top[0][2] : 1;

  // this band shows the prediction that produced token `cur`, so forking forces
  // a different candidate AT position cur (replacing the inspected token)
  const doFork = (id: number) => {
    if (!busy) void fork(cur, id, DEFAULT_PARAMS);
  };

  return (
    <section className={dim ? "dimmed" : undefined}>
      <BandHeader
        idx="03"
        title={<Explain of="logits">what the model predicted here</Explain>}
        sub={SUB.logits}
      >
        <RoleTag trace={trace} pos={cur - 1} kind="prod" />
      </BandHeader>
      {card}
      <div>
        {top.map(([id, text, p], i) => (
          <div
            className={"bar-row" + (busy ? " frozen" : " clickable") + (i === 0 ? " win" : "")}
            key={id}
            data-explain-el={"logit-" + i}
            title={
              busy
                ? "wait for generation to finish"
                : `fork: force "${esc(text)}" as this token instead`
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
