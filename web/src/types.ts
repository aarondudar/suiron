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
  n_prompt: number;
  live?: boolean;
  busy?: boolean;
  seq?: number;
  /** present after a counterfactual fork: where, and the discarded tail */
  fork?: { pos: number; prev: string };
  tokens: Tok[];
  steps: Step[];
}

export interface GenParams {
  n: number;
  temp: number;
  top_k: number;
  top_p: number;
  seed: number;
  chat: boolean;
}
