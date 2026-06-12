import { useState } from "react";
import { generate, stop } from "../api";
import type { GenParams } from "../types";

export function Controls({
  busy,
  follow,
  setFollow,
}: {
  busy: boolean;
  follow: boolean;
  setFollow: (v: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [p, setP] = useState<GenParams>({
    n: 32,
    temp: 0,
    top_k: 40,
    top_p: 0.95,
    seed: 7,
    chat: false,
  });

  const num =
    (k: keyof GenParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setP({ ...p, [k]: Number(e.target.value) });

  const go = () => {
    if (prompt.trim() && !busy) void generate(prompt, p);
  };

  return (
    <section>
      <div className="label">
        prompt — the model is resident; generation streams into the trace below
      </div>
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
        <button disabled={!busy} onClick={() => void stop()}>
          stop
        </button>
      </div>
      <div className="ctl-row ctl-params">
        <label>
          n <input type="number" value={p.n} min={1} max={512} onChange={num("n")} />
        </label>
        <label>
          temp <input type="number" value={p.temp} step={0.1} min={0} max={2} onChange={num("temp")} />
        </label>
        <label>
          top-k <input type="number" value={p.top_k} min={0} onChange={num("top_k")} />
        </label>
        <label>
          top-p <input type="number" value={p.top_p} step={0.05} min={0} max={1} onChange={num("top_p")} />
        </label>
        <label>
          seed <input type="number" value={p.seed} min={0} onChange={num("seed")} />
        </label>
        <label>
          <input type="checkbox" checked={p.chat} onChange={(e) => setP({ ...p, chat: e.target.checked })} /> chat
        </label>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
      </div>
    </section>
  );
}
