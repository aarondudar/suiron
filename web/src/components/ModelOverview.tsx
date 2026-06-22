import type { Trace } from '../types'

export function ModelOverview({ trace }: { trace: Trace }) {
  return (
    <>
      A language model does one thing: given some text, it assigns every token in its{' '}
      <b>vocabulary</b> a score for how likely that token is to come next, then picks one. The
      vocabulary is the fixed set of <b>151,936</b> tokens this model knows; everything else here is
      how it computes that score well. The model is Qwen3-0.6B: <b>{trace.layers}</b> layers stacked
      in order, <b>{trace.heads}</b> attention heads in <b>{trace.kv_heads}</b> key/value groups,
      each token carried as <b>1,024</b> numbers.
    </>
  )
}
