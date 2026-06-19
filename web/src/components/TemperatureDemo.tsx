import { useState } from "react";
import { esc } from "../lib";
import type { Cand } from "../types";

/* The one v2.0 interactive: temperature applied to THIS token's real options.
   Pure client-side softmax over the candidate logits already in the trace, so
   it makes no engine call and is WASM-safe. temp 0 collapses to the single top
   pick; high temp flattens toward uniform. */

function softmaxAt(logits: number[], t: number): number[] {
  if (t <= 0) {
    // temperature 0 is the limit: all mass on the highest logit (argmax)
    let m = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[m]) m = i;
    return logits.map((_, i) => (i === m ? 1 : 0));
  }
  const max = Math.max(...logits);
  const ex = logits.map((l) => Math.exp((l - max) / t));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / sum);
}

export function TemperatureDemo({ cand, temp }: { cand: Cand[]; temp: number }) {
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
          <div className="temp-row" key={c.id}>
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
        recomputed from this token's real logits. {t <= 0 ? "at 0 the top pick takes everything." : "higher flattens the field."}
      </div>
    </div>
  );
}
