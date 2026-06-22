import { litToken } from '../lib'
import type { ExplainCtx } from './Explanations'

const enc = new TextEncoder()

export function TokenizeDemo({ ctx }: { ctx: ExplainCtx }) {
  const toks = ctx.trace.tokens
  return (
    <div className="tok-demo">
      {toks.map((t, i) => {
        const lt = litToken(t.t)
        const bytes = enc.encode(t.t).length
        return (
          <span
            key={i}
            className={'tok-chip' + (i === ctx.cur ? ' cur' : '')}
            title={`token id ${t.id} · ${bytes} byte${bytes === 1 ? '' : 's'}`}
          >
            <span className={'tok-chip-text' + (lt.literal ? ' geo-lit' : '')}>{lt.text}</span>
            <span className="tok-chip-id">{t.id}</span>
          </span>
        )
      })}
    </div>
  )
}
