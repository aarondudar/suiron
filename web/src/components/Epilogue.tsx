import { useState, type ReactNode } from 'react'
import { IS_WASM } from '../api'
import { EXPERIMENTS, type Experiment } from '../experiments'
import { N_PARAMS, raceLine, raceSpeedup } from '../lib'
import type { Trace } from '../types'
import { Explain } from './Explainer'

/* The epilogue: framing that sits OUTSIDE the verified instrument and closes the
   lab. A single unmistakable boundary (verbal + visual) separates what was
   computed and verified above from what is only described here. Half 1 is an
   interactive glossary: each production technique is one entry whose explanation
   (and its back-reference to the surface the learner used) stays hidden until
   expanded, with the term and a "not run here" tag always visible. Half 2 shows
   that an agent is this same loop plus a wrapper. Nothing below the boundary is
   implemented in suiron. No engine call, no new type. */

function Tag() {
  return <span className="epi-tag">not run here</span>
}

/** The one entry that gets to prove itself: quantization runs in this lab, so
 *  it opens "how this scales" with the real f32/q8 memory and whatever speed
 *  has actually been measured — live, or the demo's recorded number, labeled.
 *  Reuses module 06's cards so the two reads stay visually one fact. */
function SpeedRace({ trace }: { trace: Trace }) {
  const tps = trace.tps ?? { f32: null, q8: null }
  const demo = !!trace.demo
  const gib = (b: number) => (b / 1024 ** 3).toFixed(2)
  return (
    <div className="epi-race">
      <p className="epi-race-lead">
        One of them runs right here. Every number this lab computed used <b>quantized</b>{' '}
        weights — the q8 path below — and the engine's tests pin its answers argmax-identical
        to the f32 reference. The only difference left is how many bytes each token reads:
        <span className="epi-tag here">measured, not described</span>
      </p>
      <div className="q-cards">
        <div className={'q-card' + (trace.backend === 'f32' ? ' on' : '')}>
          <div className="q-name">f32</div>
          <div className="q-sub">weights expanded to 32-bit floats</div>
          <div className="q-big">{gib(N_PARAMS * 4)} GiB</div>
          <div className="q-sub">{raceLine('f32', tps, demo, IS_WASM)}</div>
        </div>
        <div className="q-arrow">{raceSpeedup(tps) ?? '→'}</div>
        <div className={'q-card' + (trace.backend !== 'f32' ? ' on' : '')}>
          <div className="q-name">q8</div>
          <div className="q-sub">8-bit blocks read directly</div>
          <div className="q-big">{gib((N_PARAMS * 34) / 32)} GiB</div>
          <div className="q-sub">{raceLine('q8', tps, demo, IS_WASM)}</div>
        </div>
      </div>
    </div>
  )
}

/** One glossary entry: the term is always visible; its explanation (with the
 *  <Explain> back-reference to the surface the learner used) collapses until
 *  expanded. */
