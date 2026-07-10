import { describe, expect, it } from "vitest";
import { inductionGlance } from "./lib";
import type { AttnEdge, Trace } from "./types";

/* Synthetic attention for the induction detector: tokens A B C A B, inspected
   at the second B (pos 4). Its earlier copy is pos 1, so the induction target
   is pos 2 (the C that followed it). */

function stub(attn: AttnEdge[][][]): Trace {
  const ids = [10, 20, 30, 10, 20]; // A B C A B
  return {
    tokens: ids.map((id, i) => ({ id, t: `t${i}` })),
    steps: [...ids.slice(0, 4).map(() => ({})), { attn }],
  } as unknown as Trace;
}

const CUR = 4;
const TGT = 2;

describe("inductionGlance", () => {
  it("finds the head that reads what followed the previous copy", () => {
    // layer 0 head 0: diffuse. layer 1 head 1: 80% of its weight on the target.
    const attn: AttnEdge[][][] = [
      [
        [
          [0, 0.3],
          [1, 0.3],
          [3, 0.4],
        ],
      ],
      [
        [[3, 1.0]],
        [
          [TGT, 0.8],
          [0, 0.2],
        ],
      ],
    ];
    const hit = inductionGlance(stub(attn), CUR);
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ layer: 1, head: 1, tgt: TGT });
    expect(hit!.share).toBeCloseTo(0.8);
  });

  it("stays silent when no head clears the bar", () => {
    const attn: AttnEdge[][][] = [
      [
        [
          [TGT, 0.2],
          [0, 0.5],
          [3, 0.3],
        ],
      ],
    ];
    expect(inductionGlance(stub(attn), CUR)).toBeNull();
  });

  it("stays silent when the token has no earlier copy", () => {
    const attn: AttnEdge[][][] = [[[[TGT, 1.0]]]];
    const t = stub(attn);
    t.tokens[CUR] = { id: 99, t: "unique" }; // no repeat anywhere
    expect(inductionGlance(t, CUR)).toBeNull();
  });

  it("only counts positions AFTER an earlier copy, not the copy itself", () => {
    // all weight on pos 1 (the earlier B itself) — that is plain attention,
    // not induction
    const attn: AttnEdge[][][] = [[[[1, 1.0]]]];
    expect(inductionGlance(stub(attn), CUR)).toBeNull();
  });
});
