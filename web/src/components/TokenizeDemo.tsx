import { useEffect, useState } from "react";
import { getMerges } from "../api";
import { litToken } from "../lib";
import type { ExplainCtx } from "./Explanations";
import type { Merges } from "../types";

/* The tokenization "aha", running: the prompt text starts as byte-level pieces
   and collapses through its real byte-pair merges, in merge-rank order, into the
   tokens the model reads. Each step names the pair and its real rank; the merged
   piece is marked. Pure render over the merge trace from /api/v1/merges (fetched
   only when this interactive is open). The end state is exactly the trace's
   tokens. prefers-reduced-motion shows the finished split. */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const totalOf = (m: Merges) => m.pretokens.reduce((a, p) => a + p.steps.length, 0);

export function TokenizeDemo({ ctx }: { ctx: ExplainCtx }) {
  // signature of the resident prompt; refetch when it changes
  const promptSig = ctx.trace.tokens
    .slice(0, ctx.trace.n_prompt)
    .map((t) => t.id)
    .join(",");
  const [m, setM] = useState<Merges | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let dead = false;
    setM(null);
    getMerges()
      .then((d) => {
        if (dead) return;
        setM(d);
        setStep(REDUCED ? totalOf(d) : 0);
      })
      .catch(() => !dead && setM(null));
    return () => {
      dead = true;
    };
  }, [promptSig]);

  if (!m) return <div className="tok-status">loading the merges…</div>;

  const pts = m.pretokens;
  const total = totalOf(m);
  const k = Math.min(step, total);
  const done = k >= total;

  // resolve each pre-token's piece list at global step k (pre-tokens merge left
  // to right, fully, in turn — exactly how encode processes them)
  // the merge applied at global step k (for the label). Computed in an outer
  // loop, not inside the map callback, so its type narrows correctly.
  let current: { left: string; right: string; rank: number; merged: string } | null = null;
  {
    let c = 0;
    for (const p of pts) {
      if (k > c && k <= c + p.steps.length) {
        const s = p.steps[k - c - 1];
        current = { left: s.left, right: s.right, rank: s.rank, merged: s.left + s.right };
        break;
      }
      c += p.steps.length;
    }
  }

  let prev = 0;
  const rows = pts.map((p) => {
    const localDone = Math.max(0, Math.min(k - prev, p.steps.length));
    const pieces = localDone === 0 ? p.start : p.steps[localDone - 1].result;
    const isCurrent = k > prev && k <= prev + p.steps.length;
    const mergedText =
      isCurrent && localDone > 0 ? p.steps[localDone - 1].left + p.steps[localDone - 1].right : null;
    const atEnd = localDone === p.steps.length;
    prev += p.steps.length;
    return { pieces, mergedText, atEnd, tokens: p.tokens };
  });

  let label: React.ReactNode;
  if (k === 0) label = "byte-level: every character starts as its own piece.";
  else if (done)
    label = (
      <>
        done: the {pts.reduce((a, p) => a + p.tokens.length, 0)} tokens the model reads.
      </>
    );
  else if (current)
    label = (
      <>
        merge <span className="tok-pair">{disp(current.left)}</span> +{" "}
        <span className="tok-pair">{disp(current.right)}</span> →{" "}
        <span className="tok-merged">{disp(current.merged)}</span> · rank {current.rank}
      </>
    );

  return (
    <div className="tok-demo">
      <div className="tok-rows">
        {rows.map((r, j) => (
          <div className="tok-row" key={j}>
            {r.pieces.map((piece, i) => {
              const lt = litToken(piece);
              const just = r.mergedText !== null && piece === r.mergedText && firstMatch(r.pieces, r.mergedText) === i;
              return (
                <span key={i} className={"tok-piece" + (just ? " just" : "")}>
                  <span className={lt.literal ? "geo-lit" : undefined}>{lt.text}</span>
                  {done && r.atEnd && r.tokens.length === r.pieces.length && (
                    <span className="tok-id">{r.tokens[i]}</span>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="tok-label">{label}</div>

      <div className="tok-ctl">
        <span className="tok-where">
          step <b>{k}</b> / {total}
        </span>
        <button onClick={() => setStep(Math.max(0, k - 1))} disabled={k <= 0}>
          ◀
        </button>
        <button onClick={() => setStep(Math.min(total, k + 1))} disabled={done}>
          ▶ merge
        </button>
        <button onClick={() => setStep(Math.min(total, k + 5))} disabled={done}>
          +5
        </button>
        <button onClick={() => setStep(total)} disabled={done}>
          to tokens
        </button>
        <button onClick={() => setStep(0)} disabled={k === 0}>
          reset
        </button>
      </div>
    </div>
  );
}

// whitespace visible in the labels too
function disp(s: string): string {
  return litToken(s).text;
}
function firstMatch(pieces: string[], text: string): number {
  return pieces.indexOf(text);
}
