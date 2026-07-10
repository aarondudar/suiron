import { EXPERIMENTS, type Experiment } from '../experiments'

export function EmptyState({ onRun }: { onRun: (e: Experiment) => void }) {
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

      {/* the CTA — a gallery of experiments, each a phenomenon worth watching */}
      <div className="empty-cta">
        <span className="empty-cta-label">run an experiment and take the tour</span>
        <div className="exp-grid">
          {EXPERIMENTS.map((e) => (
            <button key={e.id} className="exp-card" onClick={() => onRun(e)}>
              <span className="exp-title">{e.title}</span>
              <span className="exp-hook">{e.hook}</span>
              <span className="exp-prompt">“{e.prompt}”</span>
            </button>
          ))}
        </div>
        <span className="empty-hint">or type your own prompt above.</span>
      </div>
    </section>
  )
}
