import { useEffect, useState } from "react";
import { getOdds } from "../api";
import { esc, softmaxAt } from "../lib";
import type { Cand } from "../types";

/* Temperature applied to THIS token's real options. The BAR LENGTHS are a
   client-side softmax over the candidate logits in the trace — relative shape,
   no engine call. The PRINTED percentages are the engine's exact shares over the
   whole vocabulary, because a softmax over the eight rows shown reads far higher
   than the model's real odds (design-34). temp 0 collapses to the single top
   pick; high temp flattens toward uniform. */

export function TemperatureDemo({
  cand,
  temp,
  chosen,
  pos,
}: {
  cand: Cand[];
  temp: number;
  /** the token the draw actually picked, so the counterfactual has an anchor */
  chosen?: number;
  /** the producing position: with it the printed percentages are shares of the
   *  whole vocabulary, from the engine. Without it the bars still show the right
   *  RELATIVE shape but carry no number, because a softmax over the eight rows
   *  on screen is not the model's odds (design-34, A1). */
  pos?: number;
}) {
  const [t, setT] = useState(temp);
  // the candidates the trace recorded, strongest first; cap for readability
  const rows = [...cand].sort((a, b) => b.logit - a.logit).slice(0, 8);
  const probs = softmaxAt(
    rows.map((c) => c.logit),
    t,
  );
  const max = Math.max(...probs, 1e-6);
  const [exact, setExact] = useState<number[] | null>(null);
  useEffect(() => {
    if (pos === undefined) return;
    let dead = false;
    const ids = rows.map((c) => c.id);
    const h = setTimeout(() => {
      getOdds(pos, t, ids).then((p) => !dead && setExact(p));
    }, 120);
    return () => {
      dead = true;
      clearTimeout(h);
    };
    // rows is derived from cand; its ids are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, t, cand]);

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
            <span className="temp-p">{exact ? `${(exact[i] * 100).toFixed(1)}%` : ""}</span>
          </div>
        ))}
      </div>
      <div className="temp-demo-note">
        recomputed from this token's real logits, as a share of the whole vocabulary; the red token
        is the one actually picked.{" "}
        {t <= 0 ? "at 0 the top pick takes everything." : "higher flattens the field."}
      </div>
    </div>
  );
}
