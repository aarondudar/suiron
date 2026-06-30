import { generate } from '../api'
import type { GenParams } from '../types'

const SUGGESTIONS = [
  'The cat sat on the',
  'The capital of France is',
  'Once upon a time, in a quiet village,',
  '1 + 1 =',
]

export function EmptyState({
  onPick,
  params,
  onGenerate,
}: {
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
    </section>
  )
}
