import { describe, expect, it } from "vitest";
import { moments } from "./lib";
import type { Lens, Trace } from "./types";

/* A fixed synthetic trace (3 layers, 1 head, 3 tokens A B C, inspecting C at
   pos 2). The numbers are chosen so each moment is deterministic:
   - layer 1 concentrates hardest on an earlier token (B, 80%) → attention lock
   - the top-2 gap is large (0.90 vs 0.05) → "runs away"
   - the lens top-1 first equals the final winner (C) at layer 1 → decision */
const trace = {
  layers: 3,
  tokens: [
    { id: 1, t: "A" },
    { id: 2, t: "B" },
    { id: 3, t: "C" },
  ],
  steps: [
    {},
    {},
    {
      attn: [
        [[[0, 0.1], [1, 0.2], [2, 0.7]]], // layer 0: earlier-token max is B at 0.2
        [[[0, 0.1], [1, 0.8], [2, 0.1]]], // layer 1: earlier-token max is B at 0.8  ← lock
        [[[0, 0.5], [1, 0.3], [2, 0.2]]], // layer 2: earlier-token max is B at 0.3
      ],
      top: [
        [3, "C", 0.9],
        [2, "B", 0.05],
      ],
    },
  ],
} as unknown as Trace;

const lens = {
  pos: 2,
  layers: [
    { layer: 0, top: [[2, "B", 0.4]] },
    { layer: 1, top: [[3, "C", 0.5]] }, // C first leads here
    { layer: 2, top: [[3, "C", 0.9]] }, // final winner = C
  ],
} as unknown as Lens;

describe("moments", () => {
  it("locks attention onto the strongest earlier token's layer", () => {
    const m = moments(trace, 2).find((x) => x.kind === "attention");
    expect(m?.layer).toBe(1);
    expect(m?.label).toContain("“B”");
    expect(m?.label).toContain("80%");
  });

  it("classifies a runaway output", () => {
    const m = moments(trace, 2).find((x) => x.kind === "output");
    expect(m?.label).toContain("runs away");
    expect(m?.label).toContain("“C”");
  });

  it("omits the decision moment without the lens, and finds it with the lens", () => {
    expect(moments(trace, 2).some((x) => x.kind === "decision")).toBe(false);
    const d = moments(trace, 2, lens).find((x) => x.kind === "decision");
    expect(d?.layer).toBe(1); // C first becomes top-1 at layer 1
    expect(d?.label).toContain("takes the lead");
  });

  it("renders no attention moment on the first token", () => {
    expect(moments(trace, 0).some((x) => x.kind === "attention")).toBe(false);
  });
});
