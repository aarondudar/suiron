import type { ReactNode } from "react";
import { generate, step, stop } from "../api";
import { CHAT_PARAMS } from "../lib";
import { BandHeader } from "./BandHeader";
import { ChatPanel } from "./ChatPanel";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { Backend, GenParams } from "../types";

export function Controls({
  busy,
  chatOpen,
  onChatToggle,
  card,
  dim,
  hasTokens,
  prompt,
  setPrompt,
  params,
  setParams,
  onGenerate,
  onStep,
  onWalk,
  canWalk,
}: {
  busy: boolean;
  /** the chat dropdown is open: the prompt is replaced by the chat panel and the
   *  settings are locked to the chat-optimal values */
  chatOpen: boolean;
  onChatToggle: (v: boolean) => void;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
  hasTokens: boolean;
  prompt: string;
  setPrompt: (p: string) => void;
  params: GenParams;
  setParams: (p: GenParams) => void;
  onGenerate: () => void;
  onStep: () => void;
  onWalk: () => void;
  canWalk: boolean;
}) {
  const p = params;
  const num =
    (k: keyof GenParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setParams({ ...p, [k]: Number(e.target.value) });

  const go = () => {
    const text = prompt.trim();
    if (text && !busy) {
      onGenerate();
      void generate(text, p);
    }
  };

  // in chat mode the params are still shown, but locked to the chat settings
  const view = chatOpen ? CHAT_PARAMS : p;

  return (
    <section className={dim ? "dimmed" : undefined}>
      <BandHeader
        idx="00"
        title={<Explain of="settings">{chatOpen ? "chat" : "prompt"}</Explain>}
        sub={chatOpen ? SUB.chat : SUB.prompt}
      >
        {!chatOpen && canWalk && (
          <button
            className="walk-go hdr-tour"
            title="take the guided tour of how this token was produced, top to bottom"
            onClick={onWalk}
          >
            ▶ tour
          </button>
        )}
      </BandHeader>
      {card}

      {chatOpen ? (
        <ChatPanel />
      ) : (
        <div className="ctl-row">
          <input
            type="text"
            value={prompt}
            placeholder="the cat sat on the"
            spellCheck={false}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
          {busy ? (
            <button onClick={() => void stop()}>stop</button>
          ) : (
            <>
              <button onClick={go}>generate</button>
              <button
                disabled={!hasTokens}
                title="advance the model exactly one token from where it stands"
                onClick={() => {
                  onStep();
                  void step(1, p);
                }}
              >
                step +1
              </button>
            </>
          )}
        </div>
      )}

      <div className="ctl-row ctl-params" data-explain-el="ctl-params">
        <BackendToggle
          backend={view.backend}
          disabled={busy || chatOpen}
          onChange={(b) => setParams({ ...p, backend: b })}
        />
        <label>
          n{" "}
          <input
            type="number"
            value={view.n}
            min={1}
            max={512}
            disabled={chatOpen}
            onChange={num("n")}
          />
        </label>
        <label data-explain-el="ctl-temp">
          <Explain of="temperature">temp</Explain>{" "}
          <input
            type="number"
            value={view.temp}
            step={0.1}
            min={0}
            max={2}
            disabled={chatOpen}
            onChange={num("temp")}
          />
        </label>
        <label data-explain-el="ctl-topk">
          <Explain of="topk">top-k</Explain>{" "}
          <input type="number" value={view.top_k} min={0} disabled={chatOpen} onChange={num("top_k")} />
        </label>
        <label data-explain-el="ctl-topp">
          <Explain of="topp">top-p</Explain>{" "}
          <input
            type="number"
            value={view.top_p}
            step={0.05}
            min={0}
            max={1}
            disabled={chatOpen}
            onChange={num("top_p")}
          />
        </label>
        {chatOpen ? (
          <span className="ctl-seed-auto" title="randomized per message for variety">
            seed random
          </span>
        ) : (
          <label>
            seed <input type="number" value={p.seed} min={0} onChange={num("seed")} />
          </label>
        )}
        <button
          className={"chat-toggle" + (chatOpen ? " on" : "")}
          aria-expanded={chatOpen}
          title="chat with the resident model (q8, chat template)"
          onClick={() => onChatToggle(!chatOpen)}
        >
          chat {chatOpen ? "▴" : "▾"}
        </button>
      </div>
      {chatOpen && (
        <div className="ctl-locked">
          settings locked for chat. close chat to edit them and use the prompt.
        </div>
      )}
    </section>
  );
}

/** Segmented f32 / q8 backend switch. Shared component (controls + the
 *  quantization band both render it against the same param state). */
export function BackendToggle({
  backend,
  disabled,
  onChange,
}: {
  backend: Backend;
  disabled?: boolean;
  onChange: (b: Backend) => void;
}) {
  return (
    <div
      className={"seg" + (disabled ? " seg-dim" : "")}
      title="weight arithmetic backend"
      data-explain-el="ctl-backend"
    >
      {(["f32", "q8"] as Backend[]).map((b) => (
        <button
          key={b}
          className={"seg-opt" + (backend === b ? " on" : "")}
          disabled={disabled}
          onClick={() => onChange(b)}
        >
          {b}
        </button>
      ))}
    </div>
  );
}
