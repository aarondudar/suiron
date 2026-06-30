import { useEffect, useRef, useState } from "react";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Autoplay for the step-by-step demos (the worked dot product, the BPE merge
   stepper, the lens climb): advance 0 → max on an interval and loop. Pausable,
   and any manual `setI` pauses it (so dragging/stepping takes over). Off under
   prefers-reduced-motion — there it sits on the finished state, no motion.
   Resets to the start when `max` changes (new data / a new read). */
export function useAutoplay(max: number, opts?: { stepMs?: number; chunk?: number }) {
  const stepMs = opts?.stepMs ?? 700;
  const chunk = opts?.chunk ?? 1;
  const [i, setRaw] = useState(REDUCED ? max : 0);
  const [playing, setPlaying] = useState(!REDUCED && max > 0);

  // reset on new data
  const maxRef = useRef(max);
  useEffect(() => {
    if (maxRef.current === max) return;
    maxRef.current = max;
    setRaw(REDUCED ? max : 0);
    setPlaying(!REDUCED && max > 0);
  }, [max]);

  useEffect(() => {
    if (!playing || max <= 0) return;
    const id = setInterval(() => {
      // land exactly on max (dwell one tick), then loop to the start
      setRaw((prev) => (prev >= max ? 0 : Math.min(max, prev + chunk)));
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, max, stepMs, chunk]);

  return {
    i: Math.min(i, max),
    playing,
    /** manual move — pauses autoplay */
    setI: (n: number) => {
      setPlaying(false);
      setRaw(Math.max(0, Math.min(max, n)));
    },
    toggle: () => setPlaying((p) => !p),
  };
}
