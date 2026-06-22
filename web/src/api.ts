import type { GenParams, Neighbor, QuantSample, Trace } from "./types";

// Relative paths: proxied by vite in dev, served by suiron itself in prod.

export async function getTrace(): Promise<Trace> {
  const r = await fetch("/api/v1/trace");
  if (!r.ok) throw new Error(`trace: ${r.status}`);
  return r.json();
}

export async function getQuantSample(): Promise<QuantSample> {
  const r = await fetch("/api/v1/quant-sample");
  if (!r.ok) throw new Error(`quant-sample: ${r.status}`);
  return r.json();
}

/** Top-n cosine neighbors of a token over the embedding matrix. A pure model
 *  read — gated client-side behind the geometry "meaning" read so it never
 *  fires on idle. */
export async function getNeighbors(id: number, n = 12): Promise<Neighbor[]> {
  const r = await fetch(`/api/v1/neighbors?id=${id}&n=${n}`);
  if (!r.ok) throw new Error(`neighbors: ${r.status}`);
  return r.json();
}

function params(p: GenParams): URLSearchParams {
  return new URLSearchParams({
    n: String(p.n),
    temp: String(p.temp),
    top_k: String(p.top_k),
    top_p: String(p.top_p),
    seed: String(p.seed),
    chat: p.chat ? "1" : "0",
    backend: p.backend,
  });
}

export async function generate(prompt: string, p: GenParams): Promise<void> {
  await fetch(`/api/v1/generate?${params(p)}`, { method: "POST", body: prompt });
}

export async function stop(): Promise<void> {
  await fetch("/api/v1/stop", { method: "POST" });
}

/** Advance the model exactly `n` more tokens from the resident state. */
export async function step(n: number, p: GenParams): Promise<void> {
  const q = params({ ...p, n });
  await fetch(`/api/v1/step?${q}`, { method: "POST" });
}

/** Counterfactual: keep tokens [0, pos), force `token` as position pos,
 *  let the model continue from the altered history. */
export async function fork(pos: number, token: number, p: GenParams): Promise<void> {
  const q = params(p);
  q.set("pos", String(pos));
  q.set("token", String(token));
  await fetch(`/api/v1/fork?${q}`, { method: "POST" });
}
