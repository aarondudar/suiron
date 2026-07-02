import { useState } from "react";
import { esc, softmaxAt } from "../lib";
import type { Cand } from "../types";

/* Temperature applied to THIS token's real options. Pure client-side softmax
   over the candidate logits already in the trace, so it makes no engine call
   and is WASM-safe. temp 0 collapses to the single top pick; high temp flattens
   toward uniform. */

export function TemperatureDemo({
  cand,
  temp,
  chosen,
}: {
  cand: Cand[];
  temp: number;
  /** the token the draw actually picked, so the counterfactual has an anchor */
  chosen?: number;
}) {
  const [t, setT] = useState(temp);
  // the candidates the trace recorded, strongest first; cap for readability
  const rows = [...cand].sort((a, b) => b.logit - a.logit).slice(0, 8);
  const probs = softmaxAt(
    rows.map((c) => c.logit),
    t,
  );
  const max = Math.max(...probs, 1e-6);

  return (
    <div className="temp-demo">
      <div className="temp-demo-ctl">
        <span>temp</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
        />
        <b>{t.toFixed(2)}</b>
        <button className="temp-demo-reset" onClick={() => setT(temp)} title="back to this token's temperature">
          reset
        </button>
      </div>
      <div className="temp-demo-bars">
        {rows.map((c, i) => (
          <div
            className={"temp-row" + (c.id === chosen ? " chosen" : "")}
            key={c.id}
            title={c.id === chosen ? "the token the draw actually picked" : undefined}
          >
            <span className="temp-tok">{esc(c.t)}</span>
            <div className="temp-track">
              <div
                className={"temp-fill" + (probs[i] === max ? " top" : "")}
                style={{ width: `${(probs[i] / max) * 100}%` }}
              />
            </div>
            <span className="temp-p">{(probs[i] * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <div className="temp-demo-note">
        recomputed from this token's real logits; the red token is the one actually picked.{" "}
        {t <= 0 ? "at 0 the top pick takes everything." : "higher flattens the field."}
      </div>
    </div>
  );
}
