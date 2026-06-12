import { useCallback, useEffect, useRef, useState } from "react";
import { getTrace } from "./api";
import { Controls } from "./components/Controls";
import { EmptyState } from "./components/EmptyState";
import { LayerStack } from "./components/LayerStack";
import { Logits } from "./components/Logits";
import { Machine } from "./components/Machine";
import { Selection } from "./components/Selection";
import { TokenStrip } from "./components/TokenStrip";
import type { Trace } from "./types";

export default function App() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [cur, setCur] = useState(0);
  const [openLayer, setOpenLayer] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [explain, setExplain] = useState(false);
  const [prompt, setPrompt] = useState("");
  const lastSeq = useRef(-1);
  const followRef = useRef(follow);
  followRef.current = follow;

  // poll: fast while the model is generating, slow when idle
  useEffect(() => {
    let timer: number;
    let dead = false;
    const tick = async () => {
      try {
        const t = await getTrace();
        if (dead) return;
        if (t.seq !== lastSeq.current) {
          const grewTo = t.tokens.length - 1;
          lastSeq.current = t.seq ?? -1;
          setTrace((prev) => {
            const grew = !prev || t.tokens.length > prev.tokens.length;
            if (grew && followRef.current && grewTo >= 0) setCur(grewTo);
            return t;
          });
        }
        timer = window.setTimeout(tick, t.busy ? 250 : 1200);
      } catch {
        timer = window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, []);

  // keyboard scrubbing
  const nTokens = trace?.tokens.length ?? 0;
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") setCur((c) => Math.min(nTokens - 1, c + 1));
      if (e.key === "ArrowLeft") setCur((c) => Math.max(0, c - 1));
    },
    [nTokens],
  );
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);

  useEffect(() => {
    document.body.classList.toggle("explain", explain);
  }, [explain]);

  if (!trace) return <div className="label">connecting to suiron…</div>;

  const safeCur = Math.min(cur, trace.tokens.length - 1);
  const step = trace.tokens.length ? trace.steps[safeCur] : undefined;
  const hasTokens = trace.tokens.length > 0;

  return (
    <>
      <header>
        <div>
          <div className="brand">
            suiron<span className="jp">推論</span>
          </div>
          <div className="spec">
            {trace.model.toLowerCase()} · {trace.quant} · {trace.layers} layers · {trace.heads}h/
            {trace.kv_heads}kv · {trace.n_prompt} prompt +{" "}
            {Math.max(0, trace.tokens.length - trace.n_prompt)} generated
          </div>
        </div>
        <div className="pos">
          token <b>{hasTokens ? safeCur : 0}</b> / {Math.max(0, trace.tokens.length - 1)}
          <span className={"dot-live" + (trace.busy ? " on" : "")} />
        </div>
      </header>

      <Controls
        busy={!!trace.busy}
        hasTokens={hasTokens}
        follow={follow}
        setFollow={setFollow}
        prompt={prompt}
        setPrompt={setPrompt}
      />

      {!hasTokens && <EmptyState onPick={setPrompt} />}

      {hasTokens && step && (
        <>
          <TokenStrip trace={trace} step={step} cur={safeCur} setCur={setCur} />
          <Logits step={step} cur={safeCur} busy={!!trace.busy} />
          <Selection sel={step.sel} isPrompt={safeCur < trace.n_prompt} />
          <LayerStack
            trace={trace}
            step={step}
            nPos={safeCur + 1}
            openLayer={openLayer}
            setOpenLayer={setOpenLayer}
          />
          <Machine trace={trace} cur={safeCur} busy={!!trace.busy} />
        </>
      )}

      <footer>
        <span>suiron — 推論 · every value on this page came from a real forward pass of the model file</span>
        <button id="explain-toggle" onClick={() => setExplain(!explain)}>
          explain: {explain ? "on" : "off"}
        </button>
      </footer>
    </>
  );
}
