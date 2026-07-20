import type { Trace } from "./types";

/* Deep links (docs/20): the viewing state lives in the URL hash, so any moment
   in the lab is shareable. The hash captures the RESIDENT run — the prompt as
   its own tokens spell it and the sampler params that actually produced it —
   plus the view (inspected token, open concept, walk stop, open layer).
   Restoring re-runs the prompt (deterministic at a fixed seed) unless the
   resident state already matches, which is also how links into the shipped
   demo recording restore instantly. Chat runs don't write links: the raw text
   cannot be reconstructed honestly from a chat-wrapped resident. */

export interface LinkState {
  p: string;
  n: number;
  temp: number;
  top_k: number;
  top_p: number;
  seed: number;
  cur?: number;
  c?: string;
  walk?: number;
  layer?: number;
  /** which surface the link points into; absent = the expert stack (all
   *  pre-flow links), "flow" = the guided flow */
  view?: "flow";
  /** guided flow only: the step (0–6) and the open drawer id */
  step?: number;
  d?: string;
}

export function encodeLink(s: LinkState): string {
  const q = new URLSearchParams();
  q.set("v", "1");
  q.set("p", s.p);
  q.set("n", String(s.n));
  q.set("t", String(s.temp));
  q.set("k", String(s.top_k));
  q.set("tp", String(s.top_p));
  q.set("s", String(s.seed));
  if (s.cur !== undefined) q.set("cur", String(s.cur));
  if (s.c) q.set("c", s.c);
  if (s.walk !== undefined) q.set("walk", String(s.walk));
  if (s.layer !== undefined && s.layer >= 0) q.set("layer", String(s.layer));
  if (s.view) q.set("view", s.view);
  if (s.step !== undefined) q.set("step", String(s.step));
  if (s.d) q.set("d", s.d);
  return q.toString();
}

/** null when the hash is absent, malformed, or not a v1 link — a normal load. */
export function decodeLink(hash: string): LinkState | null {
  try {
    const q = new URLSearchParams(hash.replace(/^#/, ""));
    if (q.get("v") !== "1") return null;
    const p = q.get("p");
    if (!p) return null;
    const num = (k: string, d: number) => {
      const v = Number(q.get(k));
      return Number.isFinite(v) && q.get(k) !== null ? v : d;
    };
    const opt = (k: string) => (q.get(k) === null ? undefined : num(k, 0));
    return {
      p,
      n: Math.max(1, num("n", 1)),
      temp: num("t", 0),
      top_k: num("k", 40),
      top_p: num("tp", 0.95),
      seed: num("s", 7),
      cur: opt("cur"),
      c: q.get("c") ?? undefined,
      walk: opt("walk"),
      layer: opt("layer"),
      view: q.get("view") === "flow" ? "flow" : undefined,
      step: opt("step"),
      d: q.get("d") ?? undefined,
    };
  } catch {
    return null;
  }
}

/** the resident run's prompt, as its own tokens spell it */
export function residentPrompt(trace: Trace): string {
  return trace.tokens
    .slice(0, trace.n_prompt)
    .map((t) => t.t)
    .join("");
}

/** does the resident trace already embody this link's run? (prompt + the
 *  sampler params recorded in the last generated token's selection) */
export function matchesResident(link: LinkState, trace: Trace): boolean {
  if (trace.tokens.length <= trace.n_prompt) return false;
  if (residentPrompt(trace) !== link.p) return false;
  const sel = trace.steps[trace.tokens.length - 1]?.sel;
  if (!sel) return false;
  return (
    sel.temp === link.temp &&
    sel.top_k === link.top_k &&
    sel.top_p === link.top_p &&
    sel.seed === link.seed
  );
}

/** the link for the current resident run + view; null when not linkable
 *  (no generated tokens yet, or a chat-wrapped resident) */
export function currentLink(
  trace: Trace,
  view: {
    cur: number;
    c: string | null;
    walk: number | null;
    layer: number;
    /** present when the guided flow is the surface being linked */
    flow?: { step: number; d: string | null };
  },
): LinkState | null {
  if (trace.tokens.length <= trace.n_prompt) return null;
  const prompt = residentPrompt(trace);
  if (prompt.startsWith("<|im_start|>")) return null; // chat runs aren't linkable
  const sel = trace.steps[trace.tokens.length - 1]?.sel;
  if (!sel) return null;
  return {
    p: prompt,
    n: trace.tokens.length - trace.n_prompt,
    temp: sel.temp,
    top_k: sel.top_k,
    top_p: sel.top_p,
    seed: sel.seed,
    cur: view.cur,
    c: view.c ?? undefined,
    walk: view.walk ?? undefined,
    layer: view.layer >= 0 ? view.layer : undefined,
    view: view.flow ? "flow" : undefined,
    step: view.flow?.step,
    d: view.flow?.d ?? undefined,
  };
}
