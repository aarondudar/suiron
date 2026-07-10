import type { Trace } from "../types";

/* What the model physically IS: a ledger of every weight matrix in the file,
   with real shapes and counts. The arithmetic is the proof — the groups sum to
   exactly 596,049,920 numbers, and at Q8_0's 34 bytes per 32 weights that is
   the ~640 MB file this page loaded. Rows the learner will meet again: the
   embedding table (band 02's lookup and the final unembed), wq/wk/wv/wo
   (attention), gate/up/down (feed-forward). Shapes derive from the trace's
   config; hidden/ffn/vocab are this model's architecture facts (the same ones
   the concept prose uses throughout). */

const HIDDEN = 1024;
const FFN = 3072;
const VOCAB = 151_936;

const f = (n: number) => n.toLocaleString();

export function WeightLedger({ trace }: { trace: Trace }) {
  const L = trace.layers;
  const qDim = trace.heads * trace.head_dim;
  const kvDim = trace.kv_heads * trace.head_dim;

  const embd = VOCAB * HIDDEN;
  const attn = qDim * HIDDEN + 2 * (kvDim * HIDDEN) + HIDDEN * qDim;
  const ffn = 3 * (FFN * HIDDEN);
  const norms = 2 * HIDDEN + 2 * trace.head_dim; // attn/ffn norms + per-head q/k norms
  const perLayer = attn + ffn + norms;
  const total = embd + L * perLayer + HIDDEN; // + the final norm
  const q8Bytes = (total * 34) / 32;

  const rows: [string, string, number, string][] = [
    [
      "token_embd",
      `${f(VOCAB)} × ${f(HIDDEN)}`,
      embd,
      "the embedding table: one row per vocabulary entry — the lookup at the start, reused as the unembed at the end",
    ],
    [
      "wq · wk · wv · wo",
      `×${L} layers`,
      L * attn,
      "attention's four projections: make the queries, keys, and values, then project the blended heads back",
    ],
    [
      "gate · up · down",
      `×${L} layers`,
      L * ffn,
      "feed-forward's three projections: expand to 3,072, gate, compress back",
    ],
    [
      "norms",
      `×${L} + 1`,
      L * norms + HIDDEN,
      "the RMSNorm gains: tiny next to everything else",
    ],
  ];

  return (
    <div className="ledger">
      <div className="ledger-lead">
        the file this page loaded is nothing but these matrices — learned numbers, organized:
      </div>
      <div className="tbl-scroll">
        <table className="ledger-tbl">
          <thead>
            <tr>
              <th>weights</th>
              <th>shape</th>
              <th>numbers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, shape, count, why]) => (
              <tr key={name} title={why}>
                <td className="ledger-name">{name}</td>
                <td>{shape}</td>
                <td className="ledger-count">{f(count)}</td>
              </tr>
            ))}
            <tr className="ledger-total">
              <td>everything</td>
              <td></td>
              <td className="ledger-count">{f(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="ledger-note">
        {f(total)} numbers × 34 bytes per 32 (the Q8_0 blocks) ≈ <b>{(q8Bytes / 1e6).toFixed(0)} MB</b>
        {" "}— the download, minus a few MB of tokenizer vocabulary and metadata. that is the whole
        model; there is no other machinery in the file. the biggest open models are this same ledger
        with wider rows and more layers: tens of billions of numbers, tens of gigabytes. everything
        the tour shows next is one of these matrices being used.
      </div>
    </div>
  );
}
