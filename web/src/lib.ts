import type { AttnEdge, Step } from "./types";

/** display text for a token (empty renders as a middle dot) */
export const esc = (t: string) => (t === "" ? "·" : t);

export function edgesToWeights(edges: AttnEdge[], nPos: number): number[] {
  const w = new Array(nPos).fill(0);
  for (const [p, v] of edges) if (p < nPos) w[p] = v;
  return w;
}

export function meanHeadWeights(step: Step, layer: number, nPos: number): number[] {
  const w = new Array(nPos).fill(0);
  const heads = step.attn[layer] ?? [];
  for (const head of heads)
    for (const [p, v] of head) if (p < nPos) w[p] += v / heads.length;
  return w;
}
