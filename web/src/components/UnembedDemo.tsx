import { useEffect, useState } from "react";
import { useAutoplay } from "../autoplay";
import { litToken } from "../lib";
import { Stepper } from "./Stepper";
import type { ExplainCtx } from "./Explanations";
import type { WorkedUnembed } from "../types";

/* The unembed, worked. After the final RMSNorm the model holds one vector; it
   scores every possible next token by the dot product of that vector with the
   token's own row in the (tied) embedding table — the SAME table the embedding
   step looked up at the start. This steps Σ final[i]·row[i] for a chosen
   candidate and lands on that token's real logit, exactly like the worked
   attention score. Fetched at the final stage (layer = n_layers) at the
   producing position. Candidate text comes from the real top predictions
   (ctx.step.top), so the shown candidates are the model's actual ranking. */

interface Resp {
  unembed?: WorkedUnembed;
}

const f = (x: number) => x.toFixed(3);

export function UnembedDemo({ ctx }: { ctx: ExplainCtx }) {
  const [data, setData] = useState<Resp | null>(null);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    let dead = false;
    setData(null);
    setPick(0);
    if (ctx.prod < 0) return; // the seed token had no producing pass
    // the final stage: post output_norm, pre-unembed (layer index == n_layers)
    fetch(`/api/v1/inspect?pos=${ctx.prod}&layer=${ctx.trace.layers}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Resp | null) => !dead && setData(d))
      .catch(() => !dead && setData(null));
    return () => {
      dead = true;
    };
  }, [ctx.prod, ctx.trace.layers]);

  const u = data?.unembed;
  const len = u?.len ?? 0;
  const { i, playing, setI, toggle } = useAutoplay(len, { chunk: 64, stepMs: 60 });

  if (ctx.prod < 0) {
    return (
      <div className="unembed-demo dp-status">
        The first token has no producing pass. Select a later token to work its prediction.
      </div>
    );
  }
  if (!data) return <div className="unembed-demo dp-status">loading the final stage…</div>;
  if (!u || u.cands.length === 0) return <div className="unembed-demo dp-status">no unembed to show here.</div>;

  const cand = u.cands[Math.min(pick, u.cands.length - 1)];
  const text = (id: number) => {
    const hit = ctx.step.top?.find(([tid]) => tid === id);
    return hit ? litToken(hit[1]).text : `#${id}`;
  };
  const partial = (nn: number) => {
    let s = 0;
    for (let j = 0; j < nn; j++) s += u.x[j] * cand.row[j];
    return s;
  };
  const runSum = partial(Math.min(i, len));
  const done = i >= len;
  const agrees = Math.abs(partial(len) - cand.logit) < 5e-2;

  return (
    <div className="unembed-demo">
      <div className="dp-title">the score for one next-token: the final vector · that token's row</div>

      <div className="dp-src">
        candidate:
        {u.cands.map((c, idx) => (
          <button
            key={c.id}
            className={"dp-src-opt" + (idx === pick ? " on" : "")}
            onClick={() => setPick(idx)}
            title={`logit ${f(c.logit)} · ${(c.prob * 100).toFixed(1)}%`}
          >
            {text(c.id)}
          </button>
        ))}
      </div>

      <div className="dp-formula">
        logit = final · row(<b>{text(cand.id)}</b>)
      </div>

      <div className="dp-step">
        {i > 0 ? (
          <span className="dp-term">
            x[{i - 1}] × row[{i - 1}] = {f(u.x[i - 1])} × {f(cand.row[i - 1])} ={" "}
            <span className="dp-prod">{f(u.x[i - 1] * cand.row[i - 1])}</span>
          </span>
        ) : (
          <span className="dp-term">pair each of the {len} numbers, multiply, sum.</span>
        )}
      </div>

      <div className="dp-runsum">
        <span className="dp-runsum-val">Σ final·row so far = {f(runSum)}</span>
      </div>

      {done && (
        <div className="dp-result">
          logit = <span className="dp-score">{f(cand.logit)}</span> → softmax →{" "}
          <b>{(cand.prob * 100).toFixed(1)}%</b>
          <span className="dp-check"> {agrees ? "· matches the engine" : "· differs"}</span>
        </div>
      )}

      <Stepper i={i} max={len} playing={playing} setI={setI} toggle={toggle} unit="number" />

      <div className="unembed-note">
        row(<b>{text(cand.id)}</b>) is the same row the embedding step looked up at the start (tied
        embeddings). the model scores each token by how closely the final vector matches that token's
        own vector — the closer the match, the higher the logit.
      </div>
    </div>
  );
}
