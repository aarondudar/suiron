import { useEffect, useRef, useState } from "react";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Manual playback for the step-by-step demos (the worked dot product + blend,
   the BPE merge stepper, the lens climb). Nothing moves until the play button is
   pressed; then it advances 0 → max on an interval and STOPS at the end (no
   loop). Pressing play again from the end restarts from the start. Any manual
   `setI` (scrub) pauses. Under prefers-reduced-motion it starts on the finished
   state so those users see the result without motion; pressing play still steps
   (user-initiated). Resets to the start when `max` changes (new data). */
export function useAutoplay(max: number, opts?: { stepMs?: number; chunk?: number }) {
  const stepMs = opts?.stepMs ?? 700;
  const chunk = opts?.chunk ?? 1;
  const [i, setRaw] = useState(REDUCED ? max : 0);
  const [playing, setPlaying] = useState(false); // never auto-start

  // reset on new data
  const maxRef = useRef(max);
  useEffect(() => {
    if (maxRef.current === max) return;
    maxRef.current = max;
    setRaw(REDUCED ? max : 0);
    setPlaying(false);
  }, [max]);

  useEffect(() => {
    if (!playing || max <= 0) return;
    const id = setInterval(() => {
      setRaw((prev) => {
        const next = prev + chunk;
        if (next >= max) {
          setPlaying(false); // land on the end and stop — no loop
          return max;
        }
        return next;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, max, stepMs, chunk]);

  return {
    i: Math.min(i, max),
    playing,
    /** manual move — pauses playback */
    setI: (n: number) => {
      setPlaying(false);
      setRaw(Math.max(0, Math.min(max, n)));
    },
    /** play/pause; pressing play from the end restarts from the start */
    toggle: () => {
      if (playing) {
        setPlaying(false);
        return;
      }
      if (i >= max) setRaw(0);
      setPlaying(true);
    },
  };
}
