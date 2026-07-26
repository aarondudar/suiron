import type { Dive } from "./dives";

/* The spine's full path (design-21): each step, then its drawers as SUB-STEPS.
   continue/back/arrows walk this list end to end, so the depth is the default
   path; the dock and the rail remain random access. Pure computation over the
   current phase/drawer — Flow owns the state, this owns the order. */

export interface FlowNav {
  advance: () => void;
  retreat: () => void;
  canContinue: boolean;
  /** ↓ deeper into a drawer, → on to the next step, "" at the path's end */
  continueArrow: string;
  /** rail sub-progress (design-25): the current step's dot fills as continue
   *  walks its drawers */
  subCount: number;
  subFrac: number;
}

export function flowPath(opts: {
  phase: number;
  drawer: string | null;
  hasRun: boolean;
  busy: boolean;
  dives: Dive[];
  divesFor: (p: number) => Dive[];
  goPhase: (n: number) => void;
  setPhase: (n: number) => void;
  setDrawer: (d: string | null) => void;
  /** a fresh drawer open resets its per-open state (knob, pick, layer) */
  onFreshOpen: () => void;
}): FlowNav {
  const { phase, drawer, hasRun, busy, dives, divesFor, goPhase, setPhase, setDrawer, onFreshOpen } =
    opts;

  const path: { phase: number; d: string | null }[] = [];
  for (let p = 1; p <= 5; p++) {
    path.push({ phase: p, d: null });
    for (const dv of divesFor(p)) path.push({ phase: p, d: dv.id });
  }
  // the outro: the epilogue as two drawerless stops, so continue carries the
  // reader past the loop instead of dead-ending at step 5's last drawer
  path.push({ phase: 6, d: null });
  path.push({ phase: 7, d: null });
  const pathIdx = path.findIndex((s) => s.phase === phase && s.d === drawer);
  const applyStop = (s: { phase: number; d: string | null }) => {
    if (s.d && s.d !== drawer) onFreshOpen();
    setPhase(s.phase);
    setDrawer(s.d);
  };
  const advance = () => {
    if (phase === 0) {
      if (hasRun || busy) goPhase(1);
      return;
    }
    if (pathIdx >= 0 && pathIdx + 1 < path.length) applyStop(path[pathIdx + 1]);
  };
  const retreat = () => {
    if (phase === 0) return;
    if (pathIdx > 0) applyStop(path[pathIdx - 1]);
    else goPhase(0);
  };
  const canContinue =
    phase === 0 ? hasRun || busy : pathIdx >= 0 && pathIdx + 1 < path.length;

  const subCount = 1 + dives.length;
  const subPos = drawer ? dives.findIndex((d) => d.id === drawer) + 1 : 0;
  const subFrac = subCount > 0 ? (subPos + 1) / subCount : 1;
  const nextStop = pathIdx >= 0 ? path[pathIdx + 1] : undefined;
  const continueArrow = phase === 0 ? "→" : nextStop ? (nextStop.d ? "↓" : "→") : "";

  return { advance, retreat, canContinue, continueArrow, subCount, subFrac };
}