function ScaleEntry({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="epi-entry">
      <button
        className={'epi-term' + (open ? ' open' : '')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="epi-term-mark">{open ? '−' : '+'}</span> {term}
      </button>
      {open && <div className="epi-entry-detail">{children}</div>}
    </li>
  )
}

export function Epilogue({
  onTryChat,
  onRun,
  trace,
  card,
  dim,
  part,
}: {
  onTryChat: () => void;
  /** run a curated experiment (docs/21): somewhere to go after the tour */
  onRun: (e: Experiment) => void;
  /** the resident run, for the measured f32/q8 race (absent = panel hidden) */
  trace?: Trace;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
  /** render one half only — the flow gives each its own outro step; absent
   *  (the expert view) renders the whole epilogue as before */
  part?: "scale" | "agent";
}) {
  const showScale = part !== "agent";
  const showAgent = part !== "scale";
  return (
    <section className={"epilogue" + (dim ? " dimmed" : "")} data-explain-el="epilogue">
      {showScale && (
        <div className="epi-boundary" role="separator">
          <span className="epi-boundary-up">↑ computed and verified in this lab</span>
          <span className="epi-boundary-down">
            ↓ how this scales · described here, not implemented
          </span>
        </div>
      )}
      {card}

      {showScale && (
      <div className="epi-half">
        <h3 className="epi-h">
          <Explain of="scaling">how this scales</Explain>
        </h3>
        <p className="epi-sub">
          suiron runs one sequence on one machine: the simplest correct version of each operation.
          The techniques below are what production systems add on top, to go faster and serve many
          users at once. Each one builds on a surface you just used; expand any to see how.
        </p>
        {trace && <SpeedRace trace={trace} />}
        <ul className="epi-list">
          <ScaleEntry term="paged KV cache">
            The earlier tokens’ keys and values that <Explain of="attention">attention</Explain>{' '}
            reaches back over are kept in a KV cache. A paged KV cache splits it into fixed pages so
            many conversations share fragmented memory instead of each reserving one contiguous
            block.
          </ScaleEntry>
          <ScaleEntry term="continuous batching">
            Each token here is one step of the <Explain of="loop">loop</Explain>. Servers push many
            sequences through each pass together (batching), and rather than run a fixed batch to
            the end they add and remove sequences every step, so a finished request frees its slot
            at once and a new one starts without waiting.
          </ScaleEntry>
          <ScaleEntry term="FlashAttention">
            The attention score you stepped out by hand,{' '}
            <Explain of="attention">q·k into the scores, then softmax</Explain>, is computed by
            FlashAttention in tiles that never store the full scores array, so memory stays flat as
            the context grows.
          </ScaleEntry>
          <ScaleEntry term="lower-bit quantization">
            The Q8_0 blocks and the f32-versus-q8 memory you measured under{' '}
            <Explain of="quantization">quantization</Explain> go further at scale: 4-bit and lower
            quantization trades a little accuracy for far less memory moved per token.
          </ScaleEntry>
          <ScaleEntry term="mixture of experts">
            The <Explain of="feedforward">feed-forward step</Explain>, one gate, up, and down per
            layer, becomes many feed-forward blocks per layer with each token routed to only a few,
            so total parameters grow while the work per token does not.
          </ScaleEntry>
          <ScaleEntry term="speculative decoding">
            The <Explain of="draw">random draw</Explain>, and how sure the model was, is where
            speculative decoding fits: a small draft model proposes several tokens that the real
            model checks in one pass, keeping the agreed prefix. The output is identical; it arrives
            faster.
          </ScaleEntry>
        </ul>
      </div>
      )}

      {showAgent && (
      <div className="epi-half">
        <h3 className="epi-h">
          <Explain of="agents">from this loop to an agent</Explain>
        </h3>
        <p className="epi-body">
          A coding agent, including the assistant that may have helped build this, is the{' '}
          <Explain of="loop">loop you just watched</Explain>: score the vocabulary, draw one token,
          append it, repeat. Three things wrap that loop, all outside the model.
        </p>
        <ul className="epi-list">
          <li>
            A <b>chat template</b> formats the conversation into tokens with role markers. Turn on{' '}
            <b>chat</b> in the controls above and the markers <code>{'<|im_start|>'}</code> and{' '}
            <code>{'<|im_end|>'}</code> enter the token strip, each an ordinary vocabulary entry
            with its own token ID, drawn by the same step as any word. (You can see this now, in the
            instrument above.)
          </li>
          <li>
            A <b>harness</b>, plain code around the model, watches the token stream; when the model
            predicts a token it recognizes as a tool call, the harness pauses generation, runs the
            tool itself, writes the result back into the context as more tokens, and resumes.{' '}
            <Tag />
          </li>
        </ul>
        <p className="epi-punch">
          The honest part: <b>the model never runs a tool.</b> It predicts a token. External code
          reads that token and acts. “Using a tool” is next-token prediction plus a wrapper.
        </p>

        <button className="chat-open" onClick={onTryChat}>
          ↑ try it: chat with the model
        </button>
      </div>
      )}

      {showAgent && (
      <div className="epi-exps">
        <span className="epi-exps-label">or run another experiment ↑</span>
        {EXPERIMENTS.map((x) => (
          <button key={x.id} className="epi-exp" title={x.hook} onClick={() => onRun(x)}>
            {x.title}
          </button>
        ))}
      </div>
      )}
    </section>
  )
}
