import { esc } from "../lib";
import type { Step } from "../types";

export function Logits({ step }: { step: Step }) {
  const top = step.top ?? [];
  const pmax = top.length ? top[0][2] : 1;

  return (
    <section>
      <div className="label">
        <span className="idx">03</span>
        next-token prediction
        <span className="note">
          {" "}— softmax over all 151,936 logits after the last layer: what the model believes
          comes after the current token
        </span>
      </div>
      <div>
        {top.map(([id, text, p], i) => (
          <div className={"bar-row" + (i === 0 ? " win" : "")} key={id}>
            <span className="bar-tok">{esc(text)}</span>
            <div className="bar-wrap">
              <div className="bar" style={{ width: `${((p / pmax) * 100).toFixed(1)}%` }} />
            </div>
            <span className="bar-p">{(p * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
