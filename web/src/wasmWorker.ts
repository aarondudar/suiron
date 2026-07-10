/* The suiron-wasm host, off the main thread (docs/18). The page fetches/caches
   the model and transfers the bytes here; this worker imports the wasm module,
   loads the model lean, runs the pump loop (each ~300 ms token of engine work
   blocks only this thread), and answers RPCs with the same JSON strings the
   native server emits. Message shape: {id, method, args} → {id, result|error}. */

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

interface RpcMsg {
  id: number;
  method: string;
  args: unknown[];
}

const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent<RpcMsg>) => void) | null;
};

let mod: SuironWasm | null = null;

function w(): SuironWasm {
  if (!mod) throw new Error("suiron-wasm not booted in the worker");
  return mod;
}

// one token of engine work per macrotask; blocks only this worker, and yields
// between tokens so stop()/reads land in the gaps
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

async function handle(method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case "boot": {
      const [url, buf] = args as [string, ArrayBuffer];
      const m = (await import(/* @vite-ignore */ url)) as SuironWasm;
      await m.default();
      m.load_model(new Uint8Array(buf));
      mod = m;
      return null;
    }
    case "generate": {
      const [prompt, n, temp, top_k, top_p, seed, chat] = args as [
        string,
        number,
        number,
        number,
        number,
        bigint,
        boolean,
      ];
      w().start_generate(prompt, n, temp, top_k, top_p, seed, chat);
      drive();
      return null;
    }
    case "step": {
      const [n, temp, top_k, top_p, seed] = args as [number, number, number, number, bigint];
      w().step_more(n, temp, top_k, top_p, seed);
      drive();
      return null;
    }
    case "fork": {
      const [pos, token, n, temp, top_k, top_p, seed] = args as [
        number,
        number,
        number,
        number,
        number,
        number,
        bigint,
      ];
      w().fork_to(pos, token, n, temp, top_k, top_p, seed);
      drive();
      return null;
    }
    case "stop":
      w().stop();
      return null;
    case "trace":
      return w().trace_json();
    case "inspect": {
      const [pos, layer, head, src] = args as [number, number, number, number];
      return w().inspect_json(pos, layer, head, src);
    }
    case "lens": {
      const [pos, k] = args as [number, number];
      return w().lens_json(pos, k);
    }
    case "neighbors": {
      const [id, n] = args as [number, number];
      return w().neighbors_json(id, n);
    }
    case "merges":
      return w().merges_json();
    case "quantSample":
      return w().quant_sample_json();
    case "source": {
      const [name] = args as [string];
      return w().source_text(name) ?? "// source unavailable";
    }
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

ctx.onmessage = (e) => {
  const { id, method, args } = e.data;
  void handle(method, args)
    .then((result) => ctx.postMessage({ id, result }))
    .catch((err: unknown) => ctx.postMessage({ id, error: String(err) }));
};
