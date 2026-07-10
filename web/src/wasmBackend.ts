import type { GenParams, Lens, Merges, Neighbor, QuantSample, Trace } from "./types";

/* The in-browser backend (docs/07): the same lab API shapes, produced by the
   suiron-wasm module in-process instead of over HTTP — the JSON comes from the
   very same Rust serializers the native server uses, so the app cannot tell
   the difference. Only active when the build was made with VITE_BACKEND=wasm.

   The module + .wasm live under {BASE_URL}wasm/ (copied from
   crates/suiron-wasm/pkg by `make static`) and are imported at RUNTIME, so dev
   builds and CI never need the wasm artifacts to exist.

   The model file (~640 MB, Q8_0) downloads once with progress and is cached in
   IndexedDB; the engine loads it lean (quantized-resident), so it occupies
   about its file size in memory rather than the ~2.4 GB a full f32
   materialization would take.

   Generation is pump-driven: one token of engine work per macrotask, so the UI
   thread breathes between tokens and stop() lands. */

interface SuironWasm {
  default: (input?: unknown) => Promise<unknown>;
  load_model: (bytes: Uint8Array) => void;
  start_generate: (
    prompt: string,
    n: number,
    temp: number,
    top_k: number,
    top_p: number,
    seed: bigint,
    chat: boolean,
  ) => void;
  step_more: (n: number, temp: number, top_k: number, top_p: number, seed: bigint) => void;
  fork_to: (
    pos: number,
    token: number,
    n: number,
    temp: number,
    top_k: number,
    top_p: number,
    seed: bigint,
  ) => void;
  pump: () => boolean;
  stop: () => void;
  trace_json: () => string;
  inspect_json: (pos: number, layer: number, head: number, src: number) => string;
  lens_json: (pos: number, k: number) => string;
  neighbors_json: (id: number, n: number) => string;
  merges_json: () => string;
  quant_sample_json: () => string;
  source_text: (name: string) => string | undefined;
}

let mod: SuironWasm | null = null;

const BASE = import.meta.env.BASE_URL as string;
const MODEL_URL = (import.meta.env.VITE_MODEL_URL as string | undefined) ?? `${BASE}model.gguf`;

// ---- the model store: IndexedDB, keyed by URL, so a revisit skips the download ----

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("suiron", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("models");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Blob | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const req = db.transaction("models").objectStore("models").get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null; // private mode etc. — just re-download
  }
}

async function idbPut(key: string, value: Blob): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // cache miss next visit; not fatal
    });
  } catch {
    /* not fatal */
  }
}

async function fetchModel(onProgress: (msg: string, frac: number | null) => void): Promise<Blob> {
  const r = await fetch(MODEL_URL);
  if (!r.ok || !r.body) throw new Error(`model download failed: ${r.status}`);
  const total = Number(r.headers.get("Content-Length") ?? 0);
  const reader = r.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onProgress(
      `downloading the model · ${(got / 1e6).toFixed(0)} MB${total ? ` of ${(total / 1e6).toFixed(0)}` : ""}`,
      total ? got / total : null,
    );
  }
  return new Blob(chunks);
}

/** Download (or read back) the model, load the wasm module, load the model
 *  lean. Resolves when the lab is ready to serve. */
export async function boot(onProgress: (msg: string, frac: number | null) => void): Promise<void> {
  if (mod) return;
  onProgress("loading the engine…", null);
  const m = (await import(/* @vite-ignore */ `${BASE}wasm/suiron_wasm.js`)) as SuironWasm;
  await m.default();

  let blob = await idbGet(MODEL_URL);
  if (blob) {
    onProgress("model found in your browser's cache…", null);
  } else {
    blob = await fetchModel(onProgress);
    onProgress("caching the model for next time…", null);
    await idbPut(MODEL_URL, blob);
  }

  onProgress("loading the weights (quantized-resident)…", null);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  m.load_model(bytes);
  mod = m;
}

function w(): SuironWasm {
  if (!mod) throw new Error("suiron-wasm not booted");
  return mod;
}

// ---- the pump: one token of engine work per macrotask ----

let driving = false;
function drive(): void {
  if (driving) return;
  driving = true;
  const tick = () => {
    let more = false;
    try {
      more = w().pump();
    } catch {
      more = false;
    }
    if (more) setTimeout(tick, 0);
    else driving = false;
  };
  setTimeout(tick, 0);
}

// ---- the lab API, same shapes as the HTTP endpoints ----

export function trace(): Trace {
  return JSON.parse(w().trace_json()) as Trace;
}

export function generate(prompt: string, p: GenParams): void {
  w().start_generate(prompt, p.n, p.temp, p.top_k, p.top_p, BigInt(p.seed), p.chat);
  drive();
}

export function step(n: number, p: GenParams): void {
  w().step_more(n, p.temp, p.top_k, p.top_p, BigInt(p.seed));
  drive();
}

export function fork(pos: number, token: number, p: GenParams): void {
  w().fork_to(pos, token, p.n, p.temp, p.top_k, p.top_p, BigInt(p.seed));
  drive();
}

export function stop(): void {
  w().stop();
}

export function inspect(pos: number, layer: number, head?: number, src?: number | null): unknown {
  return JSON.parse(w().inspect_json(pos, layer, head ?? -1, src ?? -1));
}

export function lens(pos: number, k: number): Lens {
  return JSON.parse(w().lens_json(pos, k)) as Lens;
}

export function neighbors(id: number, n: number): Neighbor[] {
  return JSON.parse(w().neighbors_json(id, n)) as Neighbor[];
}

export function merges(): Merges {
  return JSON.parse(w().merges_json()) as Merges;
}

export function quantSample(): QuantSample {
  return JSON.parse(w().quant_sample_json()) as QuantSample;
}

export function source(name: string): string {
  return w().source_text(name) ?? "// source unavailable";
}
