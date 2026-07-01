import { useEffect, useState } from "react";
import { getInspect } from "../api";
import { settledSeq } from "../lib";
import type { ExplainCtx } from "./Explanations";
import type { WorkedNorm } from "../types";

/* RMSNorm, running. Before each layer step the token's vector is rescaled: divide
   every number by the vector's root-mean-square, then multiply by a learned
   per-dimension weight. This shows it on real numbers for this layer's attention
   norm — a few components going x → x/rms → ·weight = the normalized value the
   engine used. Dividing by rms is a uniform scale (length changes, direction is
   preserved); the learned weight then rescales each dimension. Pure render over
   the inspect worked-norm slice, fetched at the producing position. */

interface Resp {
  norm?: WorkedNorm;
}

const f = (x: number) => x.toFixed(3);

export function RmsNormDemo({ ctx }: { ctx: ExplainCtx }) {
  const [data, setData] = useState<Resp | null>(null);

  const seq = settledSeq(ctx.trace);
  useEffect(() => {
    let dead = false;
    setData(null);
    if (ctx.prod < 0 || seq < 0) return; // no producing pass yet / still generating
    getInspect<Resp>(ctx.prod, ctx.layer)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.prod, ctx.layer, seq]);

  if (ctx.prod < 0) {
    return (
      <div className="rms-demo rms-status">
        The first token has no producing pass. Select a later token to watch its vector normalize.
      </div>
    );
  }
  if (!data) return <div className="rms-demo rms-status">loading the producing pass…</div>;
  const n = data.norm;
  if (!n) return <div className="rms-demo rms-status">no norm to show here.</div>;

  const rows = n.pre.map((x, j) => {
    const scaled = x / n.rms;
    const out = scaled * n.weight[j];
    return { j, x, scaled, w: n.weight[j], out, err: Math.abs(out - n.post[j]) };
  });
  const maxErr = Math.max(...rows.map((r) => r.err));

  return (
    <div className="rms-demo">
      <div className="rms-formula">
        each number: x ÷ rms × weight · rms = <b>{f(n.rms)}</b> over {n.len} numbers
      </div>

      <div className="tbl-scroll">
        <table className="rms-tbl">
          <thead>
            <tr>
              <th>i</th>
              <th>x</th>
              <th>÷ rms</th>
              <th>× weight</th>
              <th>= norm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.j}>
                <td>{r.j}</td>
                <td>{f(r.x)}</td>
                <td>{f(r.scaled)}</td>
                <td>{f(r.w)}</td>
                <td className="rms-out">{f(r.out)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rms-note">
        dividing by the rms is a uniform scale: it changes the vector's length, not its direction.
        the learned weight then rescales each dimension. showing the first {n.pre.length} of {n.len}.
      </div>
      <div className="rms-check">
        reconstructed = the engine's normalized vector{" "}
        <span className="dp-check">{maxErr < 5e-3 ? "· matches" : `· differs (${f(maxErr)})`}</span>
      </div>
    </div>
  );
}
