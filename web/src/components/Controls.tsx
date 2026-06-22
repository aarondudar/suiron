import { generate, step, stop } from "../api";
import { BandHeader } from "./BandHeader";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { Backend, GenParams } from "../types";

export function Controls({
  busy,
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

  return (
    <section>
      <BandHeader
        idx="00"
        title={<Explain of="settings">prompt</Explain>}
        sub={SUB.prompt}
      />
      <div className="ctl-row">
        <input
          type="text"
          value={prompt}
          placeholder="the cat sat on the"
          spellCheck={false}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button className={busy ? "busy" : ""} disabled={busy} onClick={go}>
          generate
        </button>
        <button
          disabled={busy || !hasTokens}
          title="advance the model exactly one token from where it stands"
          onClick={() => {
            onStep();
            void step(1, p);
          }}
        >
          step +1
        </button>
        <button disabled={!busy} onClick={() => void stop()}>
          stop
        </button>
        <button
          className="walk-go"
          disabled={!canWalk || busy}
          title="take the guided tour of how this token was produced, top to bottom"
          onClick={onWalk}
        >
          ▶ guided tour
        </button>
      </div>
      <div className="ctl-row ctl-params" data-explain-el="ctl-params">
        <BackendToggle
          backend={p.backend}
          disabled={busy}
          onChange={(b) => setParams({ ...p, backend: b })}
        />
        <label>
          n <input type="number" value={p.n} min={1} max={512} onChange={num("n")} />
        </label>
        <label data-explain-el="ctl-temp">
          <Explain of="temperature">temp</Explain>{" "}
          <input type="number" value={p.temp} step={0.1} min={0} max={2} onChange={num("temp")} />
        </label>
        <label data-explain-el="ctl-topk">
          <Explain of="topk">top-k</Explain>{" "}
          <input type="number" value={p.top_k} min={0} onChange={num("top_k")} />
        </label>
        <label data-explain-el="ctl-topp">
          <Explain of="topp">top-p</Explain>{" "}
          <input type="number" value={p.top_p} step={0.05} min={0} max={1} onChange={num("top_p")} />
        </label>
        <label>
          seed <input type="number" value={p.seed} min={0} onChange={num("seed")} />
        </label>
        <label>
          <input type="checkbox" checked={p.chat} onChange={(e) => setParams({ ...p, chat: e.target.checked })} /> chat
        </label>
      </div>
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
