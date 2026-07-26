import { useEffect, useRef, useState } from 'react'
import { generate, getTrace } from '../api'
import { CHAT_PARAMS } from '../lib'

/* The chat panel: a real conversation with the resident model, shown in the
   prompt band (band 00) in place of the prompt input while chat is on. It is the
   same loop the lab traces, driven through the existing /api/v1/generate with the
   chat template on and the q8 backend (the locked settings shown beside it). No
   fakery, no new endpoint. The lab's chat wrapping is one user turn, so each
   message is its own turn with no history; the UI says so. */

const STOP_MARKERS = /<\|im_end\|>|<\|endoftext\|>|<\|im_start\|>/g
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Msg {
  role: 'you' | 'model'
  text: string
  /** the message's measured pace: generated tokens + tok/s as they arrived */
  stats?: { tokens: number; tps: number | null }
  /** this user turn was sent with Qwen3's /no_think switch appended */
  noThink?: boolean
}

export function ChatPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  /** tok/s of the in-flight reply, updated every poll while it streams */
  const [liveTps, setLiveTps] = useState<number | null>(null)
  /** the in-flight reply's text so far, streamed into the pending bubble */
  const [partial, setPartial] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [msgs, pending])

  // follow the stream only while the reader is at the bottom — never yank
  // someone who scrolled up to read the reasoning as it happens
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60)
      el.scrollTo({ top: el.scrollHeight })
  }, [partial])

  /* Qwen3's reasoning is on by default; its own soft switch turns it off:
     "/no_think" appended to the user turn makes the model emit an empty
     think block and answer directly (nothing is forced — the model still
     draws every token). Off saves the token budget for the answer. */
  const [think, setThink] = useState(true)

  const send = async () => {
    const text = input.trim()
    if (!text || pending) return
    setInput('')
    setMsgs((m) => [...m, { role: 'you', text, noThink: !think }])
    setPending(true)
    try {
      const before = (await getTrace()).seq
      const sent = think ? text : `${text} /no_think`
      await generate(sent, { ...CHAT_PARAMS, seed: Math.floor(Math.random() * 1e9) })
      const { reply, stats } = await waitForReply(before, (p, tps) => {
        setPartial(p)
        setLiveTps(tps)
      })
      setMsgs((m) => [...m, { role: 'model', text: reply || '(no output)', stats }])
    } catch {
      setMsgs((m) => [...m, { role: 'model', text: '(generation failed)' }])
    } finally {
      setPending(false)
      setLiveTps(null)
      setPartial('')
    }
  }

  const hasReply = msgs.some((m) => m.role === 'model')

  return (
    <>
      {hasReply && (
        <div className="chat-hint" title="the model's reasoning appears above its answer">
          Scroll up to watch the model think!
        </div>
      )}
      <div className="chat-body" ref={bodyRef}>
        {msgs.length === 0 && !pending && (
          <div className="chat-empty">
            This runs the model you just watched: the resident weights, the q8 backend, wrapped in
            the chat template. Watch the bands below light up as it generates. Each message is its own
            turn; this demo does not carry history.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'chat-msg chat-' + m.role}>
            <span className="chat-role">{m.role}</span>
            {m.role === 'model' ? <ModelText text={m.text} /> : <span className="chat-text">{m.text}</span>}
            {m.noThink && (
              <span className="chat-meta" title="Qwen3's own soft switch: the model skips its reasoning block and answers directly">
                sent with /no_think — reasoning off
              </span>
            )}
            {m.stats && m.stats.tps !== null && (
              <span className="chat-meta" title="measured as the tokens arrived, this message">
                {m.stats.tokens} tokens · {m.stats.tps.toFixed(1)} tok/s
              </span>
            )}
          </div>
        ))}
        {pending && (
          <div className="chat-msg chat-model">
            <span className="chat-role">model</span>
            {partial && <ModelText text={partial} streaming />}
            <span className="chat-text chat-dots">
              generating…{liveTps !== null && ` · ${liveTps.toFixed(1)} tok/s`}
            </span>
          </div>
        )}
      </div>
      {/* the input reuses the prompt band's row, so the field is identical to the
          prompt's — only the placeholder and the buttons change */}
      <div className="ctl-row">
        <input
          type="text"
          value={input}
          placeholder={pending ? 'generating…' : 'say something to the model'}
          spellCheck={false}
          disabled={pending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button
          className={'chat-think-toggle' + (think ? '' : ' off')}
          disabled={pending}
          aria-pressed={!think}
          title={
            think
              ? 'reasoning on: the model thinks before it answers (its <think> block, shown de-emphasized). click to turn off — " /no_think", Qwen3\'s own switch, is appended to your message and the whole budget goes to the answer.'
              : 'reasoning off: " /no_think" is appended to your message (Qwen3\'s own switch) and the model answers directly. click to let it think again.'
          }
          onClick={() => setThink(!think)}
        >
          {think ? 'reasoning on' : 'reasoning off'}
        </button>
        <button className={pending ? 'busy' : ''} disabled={pending || !input.trim()} onClick={send}>
          send
        </button>
      </div>
    </>
  )
}

