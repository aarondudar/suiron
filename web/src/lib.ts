import type { AttnEdge, GenParams, Lens, Step, Trace } from './types'

/** display text for a token (empty renders as a middle dot) */
export const esc = (t: string) => (t === '' ? '·' : t)

/** The resident trace's sequence number once generation has settled (-1 while
 *  busy). Deep-inspection effects depend on this so an open drawer refetches
 *  exactly once after a generate/step/fork lands, instead of showing the pass
 *  from before the resident state changed. */
export const settledSeq = (t: Trace): number => (t.busy ? -1 : t.seq ?? 0)

/** True when two token texts are just spellings of the same word (case or
 *  spacing variants, e.g. " France" vs "France"). The meaning views show an
 *  explanatory note when the nearest neighbour is NOT one — the moment the
 *  table visibly files by meaning rather than spelling (e.g. " is" → 是). */
export function sameWordish(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  return norm(a) === norm(b)
}

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

/** Display a token for the geometry labels so whitespace / non-printing
 *  "artifact" tokens stay legible instead of reading as render bugs. Maps the
 *  invisible characters to visible glyphs, and flags only the genuine offenders
 *  — pure whitespace, control/non-printing chars, and long single-symbol runs
 *  (------, ____, ····) — as `literal` for a quiet underline. Ordinary
 *  punctuation (. , ! ?) is NOT flagged: it reads fine and stays plain. */
export function litToken(t: string): { text: string; literal: boolean } {
  if (t === '') return { text: '∅', literal: true }
  const text = t.replace(/ /g, '␣').replace(/\n/g, '↵').replace(/\t/g, '⇥')
  const pureWhitespace = /^\s+$/.test(t)
  // eslint-disable-next-line no-control-regex
  const nonPrinting = /[\x00-\x1f\x7f-\x9f]/.test(t)
  const repeatRun = /^(.)\1{3,}$/.test(t) // same char, 4+ times
  return { text, literal: pureWhitespace || nonPrinting || repeatRun }
}

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
  // the wasm build has exactly one compute path (q8); defaulting to it keeps
  // every backend read on the page (header chip, module 06 highlight) honest
  backend: import.meta.env.VITE_BACKEND === 'wasm' ? 'q8' : 'f32',
}

/** The settings the in-lab chat locks to: the q8 backend, the chat template on,
 *  and conversational sampling. Seed is randomized per message for variety, so
 *  the UI shows it as "random" rather than a fixed number. */
