import type { GenParams, Lens, Merges, Neighbor, QuantSample, Trace } from "./types";

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
 *  fires on idle. Neighbors are deterministic for a fixed model, so results are
 *  cached per (id, n) and in-flight requests deduped: the band and the drawer
 *  card asking for the same token share one network call. */
const neighborCache = new Map<string, Promise<Neighbor[]>>();
export function getNeighbors(id: number, n = 12): Promise<Neighbor[]> {
  const key = `${id}:${n}`;
  let p = neighborCache.get(key);
  if (!p) {
    p = fetch(`/api/v1/neighbors?id=${id}&n=${n}`)
      .then((r) => {
        if (!r.ok) throw new Error(`neighbors: ${r.status}`);
        return r.json() as Promise<Neighbor[]>;
      })
      .catch((e) => {
        neighborCache.delete(key); // let a failure be retried
        throw e;
      });
    neighborCache.set(key, p);
  }
  return p;
}

/** Per-layer logit lens for one position. Deterministic while the resident
 *  trace is unchanged (it reads the resident tokens), so results are cached per
 *  (pos, k) and in-flight requests deduped; generate/step/fork clear the cache.
 *  Gated client-side behind opening the lens read/concept — never fires on idle. */
const lensCache = new Map<string, Promise<Lens>>();
export function getLens(pos: number, k = 5): Promise<Lens> {
  const key = `${pos}:${k}`;
  let p = lensCache.get(key);
  if (!p) {
    p = fetch(`/api/v1/lens?pos=${pos}&k=${k}`)
      .then((r) => {
        if (!r.ok) throw new Error(`lens: ${r.status}`);
        return r.json() as Promise<Lens>;
      })
      .catch((e) => {
        lensCache.delete(key); // let a failure be retried
        throw e;
      });
    lensCache.set(key, p);
  }
  return p;
}

/** One deep inspection: the full intermediates for (pos, layer), plus the
 *  worked slices when a head is requested. Every call runs a real forward pass
 *  server-side, so results are cached per (pos, layer, head, src) and in-flight
 *  requests deduped — the demos reading the same pass (the worked dot, the
 *  woven view, the norm, the rope, the unembed) share one call. Valid only
 *  while the resident trace is unchanged; generate/step/fork clear the cache. */
const inspectCache = new Map<string, Promise<unknown>>();
export function getInspect<T>(
  pos: number,
  layer: number,
  head?: number,
  src?: number | null,
): Promise<T> {
  const key = `${pos}:${layer}:${head ?? ""}:${src ?? ""}`;
  let p = inspectCache.get(key);
  if (!p) {
    const hp = head === undefined ? "" : `&head=${head}`;
    const sp = src == null ? "" : `&src=${src}`;
    p = fetch(`/api/v1/inspect?pos=${pos}&layer=${layer}${hp}${sp}`)
      .then((r) => {
        if (!r.ok) throw new Error(`inspect: ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .catch((e) => {
        inspectCache.delete(key); // let a failure be retried
        throw e;
      });
    inspectCache.set(key, p);
  }
  return p as Promise<T>;
}

/** The resident trace is about to change: everything derived from it is stale. */
function invalidateResident(): void {
  lensCache.clear();
  inspectCache.clear();
}

/** The BPE merge trace for the resident prompt. Pure tokenizer work; gated
 *  behind opening the tokenization concept, so it never fires on idle. Not
 *  cached — it follows whatever prompt is currently resident. */
export async function getMerges(): Promise<Merges> {
  const r = await fetch("/api/v1/merges");
  if (!r.ok) throw new Error(`merges: ${r.status}`);
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
  invalidateResident();
  await fetch(`/api/v1/generate?${params(p)}`, { method: "POST", body: prompt });
}

export async function stop(): Promise<void> {
  await fetch("/api/v1/stop", { method: "POST" });
}

/** Advance the model exactly `n` more tokens from the resident state. */
export async function step(n: number, p: GenParams): Promise<void> {
  invalidateResident();
  const q = params({ ...p, n });
  await fetch(`/api/v1/step?${q}`, { method: "POST" });
}

/** Counterfactual: keep tokens [0, pos), force `token` as position pos,
 *  let the model continue from the altered history. */
export async function fork(pos: number, token: number, p: GenParams): Promise<void> {
  invalidateResident();
  const q = params(p);
  q.set("pos", String(pos));
  q.set("token", String(token));
  await fetch(`/api/v1/fork?${q}`, { method: "POST" });
}
