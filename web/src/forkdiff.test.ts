import { describe, expect, it } from "vitest";
import { shadowTrace } from "./lib";
import type { Trace } from "./types";

/* shadowTrace reassembles the replaced run from the fork's shadow tail:
   live tokens [0, pos) are the shared prefix, fork.tokens/steps are the
   discarded tail from pos on. */

function stub(): Trace {
  return {
    tokens: [
      { id: 1, t: "A" },
      { id: 2, t: "B" },
      { id: 9, t: "forced" },
      { id: 10, t: "new" },
    ],
    steps: [{ top: [] }, { top: [[9, "forced", 0.1]] }, { top: [] }, { top: [] }],
    n_prompt: 2,
    fork: {
      pos: 2,
      prev: "CD",
      n_prompt: 2,
      tokens: [
        { id: 3, t: "C" },
        { id: 4, t: "D" },
      ],
      steps: [{ top: [[4, "D", 0.9]] }, { top: [] }],
    },
  } as unknown as Trace;
}

describe("shadowTrace", () => {
  it("reassembles the replaced run as prefix + tail", () => {
    const s = shadowTrace(stub())!;
    expect(s.tokens.map((t) => t.t)).toEqual(["A", "B", "C", "D"]);
    expect(s.steps).toHaveLength(4);
    expect(s.steps[2].top).toEqual([[4, "D", 0.9]]); // the tail's own recorded step
    expect(s.n_prompt).toBe(2);
    expect(s.fork).toBeUndefined(); // the shadow run is not itself forked
  });

  it("shares the prefix steps with the live run", () => {
    const t = stub();
    const s = shadowTrace(t)!;
    expect(s.steps[1]).toBe(t.steps[1]); // same object: one shared history
  });

  it("is null without a shadow (old engine, demo recording, no fork)", () => {
    const t = stub();
    delete t.fork!.tokens;
    expect(shadowTrace(t)).toBeNull();
    t.fork = undefined;
    expect(shadowTrace(t)).toBeNull();
  });
});
