import { useEffect, useState } from "react";
import { getTrace } from "../../api";
import type { Trace } from "../../types";

/** The flow's trace poll — the same rhythm as the expert stack's (App.tsx).
 *  Re-renders only when the run actually changes (seq or busy), and speeds up
 *  while the model is generating so the running state is never stale. */
export function useTrace(): Trace | null {
  const [trace, setTrace] = useState<Trace | null>(null);
  useEffect(() => {
    let timer: number;
    let dead = false;
    let lastSeq = -2;
    let lastBusy = false;
    const tick = async () => {
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
        timer = window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, []);
  return trace;
}
