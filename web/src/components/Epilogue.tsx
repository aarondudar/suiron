import { useState, type ReactNode } from 'react'
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
  card,
  dim,
}: {
  onTryChat: () => void;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
}) {
  return (
    <section className={"epilogue" + (dim ? " dimmed" : "")} data-explain-el="epilogue">
      <div className="epi-boundary" role="separator">
        <span className="epi-boundary-up">↑ computed and verified in this lab</span>
        <span className="epi-boundary-down">
          ↓ how this scales · described here, not implemented
        </span>
      </div>
      {card}

      <div className="epi-half">
        <h3 className="epi-h">
          <Explain of="scaling">how this scales</Explain>
        </h3>
        <p className="epi-sub">
          suiron runs one sequence on one machine: the simplest correct version of each operation.
          The techniques below are what production systems add on top, to go faster and serve many
          users at once. Each one builds on a surface you just used; expand any to see how.
        </p>
        <ul className="epi-list">
          <ScaleEntry term="paged KV cache">
            The earlier tokens’ keys and values that <Explain of="attention">attention</Explain>{' '}
            reaches back over are kept in a KV cache. A paged KV cache splits it into fixed pages so
            many conversations share fragmented memory instead of each reserving one contiguous
            block.
          </ScaleEntry>
          <ScaleEntry term="continuous batching">
            Each token here is one step of the <Explain of="loop">loop</Explain>. Rather than run a
            fixed batch to the end, a server adds and removes sequences from the batch every step, so
            a finished request frees its slot at once and a new one starts without waiting.
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
          <ScaleEntry term="batching">
            Each token here is one <Explain of="loop">forward pass</Explain>. Servers run many
            sequences through a single pass together; batching is the throughput technique they
            depend on.
          </ScaleEntry>
          <ScaleEntry term="speculative decoding">
            The <Explain of="draw">random draw</Explain>, and how sure the model was, is where
            speculative decoding fits: a small draft model proposes several tokens that the real
            model checks in one pass, keeping the agreed prefix. The output is identical; it arrives
            faster.
          </ScaleEntry>
        </ul>
      </div>

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
          ↑ try it yourself: switch the prompt box to chat
        </button>
      </div>
    </section>
  )
}
