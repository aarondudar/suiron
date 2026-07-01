/* A minimal shared control for anything driven by useAutoplay: a play/pause
   toggle, a draggable scrubber bound to `i`, and an `i / max` readout. Dragging
   calls setI (which pauses autoplay). Replaces the old 5-button steppers — ◀ / ▶
   / to-end / reset are all covered by autoplay looping the range plus the
   scrubber. Reduced-motion is handled inside useAutoplay (no motion; the
   scrubber still works). */
export function Stepper({
  i,
  max,
  playing,
  setI,
  toggle,
  unit = "step",
}: {
  i: number;
  max: number;
  playing: boolean;
  setI: (n: number) => void;
  toggle: () => void;
  unit?: string;
}) {
  const at = Math.min(i, max);
  return (
    <div className="stepper">
      <button className="stepper-play" onClick={toggle} aria-label={playing ? "pause" : "play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        className="stepper-range"
        type="range"
        min={0}
        max={Math.max(1, max)}
        value={at}
        onChange={(e) => setI(+e.target.value)}
        aria-label={unit}
      />
      <span className="stepper-where">
        {unit} <b>{at}</b> / {max}
      </span>
    </div>
  );
}
