import { useEffect, useState, type ReactNode } from "react";
import { getMerges } from "../api";
import { useAutoplay } from "../autoplay";
import { litToken } from "../lib";
import { Stepper } from "./Stepper";
import type { ExplainCtx } from "./Explanations";
import type { Merges, Pretoken } from "../types";

/* The tokenization "aha", one word at a time on ONE timeline. The prompt is
   split into pre-tokens; a single stepper walks every word's real byte-pair
   merges in order — each word still collapses alone (byte level → merges →
   its final token), the slider just carries on into the next word. A context
   line shows the whole prompt's tokens with the active word lit; clicking a
   word jumps the timeline to it. Raw bytes that are not yet a full character
   render as their real hex (<0xE3>), never as a lossy replacement char. Pure
   render over the merge trace from /api/v1/merges (fetched only when this
   interactive is open); play is manual, static under reduced-motion. */

/** a pre-token's final display pieces (== its tokens' text) */
const finalPieces = (p: Pretoken) => (p.steps.length ? p.steps[p.steps.length - 1].result : p.start);

/** a mid-merge piece that is still raw bytes: a single byte-level char, or
 *  bytes of an unfinished multibyte character shown as hex */
const isRawPiece = (piece: string) => piece.length <= 1 || /^(<0x[0-9A-Fa-f]{2}>)+$/.test(piece);

export function TokenizeDemo({ ctx }: { ctx: ExplainCtx }) {
  // signature of the resident prompt; refetch when it changes
  const promptSig = ctx.trace.tokens
    .slice(0, ctx.trace.n_prompt)
    .map((t) => t.id)
    .join(",");
  const [m, setM] = useState<Merges | null>(null);

  useEffect(() => {
    let dead = false;
    setM(null);
    getMerges()
      .then((d) => !dead && setM(d))
      .catch(() => !dead && setM(null));
    return () => {
      dead = true;
    };
  }, [promptSig]);

  if (!m) return <div className="tok-status">loading the merges…</div>;
  return <MergeTimeline key={promptSig} pts={m.pretokens} />;
}

/** One stepper over every word: word j owns frames [offset[j], offset[j] +
 *  steps[j]] — local frame 0 is its byte-level start (or, for a word that is
 *  already one token, its only frame) and the last is its finished state. */
function MergeTimeline({ pts }: { pts: Pretoken[] }) {
  const offsets: number[] = [];
  let sum = 0;
  for (const p of pts) {
    offsets.push(sum);
    sum += p.steps.length + 1;
  }
  const max = sum - 1;
  const { i: g, playing, setI, toggle } = useAutoplay(max, { stepMs: 400 });

  // start on the first word that actually merges (skip lone-token punctuation)
  useEffect(() => {
    const first = pts.findIndex((p) => p.steps.length > 0);
    if (first > 0) setI(offsets[first]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // global frame → (word, its local merge count)
  let wi = 0;
  while (wi + 1 < pts.length && g >= offsets[wi + 1]) wi++;
  const k = g - offsets[wi];
  const word = pts[wi];

  return (
    <div className="tok-demo">
      {/* one accumulating sentence: finished words keep their final tokens,
          the active word collapses in place, upcoming words wait as ghost
          text — by the last frame the whole prompt stands tokenized. */}
      <div className="tok-context-cap">
        each word collapses in turn and stays · click any word to jump
      </div>
      <div className="tok-flow">
        {pts.map((p, j) => {
          if (j > wi) {
            // not reached yet: the raw text, ghosted
            const lt = litToken(p.start.join(""));
            return (
              <button
                key={j}
                className="tok-ghost"
                title="not yet tokenized — click to skip ahead"
                onClick={() => setI(offsets[j])}
              >
                <span className={lt.literal ? "geo-lit" : undefined}>{lt.text}</span>
              </button>
            );
          }
          const done = j < wi || k >= p.steps.length;
          const pieces = j < wi || k === 0 ? (j < wi ? finalPieces(p) : p.start) : p.steps[k - 1].result;
          const justMerged = j === wi && k > 0 ? p.steps[k - 1] : null;
          const mergedText = justMerged ? justMerged.left + justMerged.right : null;
          return (
            <button
              key={j}
              className={"tok-wgroup" + (j === wi ? " active" : "")}
              title={`pre-token ${j} — click to replay`}
              onClick={() => setI(offsets[j])}
            >
              {pieces.map((piece, x) => {
                const lt = litToken(piece);
                const just =
                  j === wi && mergedText !== null && piece === mergedText && pieces.indexOf(mergedText) === x;
                const raw = !done && isRawPiece(piece);
                return (
                  <span
                    key={x}
                    className={"tok-piece" + (raw ? " raw" : "") + (just ? " just" : "") + (done ? " done" : "")}
                  >
                    <span className={lt.literal ? "geo-lit" : undefined}>{lt.text}</span>
                    {done && <span className="tok-id">{p.tokens[x]}</span>}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>

      <ActionLabel word={word} k={k} />

      <Stepper i={g} max={max} playing={playing} setI={setI} toggle={toggle} unit="step" />
    </div>
  );
}

/** The one-line narration for the active word at local frame `k`: byte-level
 *  start (k=0) → each real merge → its final token(s). */
function ActionLabel({ word, k }: { word: Pretoken; k: number }) {
  const total = word.steps.length;
  const isDone = k >= total;
  const justMerged = k > 0 && !(k > total) ? word.steps[k - 1] : null;
  // name the word by its final text (start pieces can be raw hex bytes)
  const wordText = litToken(finalPieces(word).join(""));

  let label: ReactNode;
  if (total === 0) {
    label = (
      <>
        already a single token · id <b>{word.tokens[0]}</b>
      </>
    );
  } else if (k === 0) {
    label = "byte-level: every character starts as its own piece.";
  } else if (isDone) {
    label = (
      <>
        done ·{" "}
        {finalPieces(word).map((piece, x) => (
          <span key={x} className="tok-final">
            {disp(piece)} <span className="tok-id">{word.tokens[x]}</span>
          </span>
        ))}
      </>
    );
  } else if (justMerged) {
    label = (
      <>
        merge <span className="tok-pair">{disp(justMerged.left)}</span> +{" "}
        <span className="tok-pair">{disp(justMerged.right)}</span> →{" "}
        <span className="tok-merged">{disp(justMerged.left + justMerged.right)}</span> · rank{" "}
        {justMerged.rank}
      </>
    );
  }

  return (
    <div className="tok-label">
      <b className={wordText.literal ? "geo-lit" : undefined}>{wordText.text}</b> · {label}
    </div>
  );
}

// whitespace visible in the labels too
function disp(s: string): string {
  return litToken(s).text;
}
