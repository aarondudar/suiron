import { useState } from "react";
import { esc, softmaxAt } from "../lib";
import type { Cand } from "../types";

/* top-k applied to THIS token's real candidates: drag k and watch the cut move.
   top-k is a hard cap on rank, so which tokens survive is temperature-independent;
   the bars show the distribution at the token's temperature (or 1 if greedy) for
   context. Pure client-side, no engine call. */

export function TopKDemo({ cand, k: k0, temp }: { cand: Cand[]; k: number; temp: number }) {
  const rows = [...cand].sort((a, b) => b.logit - a.logit);
  const base = temp > 0 ? temp : 1;
  const probs = softmaxAt(
    rows.map((c) => c.logit),
    base,
  );
  const max = Math.max(...probs, 1e-6);
  const maxK = rows.length;
  const init = Math.min(Math.max(1, k0), maxK);
  const [k, setK] = useState(init);
  const kept = Math.min(k, maxK);

  return (
    <div className="temp-demo">
      <div className="temp-demo-ctl">
        <span>k</span>
        <input
          type="range"
          min={1}
          max={maxK}
          step={1}
          value={kept}
          onChange={(e) => setK(Number(e.target.value))}
        />
        <b>{kept}</b>
        <button className="temp-demo-reset" onClick={() => setK(init)} title="back to this token's k">
          reset
        </button>
      </div>
      <div className="temp-demo-bars">
        {rows.map((c, i) => {
          const cut = i >= kept;
          return (
            <div className={"temp-row" + (cut ? " cut" : "")} key={c.id}>
              <span className="temp-tok">{esc(c.t)}</span>
              <div className="temp-track">
                <div
                  className={"temp-fill" + (i === 0 ? " top" : "")}
                  style={{ width: `${(probs[i] / max) * 100}%` }}
                />
              </div>
              <span className="temp-p">{(probs[i] * 100).toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
      <div className="temp-demo-note">
        top-k keeps the {kept} highest-scoring token{kept === 1 ? "" : "s"} and discards the rest; the
        draw then happens only among those, their probabilities rescaled to add to 100%. shown over
        the recorded candidates at temperature {base}.
      </div>
    </div>
  );
}
