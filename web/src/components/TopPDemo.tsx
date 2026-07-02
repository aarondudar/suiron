import { useState } from "react";
import { esc, softmaxAt } from "../lib";
import type { Cand } from "../types";

/* top-p (nucleus) applied to THIS token's real candidates: drag p and watch the
   cut adapt. top-p keeps the smallest set of top tokens whose probabilities add
   up to p, so the cut depends on the distribution — a confident step keeps few,
   an uncertain one keeps more. Pure client-side, no engine call. */

export function TopPDemo({
  cand,
  p: p0,
  temp,
  chosen,
}: {
  cand: Cand[];
  p: number;
  temp: number;
  /** the token the draw actually picked, so dragging the cut has an anchor */
  chosen?: number;
}) {
  const rows = [...cand].sort((a, b) => b.logit - a.logit);
  const base = temp > 0 ? temp : 1;
  const probs = softmaxAt(
    rows.map((c) => c.logit),
    base,
  );
  const max = Math.max(...probs, 1e-6);
  const init = Math.min(1, Math.max(0, p0));
  const [p, setP] = useState(init);

  // cumulative probability, and the nucleus: the smallest prefix reaching p
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < rows.length; i++) {
    acc += probs[i];
    cum[i] = acc;
  }
  let n = rows.length;
  for (let i = 0; i < rows.length; i++) {
    if (cum[i] >= p) {
      n = i + 1;
      break;
    }
  }

  return (
    <div className="temp-demo">
      <div className="temp-demo-ctl">
        <span>p</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p}
          onChange={(e) => setP(Number(e.target.value))}
        />
        <b>{p.toFixed(2)}</b>
        <button className="temp-demo-reset" onClick={() => setP(init)} title="back to this token's p">
          reset
        </button>
      </div>
      <div className="temp-demo-bars">
        {rows.map((c, i) => {
          const cut = i >= n;
          return (
            <div
              className={"temp-row" + (cut ? " cut" : "") + (c.id === chosen ? " chosen" : "")}
              key={c.id}
              title={c.id === chosen ? "the token the draw actually picked" : undefined}
            >
              <span className="temp-tok">{esc(c.t)}</span>
              <div className="temp-track">
                <div
                  className={"temp-fill" + (i === 0 ? " top" : "")}
                  style={{ width: `${(probs[i] / max) * 100}%` }}
                />
              </div>
              <span className="temp-p">{(probs[i] * 100).toFixed(1)}%</span>
              <span className="temp-cum">{(cum[i] * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
      <div className="temp-demo-note">
        top-p keeps the smallest set of top tokens whose probabilities add up to p: {n} token
        {n === 1 ? "" : "s"} here, covering {(cum[n - 1] * 100).toFixed(0)}%. the right column is the
        running total. raise p to keep more, lower it to keep fewer. shown at temperature {base}.
        {chosen !== undefined && rows.findIndex((c) => c.id === chosen) >= n && (
          <b> at this p, the token that was actually picked would have been cut.</b>
        )}
      </div>
    </div>
  );
}
