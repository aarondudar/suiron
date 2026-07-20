import { useEffect, useRef } from "react";
import { useAutoplay } from "../autoplay";
import { esc, settledSeq } from "../lib";
import { useLens } from "./Geometry";
import { Stepper } from "./Stepper";
import type { Step, Trace } from "../types";

/* The inline signature on "sharpens" (docs/design.md): the real logit-lens
   climb, full real estate in the spine — never a drawer. Reads the same
   getLens primitive the geometry band uses (via useLens); the rows are the
   FINAL layer's top candidates, and each layer shows their real probabilities
   at that depth, so you watch the eventual winner climb. Red marks the model's
   current top guess only. The last lens layer equals the engine's real output
   distribution — the check line at the end compares them live. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LensClimb({
  trace,
  prod,
  prodStep,
}: {
  trace: Trace;
  prod: number;
  /** the producing step (trace.steps[prod]) — the engine's final output to check against */
  prodStep: Step;
}) {
  const lens = useLens(prod, true, settledSeq(trace));
  const last = lens ? lens.layers.length - 1 : 0;
  const { i, playing, setI, toggle } = useAutoplay(last, { stepMs: 130 });

  // the climb runs itself once when the data lands (the prototype's pacing);
  // reduced-motion users start on the finished state (useAutoplay's default)
  const started = useRef(false);
  useEffect(() => {
    if (!lens || started.current || REDUCED) return;
    started.current = true;
    toggle();
  }, [lens, toggle]);

  if (!lens || !lens.layers.length)
    return (
      <div className="fl-status" role="status">
        computing the climb — one forward pass, read at every layer…
      </div>
    );

  const at = lens.layers[Math.min(i, last)];
  const rows = lens.layers[last].top.slice(0, 5);
  const probOf = (id: number) => at.top.find(([tid]) => tid === id)?.[2] ?? 0;
  const curTop = at.top[0];
  const done = i >= last;

  // the final lens layer must equal the engine's real next-token prediction
  const lensTop = lens.layers[last].top[0];
  const engineTop = prodStep.top?.[0];
  const agrees = !!lensTop && !!engineTop && lensTop[0] === engineTop[0];
  // the decision moment: the first layer whose top guess is the final winner
  const leadIdx = lensTop ? lens.layers.findIndex((L) => L.top[0]?.[0] === lensTop[0]) : -1;
  const leadLayer = leadIdx >= 0 ? lens.layers[leadIdx].layer : null;

  return (
    <div className="fl-climb">
      {rows.map(([id, t]) => {
        const p = probOf(id);
        const win = curTop?.[0] === id;
        return (
          <div key={id} className="fl-climb-row">
            <span className={"fl-climb-tok" + (win ? " win" : "")}>{esc(t)}</span>
            <div className="fl-climb-bar">
              <div className={"fl-climb-fill" + (win ? " win" : "")} style={{ width: `${p * 100}%` }} />
            </div>
            <span className="fl-climb-p">{(p * 100).toFixed(0)}%</span>
          </div>
        );
      })}

      <div className="fl-climb-foot">
        <span className="fl-climb-layer">
          layer {at.layer} / {lens.layers[last].layer}
        </span>
        <span className="fl-climb-guess">
          top guess here: “{esc(curTop?.[1] ?? "")}”
        </span>
      </div>

      <Stepper i={i} max={last} playing={playing} setI={setI} toggle={toggle} unit="layer" />

      {done && (
        <div className="fl-note" role="status">
          {agrees
            ? `“${esc(lensTop[1])}”${
                leadLayer !== null ? ` takes the lead at layer ${leadLayer}` : ""
              } — the engine's real prediction ✓`
            : "the last layer differs from the engine's prediction — inspect in the expert view"}
        </div>
      )}
    </div>
  );
}