/** Poll the resident trace until a NEW generation settles, then read the
 *  assistant's tokens (everything after the chat-wrapped prompt). There is no
 *  wall-clock cap: the wait follows the engine's own busy flag, however slow
 *  the machine — it bails only when the token count stops moving for STALL_MS
 *  (a hung engine, not a slow one). Along the way it reports the partial text
 *  and the reply's real pace — generated tokens over the time since the first
 *  one was observed (so prefill never skews it). */
const STALL_MS = 15000
async function waitForReply(
  beforeSeq: number | undefined,
  onUpdate?: (partial: string, tps: number | null) => void,
): Promise<{ reply: string; stats: { tokens: number; tps: number | null } }> {
  let first: { at: number; n: number } | null = null
  let tps: number | null = null
  let lastMove = Date.now()
  let lastN = -1
  const settle = (t: { tokens: { t: string }[]; n_prompt: number }) => ({
    reply: decodeReply(t.tokens.slice(t.n_prompt)),
    stats: { tokens: Math.max(0, t.tokens.length - t.n_prompt), tps },
  })
  for (;;) {
    await sleep(250)
    let t
    try {
      t = await getTrace()
    } catch {
      // a transient poll failure is not a dead engine — the stall guard
      // decides when to stop believing that
      if (Date.now() - lastMove > STALL_MS) throw new Error('trace unreachable')
      continue
    }
    const now = Date.now()
    if (t.seq === beforeSeq) {
      // the new run has not landed yet; if it never does, say so honestly
      if (now - lastMove > STALL_MS) return { reply: '', stats: { tokens: 0, tps: null } }
      continue
    }
    const n = t.tokens.length - t.n_prompt
    if (n !== lastN) {
      lastN = n
      lastMove = now
    }
    if (n > 0 && !first) first = { at: now, n }
    if (first && n > first.n && now > first.at) tps = ((n - first.n) * 1000) / (now - first.at)
    onUpdate?.(n > 0 ? decodeReply(t.tokens.slice(t.n_prompt)) : '', tps)
    if (!t.busy) return settle(t)
    if (now - lastMove > STALL_MS) return settle(t) // hung, not slow: post what exists
  }
}

function decodeReply(tokens: { t: string }[]): string {
  return tokens
    .map((x) => x.t)
    .join('')
    .replace(STOP_MARKERS, '')
    .trim()
}

/* Qwen3 is a reasoning model: in chat mode it leads with a <think>…</think>
   block. Show it, but de-emphasized, with the final answer prominent. Nothing
   is hidden — the reasoning is real output the model produced. */
function ModelText({ text, streaming }: { text: string; streaming?: boolean }) {
  const m = text.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/)
  if (!m) {
    // an unclosed think block: mid-stream that is just reasoning in progress;
    // in a settled message it means the reply stopped before an answer —
    // either way it reads as reasoning, never as a raw tag
    const open = text.match(/^<think>([\s\S]*)$/)
    if (open)
      return (
        <>
          <span className="chat-think">
            <span className="chat-think-label">reasoning</span> {open[1].trim()}
          </span>
          {!streaming && (
            <span className="chat-text">(it stopped mid-reasoning, before an answer)</span>
          )}
        </>
      )
    return <span className="chat-text">{text || (streaming ? '' : '(no output)')}</span>
  }
  const think = m[1].trim()
  const answer = m[2].trim()
  return (
    <>
      {think && (
        <span className="chat-think">
          <span className="chat-think-label">reasoning</span> {think}
        </span>
      )}
      {(answer || !streaming) && (
        <span className="chat-text">
          {answer || '(reasoning only: it ran out of tokens before the answer)'}
        </span>
      )}
    </>
  )
}
