import { useEffect, useRef } from "react";
import { useAutoplay } from "../autoplay";
import { litToken, settledSeq } from "../lib";
import { useLens } from "./Geometry";
import { REDUCED } from "./spaceCanvas";
import { Stepper } from "./Stepper";
import type { Lens, Trace } from "../types";

const K = 7; // candidates tracked (final layer's top-K)

/* The climb, as the thing it is (design-35, track B).
   It was a vector swinging around a sphere of word-directions: the MOTION was
   real, but the words' positions were an illustration, and position is the
   loudest channel a picture has. Worse, it was the third instrument in the tour
   to draw dim dots in a rotating space, one step after step 1 taught that
   nearby-means-similar — so a reader who learned that grammar imported it here
   and was wrong.

   Now both axes carry a real quantity: layer across, probability up. "The guess
   sharpens across 28 rounds" is a line that climbs, the moment it takes the lead
   is where the red line crosses above the rest, and the lock-on layer the caption
   names is marked on the axis it belongs to. Same getLens numbers, nothing
   added. */
const CW = 340;
const CH = 172;
const PAD = { l: 30, r: 52, t: 12, b: 20 };

function ClimbChart({
  lens,
  at,
  k,
  lockAt,
}: {
  lens: Lens;
  at: number;
  k: number;
  lockAt: number | null;
}) {
  const layers = lens.layers;
  const last = layers.length - 1;
  const rows = layers[last].top.slice(0, k);
  const x = (l: number) => PAD.l + (l / Math.max(1, last)) * (CW - PAD.l - PAD.r);
  const y = (p: number) => CH - PAD.b - Math.max(0, Math.min(1, p)) * (CH - PAD.t - PAD.b);
  const probAt = (li: number, id: number) => layers[li].top.find(([t]) => t === id)?.[2] ?? 0;
  const lockIdx = lockAt === null ? -1 : layers.findIndex((L) => L.layer === lockAt);
  return (
    <svg className="cl-chart" viewBox={`0 0 ${CW} ${CH}`} role="img"
      aria-label="each candidate's probability at every layer — the winner climbing to the top">
      {[0, 0.5, 1].map((p) => (
        <g key={p}>
          <line className="cl-grid" x1={PAD.l} y1={y(p)} x2={CW - PAD.r} y2={y(p)} />
          <text className="cl-tick" x={PAD.l - 5} y={y(p) + 3} textAnchor="end">
            {p * 100}%
          </text>
        </g>
      ))}
      {lockIdx >= 0 && (
        <g>
          <line className="cl-lock" x1={x(lockIdx)} y1={PAD.t} x2={x(lockIdx)} y2={CH - PAD.b} />
          <text className="cl-lock-lab" x={x(lockIdx) + 3} y={PAD.t + 7}>
            takes the lead
          </text>
        </g>
      )}
      {/* dim lines first, the winner last so it reads on top */}
      {rows
        .map((r, ki) => ({ r, ki }))
        .sort((a, b) => (a.ki === 0 ? 1 : b.ki === 0 ? -1 : 0))
        .map(({ r, ki }) => (
          <polyline
            key={r[0]}
            className={"cl-line" + (ki === 0 ? " win" : "")}
            points={layers.map((_, li) => `${x(li)},${y(probAt(li, r[0]))}`).join(" ")}
          />
        ))}
      <line className="cl-cursor" x1={x(at)} y1={PAD.t} x2={x(at)} y2={CH - PAD.b} />
      {rows.map((r, ki) => (
        <circle
          key={r[0]}
          className={"cl-dot" + (ki === 0 ? " win" : "")}
          cx={x(at)}
          cy={y(probAt(at, r[0]))}
          r={ki === 0 ? 2.6 : 1.7}
        />
      ))}
      {/* name the lines at the right edge, where they end up */}
      {rows.slice(0, 4).map((r, ki) => (
        <text
          key={r[0]}
          className={"cl-lab" + (ki === 0 ? " win" : "")}
          x={CW - PAD.r + 4}
          y={y(probAt(last, r[0])) + 3}
        >
          {litToken(r[1]).text}
        </text>
      ))}
      <text className="cl-tick" x={PAD.l} y={CH - 6}>
        layer 0
      </text>
      <text className="cl-tick" x={CW - PAD.r} y={CH - 6} textAnchor="end">
        layer {layers[last].layer}
      </text>
    </svg>
  );
}

export function LensSpace({
  trace,
  prod,
  onGuess,
}: {
  trace: Trace;
  prod: number;
  /** report the shown-depth top-1 and the lock-on layer up to the spine caption
   *  (design-24: the instrument speaks only through the script's caption C) */
  onGuess?: (lensTop: string, lockLayer: number | null) => void;
}) {
  const lens = useLens(prod, true, settledSeq(trace));
  const last = lens ? lens.layers.length - 1 : 0;
  const { i, playing, setI, toggle } = useAutoplay(last, { stepMs: 150 });

  // climb once when the data lands; reduced-motion starts on the finished state
  const started = useRef(false);
  useEffect(() => {
    if (!lens || started.current || REDUCED) return;
    started.current = true;
    toggle();
  }, [lens, toggle]);

  // the shown-depth top-1 and the lock-on layer, for the spine caption. The
  // instrument prints no prose of its own (design-24); the chart is drawn from
  // `lens` directly, so nothing else needs deriving here.
  let readWord = "";
  let leadLayer: number | null = null;
  if (lens && lens.layers.length) {
    const at = lens.layers[Math.min(i, last)];
    const winnerId = lens.layers[last].top[0]?.[0];
    const leadIdx = winnerId != null ? lens.layers.findIndex((L) => L.top[0]?.[0] === winnerId) : -1;
    leadLayer = leadIdx >= 0 ? lens.layers[leadIdx].layer : null;
    // whitespace-literal form for the caption: an early layer's top guess is
    // often a bare space, which esc() would render as an empty-looking quote
    readWord = litToken(at.top[0]?.[1] ?? "").text;
  }

  // report the shown-depth guess + lock layer to the spine caption (C does the
  // talking; the instrument prints no prose of its own).
  const onGuessRef = useRef(onGuess);
  onGuessRef.current = onGuess;
  useEffect(() => {
    onGuessRef.current?.(readWord, leadLayer);
  }, [readWord, leadLayer]);


  if (!lens || !lens.layers.length)
    return (
      <div className="fl-status" role="status">
        computing the climb — one forward pass, read at every layer…
      </div>
    );

  return (
    <div className="fl-spacewrap">
      <div className="fl-space fl-space-climb">
        <ClimbChart lens={lens} at={Math.min(i, last)} k={K} lockAt={leadLayer} />
        {/* the climb's whereabouts, readable WHILE it plays (Aaron's tour
            walk, 2026-07-26) — same corner slot as the sibling instruments */}
        <div className="fl-space-ov fl-space-ctx">
          suiron · sharpens · layer {lens.layers[Math.min(i, last)].layer} /{" "}
          {lens.layers[last].layer}
        </div>
      </div>
      <Stepper i={i} max={last} playing={playing} setI={setI} toggle={toggle} unit="layer" />
    </div>
  );
}
