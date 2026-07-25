import { useEffect, useRef, useState } from "react";
import { getTrace } from "../../api";
import type { Trace } from "../../types";

/** The flow's trace poll — the same rhythm as the expert stack's (App.tsx).
 *  Re-renders only when the run actually changes (seq or busy), and speeds up
 *  while the model is generating so the running state is never stale.
 *
 *  `refresh()` polls immediately: actions that start a run call it so the UI
 *  reflects the new run in one round-trip instead of waiting out the idle
 *  interval (the first-begin flicker fix). */
export function useTrace(): { trace: Trace | null; refresh: () => void } {
  const [trace, setTrace] = useState<Trace | null>(null);
  const bump = useRef<() => void>(() => {});
  useEffect(() => {
    let timer: number;
    let dead = false;
    let inflight = false;
    let lastSeq = -2;
    let lastBusy = false;
    const tick = async () => {
      if (inflight) return; // one chain — a refresh during a fetch just waits
      inflight = true;
      try {
        const t = await getTrace();
        if (dead) return;
        if (t.seq !== lastSeq || !!t.busy !== lastBusy) {
          lastSeq = t.seq ?? -1;
          lastBusy = !!t.busy;
          setTrace(t);
        }
        timer = window.setTimeout(tick, t.busy ? 250 : 1200);
      } catch {
        if (!dead) timer = window.setTimeout(tick, 2000);
      } finally {
        inflight = false;
      }
    };
    bump.current = () => {
      window.clearTimeout(timer);
      void tick();
    };
    void tick();
    return () => {
      dead = true;
      window.clearTimeout(timer);
      bump.current = () => {};
    };
  }, []);
  return { trace, refresh: () => bump.current() };
}
