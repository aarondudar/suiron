import { useEffect, useState } from "react";
import { getInspect } from "../api";
import { litToken, settledSeq } from "../lib";
import type { ExplainCtx } from "./Explanations";

/* Embedding as a real table-row lookup. x_in at layer 0 IS the raw embedding
   row: model.embedding(token), no compute involved. This reads it at `cur` (an
   IDENTITY read — the token's own vector, not something a forward pass
   produced, so it works even at the seed) and shows it explicitly as "row {id}
   of the 151,936 x 1,024 table" — a fuller, honestly-labeled slice of the same
   real numbers /api/v1/inspect already returns for the woven view below. */

interface VecStat {
  head: number[];
  len: number;
  rms: number;
}
interface Resp {
  token: { id: number; t: string };
  x_in?: VecStat;
}

const VOCAB = 151_936;
const f = (x: number) => x.toFixed(4);

export function EmbeddingRow({ ctx }: { ctx: ExplainCtx }) {
  const [data, setData] = useState<Resp | null>(null);

  const seq = settledSeq(ctx.trace);
  useEffect(() => {
    let dead = false;
    setData(null);
    if (seq < 0) return; // still generating
    // identity read: the token's own row, independent of any forward pass —
    // valid even at the seed (cur = 0)
    getInspect<Resp>(ctx.cur, 0)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.cur, seq]);

  if (!data || !data.x_in) return <div className="emb-row emb-status">loading the table row…</div>;

  const row = data.x_in;
  const shown = row.head; // bounded slice already served by inspect (VEC_HEAD_N)
  const t = litToken(data.token.t).text;

  return (
    <div className="emb-row">
      <div className="emb-title">
        row <b>{data.token.id}</b> of the <b>{VOCAB.toLocaleString()}</b> × <b>{row.len}</b> embedding
        table: the starting vector for “{t}”
      </div>
      <div className="emb-cells">
        {shown.map((x, i) => (
          <div className="emb-cell" key={i}>
            <span className="emb-idx">{i}</span>
            <span className="emb-val">{f(x)}</span>
          </div>
        ))}
        <div className="emb-cell emb-ellipsis">… {row.len - shown.length} more</div>
      </div>
      <div className="emb-note">
        showing the first {shown.length} of {row.len} numbers, rms {row.rms.toFixed(3)}. this exact
        row is what enters layer 0; nothing here is computed, it is a lookup by token id.
      </div>
    </div>
  );
}
