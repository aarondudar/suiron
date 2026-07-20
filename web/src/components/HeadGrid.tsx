import { useAutoplay } from "../autoplay";
import { headGlance, litToken } from "../lib";
import { Stepper } from "./Stepper";
import type { Step, Trace } from "../types";

/* The sixteen readers (design-15): attention is not one spotlight but
   heads-many, each with its own target, and their jobs change with depth.
   One cell per head at the scrubbed layer, naming the head's strongest
   source token and its real share of that head's recorded attention. Pure
   render over trace.steps[prod].attn — the edges the engine already
   recorded; no fetch. Red marks only the layer's single strongest head-read;
   a head parked on position 0 with real context available is the attention
   sink ("found nothing") and reads dim. */

export function HeadGrid({
  trace,
  step,
  prod,
}: {
  trace: Trace;
  /** the producing step whose attention is shown (trace.steps[prod]) */
  step: Step;
  prod: number;
}) {
  const lastLayer = trace.layers - 1;
  const { i: layer, playing, setI, toggle } = useAutoplay(lastLayer, { stepMs: 300 });

  const heads = step.attn[Math.min(layer, lastLayer)] ?? [];
  const nPos = prod + 1;
  const glances = heads.map((edges) => headGlance(edges));
  // the one strongest head-read at this layer (ignoring sinks when the head
  // had real context to read) — the only red on screen
  let best = -1;
  for (let h = 0; h < glances.length; h++) {
    const g = glances[h];
    if (!g) continue;
    const sink = g.topPos === 0 && prod > 3;
    if (sink) continue;
    if (best < 0 || g.share > (glances[best]?.share ?? 0)) best = h;
  }

  return (
    <div className="hg">
      <div className="hg-grid">
        {glances.map((g, h) => {
          if (!g)
            return (
              <div className="hg-cell empty" key={h}>
                <span className="hg-h">h{h}</span>
                <span className="hg-tok">—</span>
              </div>
            );
          const sink = g.topPos === 0 && prod > 3;
          const lt = litToken(trace.tokens[g.topPos]?.t ?? "");
          return (
            <div
              className={"hg-cell" + (h === best ? " win" : "") + (sink ? " sink" : "")}
              key={h}
              title={`head ${h} · strongest read: “${lt.text}” (position ${g.topPos}) · ${(g.share * 100).toFixed(0)}% of this head's recorded attention${sink ? " · the sink: found nothing to fetch" : ""}`}
            >
              <span className="hg-h">h{h}</span>
              <span className={"hg-tok" + (lt.literal ? " geo-lit" : "")}>
                {sink ? "∅ sink" : lt.text}
              </span>
              <span className="hg-p">{(g.share * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      <div className="hg-foot">
        <span className="hg-layer">
          layer {Math.min(layer, lastLayer)} / {lastLayer}
        </span>
        <span className="hg-cap">
          {nPos} position{nPos === 1 ? "" : "s"} readable · red = this layer's strongest read
        </span>
      </div>

      <Stepper i={layer} max={lastLayer} playing={playing} setI={setI} toggle={toggle} unit="layer" />
    </div>
  );
}
