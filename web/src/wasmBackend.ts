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

/* ---- instant demo mode (docs/19) ----
   The page can boot in seconds on a RECORDING of one real run (payloads saved
   from the native lab's own endpoints by `make demo-data`), labeled as such;
   "go live" downloads the model and replays the same canonical prompt on the
   real engine (greedy + fixed seed, so the tokens are identical). Reads that
   weren't recorded reject honestly and raise a page-visible note. */

type Mode = "none" | "demo" | "live";
let mode: Mode = "none";

/** the recorded run's exact parameters — go-live replays them */
const CANON = { prompt: "The capital of France is", n: 1, temp: 0, top_k: 40, top_p: 0.95, seed: 7, chat: false };

let demoTrace: Trace | null = null;

/* The recording does not render on landing: the page boots to an empty lab and
   `playDemo()` replays it from the first token through the same polling path a
   live generation uses (busy while revealing, seq bump per token), so the view
   follows the frontier exactly as if the model were generating. 0 = not
   started. Deep links skip the replay: they point at a moment, not a movie. */
let revealN = 0;
let revealSeq = 0;
let revealTimer: number | undefined;

/** Start the recorded replay (no-op outside demo mode or once started).
 *  Honors prefers-reduced-motion by revealing the whole run at once. */
export function playDemo(): void {
  if (mode !== "demo" || !demoTrace || revealN > 0) return;
  const total = demoTrace.tokens.length;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealN = total;
    revealSeq++;
    return;
  }
  revealN = 1;
  revealSeq++;
  revealTimer = window.setInterval(() => {
    revealN++;
    revealSeq++;
    if (revealN >= total) window.clearInterval(revealTimer);
  }, 280);
}

function demoMiss(): never {
  window.dispatchEvent(new CustomEvent("suiron-demo-miss"));
  throw new Error("not in this recording — go live to compute it");
}

async function demoText(path: string): Promise<string> {
  const r = await fetch(`${BASE}demo/${path}`);
  if (!r.ok) demoMiss();
  return r.text();
}

async function demoJson<T>(path: string): Promise<T> {
  return JSON.parse(await demoText(path)) as T;
}

/** Try the instant demo: present when `make demo-data` populated the build.
 *  Returns false (untouched state) when no recording is shipped. */
export async function bootDemo(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}demo/trace.json`);
    if (!r.ok) return false;
    demoTrace = (await r.json()) as Trace;
    mode = "demo";
    // a deep link lands on its moment directly — no replay gate
    if (window.location.hash.includes("v=1")) revealN = demoTrace.tokens.length;
    return true;
  } catch {
    return false;
  }
}

/** Download the model (once), start the worker, and replay the recorded run
 *  live — same prompt, seed, and sampler, so the tokens match the recording. */
export async function goLive(onProgress: (msg: string, frac: number | null) => void): Promise<void> {
  await boot(onProgress);
  mode = "live";
  await generate(CANON.prompt, { ...CANON, backend: "q8" } as GenParams);
}

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
  mode = "live";
}

// ---- the lab API, same shapes as the HTTP endpoints ----

export async function trace(): Promise<Trace> {
  if (mode === "demo") {
    const t = demoTrace as Trace;
    const seq = (t.seq ?? 0) + revealSeq;
    if (revealN >= t.tokens.length) return { ...t, demo: true, seq };
    // mid-replay: the run up to the reveal frontier, busy like a live run
    return {
      ...t,
      demo: true,
      seq,
      busy: revealN > 0,
      tokens: t.tokens.slice(0, revealN),
      steps: t.steps.slice(0, revealN),
      n_prompt: Math.min(t.n_prompt, revealN),
    };
  }
  return JSON.parse(await rpc<string>("trace", [])) as Trace;
}

export async function generate(prompt: string, p: GenParams): Promise<void> {
  if (mode === "demo") throw new Error("recorded demo — go live to run the model");
  await rpc("generate", [prompt, p.n, p.temp, p.top_k, p.top_p, BigInt(p.seed), p.chat]);
}

export async function step(n: number, p: GenParams): Promise<void> {
  if (mode === "demo") throw new Error("recorded demo — go live to run the model");
  await rpc("step", [n, p.temp, p.top_k, p.top_p, BigInt(p.seed)]);
}

export async function fork(pos: number, token: number, p: GenParams): Promise<void> {
  if (mode === "demo") throw new Error("recorded demo — go live to run the model");
  await rpc("fork", [pos, token, p.n, p.temp, p.top_k, p.top_p, BigInt(p.seed)]);
}

export async function stop(): Promise<void> {
  if (mode === "demo") return;
  await rpc("stop", []);
}

export async function inspect(
  pos: number,
  layer: number,
  head?: number,
  src?: number | null,
): Promise<unknown> {
  if (mode === "demo") {
    if (src != null) demoMiss();
    const f = head === undefined ? `inspect-${pos}-${layer}.json` : `inspect-${pos}-${layer}-h${head}.json`;
    return demoJson(f);
  }
  return JSON.parse(await rpc<string>("inspect", [pos, layer, head ?? -1, src ?? -1]));
}

export async function lens(pos: number, k: number): Promise<Lens> {
  if (mode === "demo") {
    if (k !== 5) demoMiss();
    return demoJson<Lens>(`lens-${pos}.json`);
  }
  return JSON.parse(await rpc<string>("lens", [pos, k])) as Lens;
}

export async function neighbors(id: number, n: number): Promise<Neighbor[]> {
  if (mode === "demo") {
    if (n !== 12) demoMiss();
    return demoJson<Neighbor[]>(`neighbors-${id}.json`);
  }
  return JSON.parse(await rpc<string>("neighbors", [id, n])) as Neighbor[];
}

export async function merges(): Promise<Merges> {
  if (mode === "demo") return demoJson<Merges>("merges.json");
  return JSON.parse(await rpc<string>("merges", [])) as Merges;
}

export async function quantSample(): Promise<QuantSample> {
  if (mode === "demo") return demoJson<QuantSample>("quant-sample.json");
  return JSON.parse(await rpc<string>("quantSample", [])) as QuantSample;
}

export async function source(name: string): Promise<string> {
  if (mode === "demo") return demoText(`source-${name}.txt`);
  return rpc<string>("source", [name]);
}
