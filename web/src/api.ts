import type { GenParams, Trace } from "./types";

// Relative paths: proxied by vite in dev, served by suiron itself in prod.

export async function getTrace(): Promise<Trace> {
  const r = await fetch("/api/v1/trace");
  if (!r.ok) throw new Error(`trace: ${r.status}`);
  return r.json();
}

export async function generate(prompt: string, p: GenParams): Promise<void> {
  const q = new URLSearchParams({
    n: String(p.n),
    temp: String(p.temp),
    top_k: String(p.top_k),
    top_p: String(p.top_p),
    seed: String(p.seed),
    chat: p.chat ? "1" : "0",
  });
  await fetch(`/api/v1/generate?${q}`, { method: "POST", body: prompt });
}

export async function stop(): Promise<void> {
  await fetch("/api/v1/stop", { method: "POST" });
}

/** Advance the model exactly n more tokens from the resident state. */
export async function step(n: number, p: GenParams): Promise<void> {
  const q = new URLSearchParams({
    n: String(n),
    temp: String(p.temp),
    top_k: String(p.top_k),
    top_p: String(p.top_p),
    seed: String(p.seed),
  });
  await fetch(`/api/v1/step?${q}`, { method: "POST" });
}

/** Counterfactual: keep tokens [0, pos), force `token` as position pos,
 *  let the model continue from the altered history. */
export async function fork(pos: number, token: number, p: GenParams): Promise<void> {
  const q = new URLSearchParams({
    pos: String(pos),
    token: String(token),
    n: String(p.n),
    temp: String(p.temp),
    top_k: String(p.top_k),
    top_p: String(p.top_p),
    seed: String(p.seed),
  });
  await fetch(`/api/v1/fork?${q}`, { method: "POST" });
}
