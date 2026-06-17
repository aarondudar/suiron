import { generate } from '../api'
import type { GenParams } from '../types'

const SUGGESTIONS = [
  'The cat sat on the',
  'The capital of France is',
  'Once upon a time, in a quiet village,',
  '1 + 1 =',
]

export function EmptyState({ onPick, params }: { onPick: (p: string) => void; params: GenParams }) {
  const run = (p: string) => {
    onPick(p)
    void generate(p, params)
  }

  return (
    <section className="empty">
      <div className="empty-jp">suiron</div>
      <p className="empty-line">
        watch a language model think. type a prompt above, or pick one below, and every number
        you see comes from a real forward pass running on this machine.
      </p>
      <div className="empty-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => run(s)}>
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}
