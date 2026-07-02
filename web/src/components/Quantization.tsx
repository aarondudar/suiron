import { useEffect, useState, type ReactNode } from "react";
import { getQuantSample } from "../api";
import { BandHeader } from "./BandHeader";
import { BackendToggle } from "./Controls";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { Backend, GenParams, QuantSample, Trace } from "../types";

/* The quantization explainer + the showcase toggle. Three layers, like the
   machine band: the switch and the headline, then the live speed comparison,
   then an interactive look at one REAL weight block from the model. */

const PARAMS = 596_049_920; // Qwen3-0.6B; matches `suiron load`

export function Quantization({
  trace,
  params,
  setParams,
  busy,
  card,
  dim,
}: {
  trace: Trace;
  params: GenParams;
  setParams: (p: GenParams) => void;
  busy: boolean;
  /** the open concept's inline card, when this band hosts it (docs/16) */
  card?: ReactNode;
  /** another band hosts the open card: this one recedes */
  dim?: boolean;
}) {
  const [sample, setSample] = useState<QuantSample | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && !sample) getQuantSample().then(setSample).catch(() => {});
  }, [open, sample]);

  const backend = params.backend;
  const tps = trace.tps ?? { f32: null, q8: null };
  const speedup = tps.f32 && tps.q8 ? tps.q8 / tps.f32 : null;

  const f32Bytes = PARAMS * 4;
  const q8Bytes = Math.round(PARAMS * 34 / 32); // 34 bytes per 32 weights
  const gib = (b: number) => (b / 1024 ** 3).toFixed(2);

  return (
    <section className={dim ? "dimmed" : undefined}>
      <BandHeader
        idx="06"
        title={<Explain of="quantization">quantization</Explain>}
        sub={SUB.quant}
      >
        <BackendToggle backend={backend} disabled={busy} onChange={(b) => setParams({ ...params, backend: b })} />
        <button className="expand" onClick={() => setOpen(!open)}>
          show a real block
        </button>
      </BandHeader>
      {card}

      {/* headline: which path is live + the memory it moves */}
      <div className="q-cards">
        <div className={"q-card" + (backend === "f32" ? " on" : "")}>
          <div className="q-name">f32</div>
          <div className="q-sub">weights expanded to 32-bit floats</div>
          <div className="q-big">{gib(f32Bytes)} GiB</div>
          <div className="q-sub">{tps.f32 ? `${tps.f32.toFixed(1)} tok/s` : "run it to measure"}</div>
        </div>
        <div className="q-arrow">{speedup ? `${speedup.toFixed(2)}× faster →` : "→"}</div>
        <div className={"q-card" + (backend === "q8" ? " on" : "")}>
          <div className="q-name">q8</div>
          <div className="q-sub">8-bit blocks read directly</div>
          <div className="q-big">{gib(q8Bytes)} GiB</div>
          <div className="q-sub">{tps.q8 ? `${tps.q8.toFixed(1)} tok/s` : "run it to measure"}</div>
        </div>
      </div>

      {open && (
        <div className="m-math">
          {sample ? (
            <QuantBlock sample={sample} backend={backend} />
          ) : (
            <div className="q-loading">loading a real weight block…</div>
          )}
        </div>
      )}
    </section>
  );
}

/** One real Q8_0 block (32 weights) from the model, shown as the f32 path
 *  sees it vs the q8 path: a shared scale × small integers. */
function QuantBlock({ sample, backend }: { sample: QuantSample; backend: Backend }) {
  const show = 8; // first 8 of the 32 weights, to keep it readable
  return (
    <div className="q-block">
      <div className="q-block-head">
        one real block from <b>{sample.tensor}</b>. 32 weights share a single scale (
        <b>{sample.scale.toExponential(3)}</b>):
      </div>
      <table className="m-table">
        <thead>
          <tr>
            <th>weight</th>
            <th>f32 path sees</th>
            <th>q8 stores</th>
            <th>= scale × quant</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: show }, (_, i) => (
            <tr key={i} className={backend === "q8" ? "strong" : undefined}>
              <td>w{i}</td>
              <td>{sample.values[i].toFixed(5)} (4 B)</td>
              <td>{sample.quants[i]} (1 B)</td>
              <td>{sample.scale.toExponential(2)} × {sample.quants[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="q-block-foot">
        …and 24 more. f32 stores {show > 0 ? "32 × 4 = 128" : ""} bytes per block; q8 stores
        32 × 1 + 2 (the scale) = <b>34 bytes</b>. same values, ¼ the memory.
      </div>
    </div>
  );
}
