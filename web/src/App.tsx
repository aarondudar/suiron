import { useCallback, useEffect, useRef, useState } from "react";
import { getTrace } from "./api";
import { Controls } from "./components/Controls";
import { EmptyState } from "./components/EmptyState";
import { LayerStack } from "./components/LayerStack";
import { Logits } from "./components/Logits";
import { Machine } from "./components/Machine";
import { Quantization } from "./components/Quantization";
import { Selection } from "./components/Selection";
import { TokenStrip } from "./components/TokenStrip";
import { DEFAULT_PARAMS } from "./lib";
import type { GenParams, Trace } from "./types";

export default function App() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [cur, setCur] = useState(0);
  const [openLayer, setOpenLayer] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [explain, setExplain] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS);
  const [hoverLayer, setHoverLayer] = useState<number | null>(null);
  const [hoverCand, setHoverCand] = useState<number | null>(null);
  const lastSeq = useRef(-1);
  const followRef = useRef(follow);
  followRef.current = follow;
  const curRef = useRef(cur);
  curRef.current = cur;
  /** set by step+1: the next growth always advances the view */
  const jumpRef = useRef(false);

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
            // advance when following, when stepping, or when already parked
            // on the frontier — never yank a user who scrubbed back
            const atFrontier = prev && curRef.current === prev.tokens.length - 1;
            if (grew && grewTo >= 0 && (followRef.current || jumpRef.current || atFrontier)) {
              setCur(grewTo);
              jumpRef.current = false;
            }
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
  // while running, show what's actually running; otherwise what's selected
  const activeBackend = trace.busy ? trace.backend ?? params.backend : params.backend;

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
        <div className="head-right">
          <button id="explain-toggle" onClick={() => setExplain(!explain)}>
            explain: {explain ? "on" : "off"}
          </button>
          <div className="pos">
            <span className={"be-tag be-" + activeBackend}>{activeBackend}</span>
            token <b>{hasTokens ? safeCur : 0}</b> / {Math.max(0, trace.tokens.length - 1)}
            <span
              className={
                "dot-live" + (trace.busy ? " on" : "") + (activeBackend === "q8" ? " fast" : "")
              }
            />
          </div>
        </div>
      </header>

      <Controls
        busy={!!trace.busy}
        hasTokens={hasTokens}
        follow={follow}
        setFollow={setFollow}
        prompt={prompt}
        setPrompt={setPrompt}
        params={params}
        setParams={setParams}
        onStep={() => {
          jumpRef.current = true;
        }}
      />

      {!hasTokens && <EmptyState onPick={setPrompt} params={params} />}

      {hasTokens && step && (
        <>
          <TokenStrip
            trace={trace}
            step={step}
            cur={safeCur}
            setCur={setCur}
            focusLayer={hoverLayer}
            hoverCand={hoverCand}
          />
          <Logits step={step} cur={safeCur} busy={!!trace.busy} setHoverCand={setHoverCand} />
          <Selection sel={step.sel} isPrompt={safeCur < trace.n_prompt} />
          <LayerStack
            trace={trace}
            step={step}
            nPos={safeCur + 1}
            openLayer={openLayer}
            setOpenLayer={setOpenLayer}
            setHoverLayer={setHoverLayer}
          />
          <Machine trace={trace} cur={safeCur} busy={!!trace.busy} />
          <Quantization trace={trace} params={params} setParams={setParams} busy={!!trace.busy} />
        </>
      )}

      <footer>
        <span>suiron — 推論 · every value on this page came from a real forward pass of the model file</span>
      </footer>
    </>
  );
}
