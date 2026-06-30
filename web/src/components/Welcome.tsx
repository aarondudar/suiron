import { useEffect, useRef } from 'react'

export const WELCOME_SEEN_KEY = 'suiron.welcome.seen'

export function Welcome({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)
  // read onClose through a ref so the trap effect depends only on `open`
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement as HTMLElement | null
    const node = ref.current
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'button, [href], input, [tabindex]:not([tabindex="-1"])',
            ),
          )
        : []
    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prevFocus.current?.focus?.() // restore focus to whatever opened it
    }
  }, [open])

  if (!open) return null

  return (
    <div className="welcome-scrim" onClick={() => onClose()}>
      <div
        className="welcome"
        role="dialog"
        aria-modal="true"
        aria-label="welcome to suiron"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="welcome-brand">
          suiron<span className="jp">推論</span>
        </div>
        <p className="welcome-lead">
          A from-scratch LLM inference engine I built in Rust, paired with this lab: a microscope
          for watching a real language model, Qwen3-0.6B, predict the next token one step at a time.
        </p>
        <p className="welcome-body">
          I built it to understand how text prediction actually works, and to show it by
          demonstration rather than description. Every number you see here is computed live by the
          engine and verified token-for-token against <b>llama.cpp</b>; nothing is mocked. It is an
          educational tool, not a product.
        </p>
        <p className="welcome-orient">
          To start: type a prompt, step through a token, and open any stage to go deeper.
        </p>
        <button className="welcome-enter" onClick={() => onClose()}>
          enter the lab
        </button>
      </div>
    </div>
  )
}
