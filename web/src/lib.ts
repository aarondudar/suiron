import type { AttnEdge, GenParams, Step, Trace } from './types'

/** display text for a token (empty renders as a middle dot) */
export const esc = (t: string) => (t === '' ? '·' : t)

/** Softmax over logits at temperature t. t<=0 is the limit: all mass on the
 *  argmax (one-hot). Shared by the temperature / top-k / top-p demos, which all
 *  recompute from this token's real logits client-side (no engine call). */
export function softmaxAt(logits: number[], t: number): number[] {
  if (t <= 0) {
    let m = 0
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[m]) m = i
    return logits.map((_, i) => (i === m ? 1 : 0))
  }
  const max = Math.max(...logits)
  const ex = logits.map((l) => Math.exp((l - max) / t))
  const sum = ex.reduce((a, b) => a + b, 0)
  return ex.map((e) => e / sum)
}

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
  backend: 'f32',
}

/** Model's softmax probability for generated token i (from the previous
 *  step's top-10), or null for prompt tokens / unknown. */
export function confidence(trace: Trace, i: number): number | null {
  if (i < trace.n_prompt || i === 0) return null
  const id = trace.tokens[i].id
  const hit = trace.steps[i - 1]?.top?.find(([tid]) => tid === id)
  return hit ? hit[2] : 0.005 // below top-10 → very unsure
}

/** confidence → grayscale (sure = bright ink, unsure = faded). Floored well
 *  above black so even a low-confidence token stays readable — the under-bar
 *  (confBar) carries the precise signal. */
export function confColor(conf: number): string {
  const t = Math.min(1, Math.sqrt(conf) * 1.25)
  const g = Math.round(0x8c + (0xe8 - 0x8c) * t)
  return `rgb(${g},${g},${g})`
}

/** confidence → under-bar width fraction (0..1), same perceptual curve as the
 *  brightness ramp; floored so a generated token always shows a sliver (which
 *  also distinguishes it from a prompt token, which has no bar). */
export function confBar(conf: number): number {
  return Math.max(0.08, Math.min(1, Math.sqrt(conf) * 1.25))
}

/** Aggregate attention from one step over all layers + heads → the top source
 *  positions this token attended to (strongest first). Drops the attention
 *  sink (pos 0) once there's real context, matching the arc rendering. */
export function attnSources(step: Step, pos: number, topN = 6): { pos: number; w: number }[] {
  const weight = new Map<number, number>()
  for (const layer of step.attn)
    for (const head of layer) for (const [p, v] of head) if (p < pos) weight.set(p, (weight.get(p) ?? 0) + v)
  if (pos > 3) weight.delete(0)
  return [...weight.entries()]
    .map(([p, w]) => ({ pos: p, w }))
    .sort((a, b) => b.w - a.w)
    .slice(0, topN)
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

/** One-glance interpretation of a layer's attention pattern. */
export interface Glance {
  topPos: number
  share: number // fraction of recorded attention on the top target
  tag: '' | 'local' | 'focused' | 'broad' | 'sink'
}

export function layerGlance(step: Step, layer: number, nPos: number): Glance | null {
  const w = meanHeadWeights(step, layer, nPos)
  const cur = nPos - 1
  let sum = 0
  let top = 0
  let dist = 0
  for (let p = 0; p < nPos; p++) {
    sum += w[p]
    dist += w[p] * (cur - p)
    if (w[p] > w[top]) top = p
  }
  if (sum <= 0) return null
  const share = w[top] / sum
  const meanDist = dist / sum
  let tag: Glance['tag'] = ''
  if (top === 0 && share > 0.35 && cur > 3) tag = 'sink'
  else if (share > 0.5) tag = 'focused'
  else if (meanDist <= 2.5) tag = 'local'
  else if (share < 0.18) tag = 'broad'
  return { topPos: top, share, tag }
}

/** Per-head top target, for labeling the head grid. */
export function headGlance(edges: AttnEdge[]): { topPos: number; share: number } | null {
  if (!edges.length) return null
  let sum = 0
  let top = edges[0]
  for (const e of edges) {
    sum += e[1]
    if (e[1] > top[1]) top = e
  }
  return sum > 0 ? { topPos: top[0], share: top[1] / sum } : null
}
