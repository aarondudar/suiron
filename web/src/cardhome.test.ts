import { describe, expect, it, vi } from "vitest";

/* Every concept must have a host band for its inline card (docs/16) — a new
   concept without a CARD_HOME entry would silently fall back to band 00.
   Explanations (via the demo components it imports) reads window.matchMedia at
   module scope, so stub a minimal window before importing. */
vi.stubGlobal("window", {
  matchMedia: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

const { CARD_HOME, CONCEPTS } = await import("./components/Explanations");

describe("CARD_HOME", () => {
  it("gives every concept a host band", () => {
    for (const id of Object.keys(CONCEPTS)) {
      expect(CARD_HOME[id], `concept "${id}" has no CARD_HOME entry`).toBeDefined();
    }
  });

  it("lists only concepts that exist", () => {
    for (const id of Object.keys(CARD_HOME)) {
      expect(CONCEPTS[id], `CARD_HOME lists unknown concept "${id}"`).toBeDefined();
    }
  });
});
