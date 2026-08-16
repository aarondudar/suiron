import { esc } from "../lib";
import type { Trace } from "../types";

/* "looks back", as an instrument (design-35 pass 4): the attention drawn ON the
   sentence.

   It was a ring of dots with pull lines to a centre. The weights were real but
   they lived in line brightness — the faintest channel on screen — while the
   loudest one, where each word sat, was reading order smeared around a circle.
   So the step's own headline ("it does not look at every word equally") was the
   one thing you could not read off the picture, and the words were scattered out
   of the order step 1 had just taught.

   Now both channels are real and neither is wasted: the words stay in the order
   you wrote them, and how hard the model looked at each is the height above it.
   The first token is INCLUDED rather than dropped — it takes most of the looking
   because models park spare attention there, and saying so is better than hiding
   it and apologising in the caption, which is what the ring forced. Every share
   is a real fraction of this position's total attention, summed over every layer
   and head; nothing is renormalised over a subset. */
export function AttnBars({ trace, prod }: { trace: Trace; prod: number }) {
  const step = trace.steps[prod];
  if (!step || prod < 1) return null;

  const w = new Array(prod + 1).fill(0);
  for (const layer of step.attn)
    for (const head of layer) for (const [p, v] of head) if (p <= prod) w[p] += v;
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const share = w.map((v) => v / total);
  const peak = Math.max(...share, 1e-6);
  /* red means one thing in this app: what the model attended to most. Here that
     is the strongest word it looked BACK at — not the first token, which is
     parked spare attention, and not the token doing the reading. Without this
     the ordinary bars were red and the two special ones were grey, which is the
     rule exactly upside down. */
  let hot = -1;
  for (let p = 1; p < prod; p++) if (hot < 0 || share[p] > share[hot]) hot = p;

  return (
    <div className="ab" role="img" aria-label="how hard the model looked at each earlier word">
      {share.map((s, p) => {
        const sink = p === 0 && prod > 1;
        const here = p === prod;
        return (
          <div className="ab-col" key={p} title={`${esc(trace.tokens[p]?.t ?? "")} · ${(s * 100).toFixed(1)}%`}>
            <div className="ab-pct">{(s * 100).toFixed(0)}%</div>
            <div className="ab-track">
              <div
                className={
                  "ab-bar" + (sink ? " sink" : here ? " here" : p === hot ? " hot" : "")
                }
                style={{ height: `${(s / peak) * 100}%` }}
              />
            </div>
            <div className={"ab-tok" + (here ? " here" : "")}>{esc(trace.tokens[p]?.t ?? "")}</div>
            {sink && <div className="ab-note">spare</div>}
            {here && <div className="ab-note">reading from</div>}
          </div>
        );
      })}
    </div>
  );
}
