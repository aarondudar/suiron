import type { GenParams, Lens, Merges, Neighbor, QuantSample, Trace } from "./types";

/* The in-browser backend (docs/07 + 18): the same lab API shapes, produced by
   the suiron-wasm module — which lives in a Web Worker, so the page never
   blocks while the engine works. This file is the page side: it downloads the
   model once (with progress) into IndexedDB, transfers the bytes to the worker
   (zero-copy), and exposes thin async RPCs whose results are the very JSON the
   native server would have sent.

   Only active when the build was made with VITE_BACKEND=wasm. The wasm module
   + binary live under {BASE_URL}wasm/ (copied by `make static`) and are
   imported at runtime INSIDE the worker, so dev builds and CI never need the
   artifacts to exist. */

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

// ---- the worker RPC ----

interface Settle {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Settle>();

function rpc<T>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!worker) {
      reject(new Error("suiron-wasm not booted"));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, method, args }, transfer);
  });
}

/** Download (or read back) the model, start the worker, hand it the bytes.
 *  Resolves when the lab is ready to serve. */
export async function boot(onProgress: (msg: string, frac: number | null) => void): Promise<void> {
  if (worker) return;

  let blob = await idbGet(MODEL_URL);
  if (blob) {
    onProgress("model found in your browser's cache…", null);
  } else {
    blob = await fetchModel(onProgress);
    onProgress("caching the model for next time…", null);
    await idbPut(MODEL_URL, blob);
  }

  onProgress("starting the engine (in a worker, off this thread)…", null);
  const w = new Worker(new URL("./wasmWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const settle = pending.get(e.data.id);
    if (!settle) return;
    pending.delete(e.data.id);
    if (e.data.error !== undefined) settle.reject(new Error(e.data.error));
    else settle.resolve(e.data.result);
  };
  w.onerror = (e) => {
    for (const [, s] of pending) s.reject(new Error(e.message || "worker error"));
    pending.clear();
  };
  worker = w;

  onProgress("loading the weights (quantized-resident)…", null);
  const buf = await blob.arrayBuffer();
  const wasmJsUrl = new URL(`${BASE}wasm/suiron_wasm.js`, location.href).href;
  try {
    await rpc<null>("boot", [wasmJsUrl, buf], [buf]); // transferred, zero-copy
  } catch (e) {
    worker.terminate();
    worker = null;
    throw e;
  }
}

// ---- the lab API, same shapes as the HTTP endpoints ----

export async function trace(): Promise<Trace> {
  return JSON.parse(await rpc<string>("trace", [])) as Trace;
}

export async function generate(prompt: string, p: GenParams): Promise<void> {
  await rpc("generate", [prompt, p.n, p.temp, p.top_k, p.top_p, BigInt(p.seed), p.chat]);
}

export async function step(n: number, p: GenParams): Promise<void> {
  await rpc("step", [n, p.temp, p.top_k, p.top_p, BigInt(p.seed)]);
}

export async function fork(pos: number, token: number, p: GenParams): Promise<void> {
  await rpc("fork", [pos, token, p.n, p.temp, p.top_k, p.top_p, BigInt(p.seed)]);
}

export async function stop(): Promise<void> {
  await rpc("stop", []);
}

export async function inspect(
  pos: number,
  layer: number,
  head?: number,
  src?: number | null,
): Promise<unknown> {
  return JSON.parse(await rpc<string>("inspect", [pos, layer, head ?? -1, src ?? -1]));
}

export async function lens(pos: number, k: number): Promise<Lens> {
  return JSON.parse(await rpc<string>("lens", [pos, k])) as Lens;
}

export async function neighbors(id: number, n: number): Promise<Neighbor[]> {
  return JSON.parse(await rpc<string>("neighbors", [id, n])) as Neighbor[];
}

export async function merges(): Promise<Merges> {
  return JSON.parse(await rpc<string>("merges", [])) as Merges;
}

export async function quantSample(): Promise<QuantSample> {
  return JSON.parse(await rpc<string>("quantSample", [])) as QuantSample;
}

export async function source(name: string): Promise<string> {
  return rpc<string>("source", [name]);
}
