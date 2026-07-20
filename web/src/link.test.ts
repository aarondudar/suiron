import { describe, expect, it } from "vitest";
import { currentLink, decodeLink, encodeLink, matchesResident, residentPrompt } from "./link";
import type { Trace } from "./types";

const LINK = {
  p: "The capital of France is",
  n: 1,
  temp: 0,
  top_k: 40,
  top_p: 0.95,
  seed: 7,
  cur: 5,
  c: "attention",
  walk: 4,
  layer: 19,
};

/** the smallest trace shape the link helpers read */
function stubTrace(): Trace {
  const toks = ["The", " capital", " of", " France", " is", " Paris"];
  return {
    tokens: toks.map((t, i) => ({ id: i, t })),
    n_prompt: 5,
    steps: [
      ...toks.slice(0, 5).map(() => ({})),
      { sel: { temp: 0, top_k: 40, top_p: 0.95, seed: 7 } },
    ],
  } as unknown as Trace;
}

describe("deep links", () => {
  it("round-trips through the hash", () => {
    expect(decodeLink("#" + encodeLink(LINK))).toEqual(LINK);
  });

  it("round-trips the flow fields (design-10)", () => {
    const flow = { ...LINK, c: undefined, walk: undefined, layer: undefined, view: "flow" as const, step: 3, d: "dot" };
    const back = decodeLink("#" + encodeLink(flow));
    expect(back).toMatchObject({ view: "flow", step: 3, d: "dot", cur: 5, p: LINK.p });
  });

  it("pre-flow links carry no view field", () => {
    expect(decodeLink("#" + encodeLink(LINK))?.view).toBeUndefined();
  });

  it("round-trips without the optional view fields", () => {
    const bare = { p: "hello world", n: 3, temp: 0.8, top_k: 40, top_p: 0.95, seed: 42 };
    const back = decodeLink(encodeLink(bare));
    expect(back).toMatchObject(bare);
    expect(back?.cur).toBeUndefined();
    expect(back?.walk).toBeUndefined();
  });

  it("treats absent, malformed, and foreign hashes as a normal load", () => {
    expect(decodeLink("")).toBeNull();
    expect(decodeLink("#")).toBeNull();
    expect(decodeLink("#v=1")).toBeNull(); // no prompt
    expect(decodeLink("#v=2&p=x")).toBeNull(); // unknown version
    expect(decodeLink("#some-anchor")).toBeNull();
  });

  it("matches the resident run by prompt + recorded sampler params", () => {
    const t = stubTrace();
    expect(residentPrompt(t)).toBe("The capital of France is");
    expect(matchesResident(LINK, t)).toBe(true);
    expect(matchesResident({ ...LINK, p: "other prompt" }, t)).toBe(false);
    expect(matchesResident({ ...LINK, seed: 8 }, t)).toBe(false);
  });

  it("builds the current link from the resident run, not the input box", () => {
    const l = currentLink(stubTrace(), { cur: 5, c: "attention", walk: null, layer: -1 });
    expect(l).toMatchObject({ p: "The capital of France is", n: 1, seed: 7, cur: 5 });
    expect(l?.walk).toBeUndefined();
    expect(l?.layer).toBeUndefined();
  });

  it("refuses to link chat-wrapped runs", () => {
    const t = stubTrace();
    t.tokens[0] = { id: 0, t: "<|im_start|>" } as Trace["tokens"][number];
    expect(currentLink(t, { cur: 5, c: null, walk: null, layer: -1 })).toBeNull();
  });
});
