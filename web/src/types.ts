// Mirrors the trace JSON (format v1) emitted by crates/suiron-cli/src/trace.rs.

export interface Tok {
  id: number;
  t: string;
}

export interface Cand {
  id: number;
  t: string;
  logit: number;
  /** softmax probability at temperature among top-k survivors (0 if cut) */
  p: number;
  /** renormalized probability after the top-p cut (0 if cut) */
  pf: number;
  /** which stage eliminated it: "top-k" | "top-p" | "" */
  cut: string;
}

export interface Sel {
  temp: number;
  top_k: number;
  top_p: number;
  seed: number;
  /** uniform draw in [0,1); null for greedy */
  r: number | null;
  chosen: number;
  /** true when a human forced this token via fork */
  forced: boolean;
  cand: Cand[];
}

/** [position, weight] attention edge */
export type AttnEdge = [number, number];

export interface Step {
  /** [layer][head] -> top-k attention edges */
  attn: AttnEdge[][][];
  /** residual stream RMS after each layer */
  rnorm: number[];
  /** [id, text, prob] top next-token predictions */
  top: [number, string, number][];
  /** how this token was selected (absent for prompt tokens) */
  sel?: Sel;
}

export interface Trace {
  v: number;
  model: string;
  quant: string;
  layers: number;
  heads: number;
  kv_heads: number;
  head_dim: number;
  n_prompt: number;
  live?: boolean;
  busy?: boolean;
  seq?: number;
  /** backend the most recent run used */
  backend?: Backend;
  /** last measured decode tok/s per backend (null until each has run) */
  tps?: { f32: number | null; q8: number | null };
  /** present after a counterfactual fork (docs/22): where it happened and the
   *  replaced run's discarded tail (tokens + steps from `pos` on; the prefix
   *  [0, pos) is shared with the live run). One level deep: the next fork
   *  replaces it, the next generate clears it. */
  fork?: { pos: number; prev: string; n_prompt?: number; tokens?: Tok[]; steps?: Step[] };
  /** client-side only: this trace is the shipped recording, not a live engine */
  demo?: boolean;
  tokens: Tok[];
  steps: Step[];
}

export type Backend = "f32" | "q8";

export interface GenParams {
  n: number;
  temp: number;
  top_k: number;
  top_p: number;
  seed: number;
  chat: boolean;
  backend: Backend;
}

/** a vocabulary entry near a query vector by cosine similarity, from
 *  /api/v1/neighbors. cos is the real (a·b)/(|a||b|); a token vs itself is 1. */
export interface Neighbor {
  id: number;
  token: string;
  cos: number;
}

/** The full head_dim-length query and key behind one attention score, returned
 *  by /api/v1/inspect when a head (and optional src) is requested. The two real
 *  vectors the worked dot-product demo steps through; their dot product scaled
 *  by 1/√head_dim equals heads[head].scores[src]. */
export interface WorkedDot {
  head: number;
  src: number;
  q: number[];
  k: number[];
  /** this head's value vector for each source position (for the blend) */
  v: number[][];
  /** the engine's recorded head context = Σ_p weight[p]·v[p] */
  ctx: number[];
  /** this head's query before RoPE (post-norm); `q` is the same after rotation */
  q_pre: number[];
  /** per-pair rotation angles RoPE applies at this position (head_dim/2 of them) */
  angles: number[];
}

/** Per-layer logit lens for one position (from /api/v1/lens): what the model
 *  would predict if it stopped at each layer. `top` mirrors Step.top —
 *  [id, token, prob]. The final layer equals the real next-token logits. */
export interface LensLayer {
  layer: number;
  top: [number, string, number][];
}
export interface Lens {
  pos: number;
  layers: LensLayer[];
}

/** The BPE merge trace for one input (from /api/v1/merges), per pre-token: the
 *  byte-level start, the merges applied in rank order (each with the resulting
 *  piece list), and the final token ids. The flattened ids equal the trace's
 *  prompt tokens. */
export interface MergeStep {
  left: string;
  right: string;
  rank: number;
  result: string[];
}
export interface Pretoken {
  start: string[];
  steps: MergeStep[];
  tokens: number[];
}
export interface Merges {
  pretokens: Pretoken[];
}

/** A worked RMSNorm slice (from /api/v1/inspect): the first components of the
 *  pre-norm vector, the exact rms divisor, the norm weight, and the resulting
 *  post-norm values — so the web can show x → x/rms → ·weight and check it. */
export interface WorkedNorm {
  pre: number[];
  post: number[];
  weight: number[];
  rms: number;
  len: number;
}

/** The worked unembed (from /api/v1/inspect at the final stage): the final
 *  normalized vector, and for the top candidates each one's row in the tied
 *  embedding table with the dot product that is its logit. */
export interface UnembedCand {
  id: number;
  row: number[];
  logit: number;
  prob: number;
}
export interface WorkedUnembed {
  x: number[];
  len: number;
  cands: UnembedCand[];
}

/** one real Q8_0 block from the model, for the quantization explainer */
export interface QuantSample {
  tensor: string;
  scale: number;
  quants: number[];
  values: number[];
}

/** What the lab is currently lighting up. A superset of B1's original two foci
 *  (a logit candidate, a layer row) plus a token and a registered DOM anchor.
 *  Written from three sources, resolved by priority in App: a transient hover,
 *  a programmatic writer (reserved for the band-05 stepper), and the open
 *  Explainer concept's sticky highlight. `el` points at any element carrying a
 *  matching `data-explain-el` attribute, so new anchors are just markup. */
export type FocusTarget =
  | { kind: "none" }
  | { kind: "token"; pos: number } // a token + its attention sources
  | { kind: "candidate"; id: number } // a logit candidate's occurrences
  | { kind: "layer"; layer: number } // a layer row + its arcs
  | { kind: "el"; ref: string }; // a registered anchor (a control, a bar, a dot row)
