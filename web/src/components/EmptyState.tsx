import { EXPERIMENTS, type Experiment } from '../experiments'

export function EmptyState({
  onRun,
  demo,
  onPlayDemo,
}: {
  onRun: (e: Experiment) => void
  /** the page booted on the shipped recording (docs/19): offer the replay as
   *  the obvious first step; the experiment cards route to go-live instead */
  demo?: boolean
  onPlayDemo?: () => void
}) {
  return (
    <section className="empty">
      <div className="empty-jp">suiron</div>

      {/* beat 1 — the one-line hook, graspable on its own. The live claim must
          stay honest: on the demo boot the numbers are one real recorded run
          until the visitor goes live. */}
      <p className="empty-hook">
        {demo
          ? 'Watch a real language model predict the next token, one step at a time. Every number is from one real run; go live and your browser computes them itself.'
          : 'Watch a real language model predict the next token, one step at a time. Every number on the page is computed live, not pre-recorded.'}
      </p>

      {/* the maker hook — built, not wrapped */}
      <p className="empty-maker">
        A from-scratch inference engine in Rust, verified token-for-token against llama.cpp: the
        GGUF parser, tokenizer, attention, and Metal kernels are all hand-written, with no ML
        libraries.
      </p>

      {/* demo boot: the recording is the instant first step — press play */}
      {demo && (
        <div className="empty-cta demo-cta">
          <span className="empty-cta-label">start here · instant, no download</span>
          <button className="demo-play" onClick={onPlayDemo}>
            <span className="demo-play-act">▶ play a recorded run</span>
            <span className="demo-play-what">“The capital of France is”, answered token by token</span>
          </button>
        </div>
      )}

      {/* the CTA — a gallery of experiments, each a phenomenon worth watching */}
      <div className="empty-cta">
        <span className="empty-cta-label">
          {demo
            ? 'or go live (one 640 MB download, cached) and run these yourself'
            : 'run an experiment and take the tour'}
        </span>
        <div className="exp-grid">
          {EXPERIMENTS.map((e) => (
            <button key={e.id} className="exp-card" onClick={() => onRun(e)}>
              <span className="exp-title">{e.title}</span>
              <span className="exp-hook">{e.hook}</span>
              <span className="exp-prompt">“{e.prompt}”</span>
            </button>
          ))}
        </div>
        <span className="empty-hint">
          {demo ? 'live mode unlocks the prompt box above.' : 'or type your own prompt above.'}
        </span>
      </div>
    </section>
  )
}
