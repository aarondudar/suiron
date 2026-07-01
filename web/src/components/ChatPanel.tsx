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
}

export function ChatPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [msgs, pending])

  const send = async () => {
    const text = input.trim()
    if (!text || pending) return
    setInput('')
    setMsgs((m) => [...m, { role: 'you', text }])
    setPending(true)
    try {
      const before = (await getTrace()).seq
      await generate(text, { ...CHAT_PARAMS, seed: Math.floor(Math.random() * 1e9) })
      const reply = await waitForReply(before)
      setMsgs((m) => [...m, { role: 'model', text: reply || '(no output)' }])
    } catch {
      setMsgs((m) => [...m, { role: 'model', text: '(generation failed)' }])
    } finally {
      setPending(false)
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
          </div>
        ))}
        {pending && (
          <div className="chat-msg chat-model">
            <span className="chat-role">model</span>
            <span className="chat-text chat-dots">generating…</span>
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
        <button className={pending ? 'busy' : ''} disabled={pending || !input.trim()} onClick={send}>
          send
        </button>
      </div>
    </>
  )
}

/** Poll the resident trace until a NEW generation settles, then read the
 *  assistant's tokens (everything after the chat-wrapped prompt). */
async function waitForReply(beforeSeq: number | undefined): Promise<string> {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    await sleep(250)
    const t = await getTrace()
    if (t.seq !== beforeSeq && !t.busy) {
      return decodeReply(t.tokens.slice(t.n_prompt))
    }
  }
  const t = await getTrace()
  return decodeReply(t.tokens.slice(t.n_prompt))
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
function ModelText({ text }: { text: string }) {
  const m = text.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/)
  if (!m) return <span className="chat-text">{text || '(no output)'}</span>
  const think = m[1].trim()
  const answer = m[2].trim()
  return (
    <>
      {think && (
        <span className="chat-think">
          <span className="chat-think-label">reasoning</span> {think}
        </span>
      )}
      <span className="chat-text">
        {answer || '(reasoning only: it ran out of tokens before the answer)'}
      </span>
    </>
  )
}
