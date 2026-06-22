import { generate } from '../api'
import { ModelOverview } from './ModelOverview'
import type { GenParams, Trace } from '../types'

const SUGGESTIONS = [
  'The cat sat on the',
  'The capital of France is',
  'Once upon a time, in a quiet village,',
  '1 + 1 =',
]

export function EmptyState({
  trace,
  onPick,
  params,
  onGenerate,
}: {
  trace: Trace
  onPick: (p: string) => void
  params: GenParams
  onGenerate: () => void
}) {
  const run = (p: string) => {
    const text = p.trim()
    onPick(text)
    onGenerate()
    void generate(text, params)
  }

  return (
    <section className="empty">
      <div className="empty-jp">suiron</div>

      {/* beat 1 — the one-line hook, graspable on its own */}
      <p className="empty-hook">
        Watch a real language model predict the next token, one step at a time. Every number on the
        page is computed live, not pre-recorded.
      </p>

      {/* the maker hook — built, not wrapped */}
      <p className="empty-maker">
        A from-scratch inference engine in Rust, verified token-for-token against llama.cpp: the
        GGUF parser, tokenizer, attention, and Metal kernels are all hand-written, with no ML
        libraries.
      </p>

      {/* the CTA — high, before the deeper overview */}
      <div className="empty-cta">
        <span className="empty-cta-label">run an example and take the tour</span>
        <div className="empty-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => run(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="empty-hint">or type your own prompt above.</span>
      </div>

      {/* beat 2 — the optional second layer: what a model is, what this one is */}
      <p className="empty-more">
        <ModelOverview trace={trace} />
      </p>
    </section>
  )
}