export const CHAT_PARAMS: GenParams = {
  n: 128,
  temp: 0.7,
  top_k: 40,
  top_p: 0.9,
  seed: 7,
  chat: true,
  backend: 'q8',
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

/** Reassemble the replaced run from a fork's shadow tail (docs/22): the
 *  prefix [0, pos) is shared with the live run, so the shadow run is
 *  prefix + tail. Null when the trace has no shadow (old engine, demo
 *  recording, or no fork yet). The result is a plain Trace, so every read
 *  that works on the live run (moments, confidence, …) works on it. */
export function shadowTrace(trace: Trace): Trace | null {
  const f = trace.fork
  if (!f?.tokens || !f.steps) return null
  return {
    ...trace,
    tokens: [...trace.tokens.slice(0, f.pos), ...f.tokens],
    steps: [...trace.steps.slice(0, f.pos), ...f.steps],
    n_prompt: f.n_prompt ?? trace.n_prompt,
    fork: undefined,
  }
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

/** Induction: when the token being read repeats an earlier token, a head may
 *  reach for the token that FOLLOWED the earlier occurrence — copying what came
 *  next last time. Returns the strongest such head, or null when no head puts
 *  at least `bar` of its recorded attention on such a position (an honest
 *  absence: the marker simply does not render). */
export function inductionGlance(
  trace: Trace,
  cur: number,
  bar = 0.3,
): { layer: number; head: number; share: number; tgt: number } | null {
  const step = trace.steps[cur]
  if (!step || cur < 2) return null
  const id = trace.tokens[cur]?.id
  const tgts = new Set<number>()
  for (let p = 0; p + 1 < cur; p++) if (trace.tokens[p].id === id) tgts.add(p + 1)
  if (!tgts.size) return null
  let best: { layer: number; head: number; share: number; tgt: number } | null = null
  for (let l = 0; l < step.attn.length; l++) {
    const heads = step.attn[l]
    for (let h = 0; h < heads.length; h++) {
      let sum = 0
      let hit = 0
      let tgt = -1
      for (const [p, w] of heads[h]) {
        sum += w
        if (tgts.has(p) && w > hit) {
          hit = w
          tgt = p
        }
      }
      if (sum <= 0 || tgt < 0) continue
      const share = hit / sum
      if (!best || share > best.share) best = { layer: l, head: h, share, tgt }
    }
  }
  return best && best.share >= bar ? best : null
}

/** A curated "moment" worth pointing at for this prompt. Every marker cites the
 *  real number that earned it; one that no real value supports does not render. */
export interface Marker {
  kind: 'attention' | 'induction' | 'decision' | 'output'
  /** the layer it points at, when it is a per-layer moment */
  layer?: number
  label: string
}

/** The teacher's finger: 1–4 real moments for the inspected token, derived
 *  purely from the trace (and the lens, when the lens read is open). Pure and
 *  deterministic.
 *  - attention lock: the layer whose mean-head attention concentrates most on
 *    one earlier token (absent on the first token).
 *  - induction: a head reading what followed the previous copy of this token
 *    (absent unless one clears the bar — see inductionGlance).
 *  - decision: the layer where the lens top-1 first becomes the final winner
 *    (absent unless `lens` is provided).
 *  - output: runaway vs near-tie at the end, from the real top-2 gap. */
export function moments(trace: Trace, cur: number, lens?: Lens | null): Marker[] {
  const step = trace.steps[cur]
  if (!step) return []
  const out: Marker[] = []
  const nPos = cur + 1
  const tok = (p: number) => esc(trace.tokens[p]?.t ?? '')

  if (cur > 0) {
    // the layer that concentrates the most attention onto one EARLIER token.
    // Exclude self (the diagonal at `cur`) and the attention sink (pos 0, which
    // means "found nothing") when a content token is available. Share is the
    // real mean-head weight on that token over the row's total.
    const lo = cur > 1 ? 1 : 0 // pos 0 only counts when it is the only earlier token
    let best: { layer: number; pos: number; share: number } | null = null
    for (let l = 0; l < trace.layers; l++) {
      const w = meanHeadWeights(step, l, nPos)
      const sum = w.reduce((a, b) => a + b, 0)
      if (sum <= 0) continue
      let p = -1
      for (let qpos = lo; qpos < cur; qpos++) if (p < 0 || w[qpos] > w[p]) p = qpos
      if (p < 0) continue
      const share = w[p] / sum
      if (best === null || share > best.share) best = { layer: l, pos: p, share }
    }
    if (best && best.share > 0) {
      out.push({
        kind: 'attention',
        layer: best.layer,
        label: `layer ${best.layer} · attention locks onto “${tok(best.pos)}” (${(best.share * 100).toFixed(0)}%)`,
      })
    }
  }

  // induction: pushed after the attention lock so that on a shared layer the
  // more specific marker wins the row
  const ind = inductionGlance(trace, cur)
  if (ind) {
    out.push({
      kind: 'induction',
      layer: ind.layer,
      label: `layer ${ind.layer} · induction: head ${ind.head} re-reads “${tok(ind.tgt)}”, what followed the last “${tok(cur)}” (${(ind.share * 100).toFixed(0)}%)`,
    })
  }

  if (lens && lens.layers.length) {
    const finalWin = lens.layers[lens.layers.length - 1]?.top[0]?.[0]
    const l = finalWin === undefined ? -1 : lens.layers.findIndex((L) => L.top[0]?.[0] === finalWin)
    if (l >= 0) {
      const w = lens.layers[lens.layers.length - 1].top[0]
      out.push({ kind: 'decision', layer: l, label: `layer ${l} · “${esc(w[1])}” takes the lead` })
    }
  }

  const top = step.top ?? []
  if (top.length >= 2) {
    const [, at, ap] = top[0]
    const [, bt, bp] = top[1]
    const gap = ap - bp
    const pct = (p: number) => (p * 100).toFixed(0)
    const label =
      gap > 0.5
        ? `output · “${esc(at)}” runs away (${pct(ap)}%)`
        : gap < 0.08
          ? `output · near-tie: “${esc(at)}” ${pct(ap)}% vs “${esc(bt)}” ${pct(bp)}%`
          : `output · “${esc(at)}” leads (${pct(ap)}%)`
    out.push({ kind: 'output', label })
  } else if (top.length === 1) {
    out.push({ kind: 'output', label: `output · “${esc(top[0][1])}” (${(top[0][2] * 100).toFixed(0)}%)` })
  }

  return out
}
