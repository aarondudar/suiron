import type { AttnEdge, GenParams, Step, Trace } from './types'

/** display text for a token (empty renders as a middle dot) */
export const esc = (t: string) => (t === '' ? '·' : t)

/** token text in display quotes: q(" the") → “ the” */
export const q = (t: string) => `“${esc(t)}”`

/** Deliberately n=1 (Aaron): the default experience showcases the TRACE of
 *  one deeply-inspectable token, not a stream of greedy text. Use the step
 *  button (or raise n) to continue generation. */
export const DEFAULT_PARAMS: GenParams = {
  n: 1,
  temp: 0,
  top_k: 40,
  top_p: 0.95,
  seed: 7,
  chat: false,
}

/** Model's softmax probability for generated token i (from the previous
 *  step's top-10), or null for prompt tokens / unknown. */
export function confidence(trace: Trace, i: number): number | null {
  if (i < trace.n_prompt || i === 0) return null
  const id = trace.tokens[i].id
  const hit = trace.steps[i - 1]?.top?.find(([tid]) => tid === id)
  return hit ? hit[2] : 0.005 // below top-10 → very unsure
}

/** confidence → grayscale (sure = bright ink, unsure = faded) */
export function confColor(conf: number): string {
  const t = Math.min(1, Math.sqrt(conf) * 1.25)
  const g = Math.round(0x55 + (0xe8 - 0x55) * t)
  return `rgb(${g},${g},${g})`
}

export function edgesToWeights(edges: AttnEdge[], nPos: number): number[] {
  const w = new Array(nPos).fill(0)
  for (const [p, v] of edges) if (p < nPos) w[p] = v
  return w
}

export function meanHeadWeights(step: Step, layer: number, nPos: number): number[] {
  const w = new Array(nPos).fill(0)
  const heads = step.attn[layer] ?? []
  for (const head of heads) for (const [p, v] of head) if (p < nPos) w[p] += v / heads.length
  return w
}
