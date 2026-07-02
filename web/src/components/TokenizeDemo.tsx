import { useEffect, useState, type ReactNode } from "react";
import { getMerges } from "../api";
import { useAutoplay } from "../autoplay";
import { litToken } from "../lib";
import { Stepper } from "./Stepper";
import type { ExplainCtx } from "./Explanations";
import type { Merges, Pretoken } from "../types";

/* The tokenization "aha", one word at a time. The prompt is split into
   pre-tokens; this demo focuses on ONE of them and steps its real byte-pair
   merges (in rank order) from byte-level characters into the tokens the model
   reads — so the split→merge is legible instead of flying by. A context line
   shows the whole prompt's tokens with the active word lit; prev/next walk the
   words. Pure render over the merge trace from /api/v1/merges (fetched only when
   this interactive is open). Autoplays the active word (pausable; static under
   reduced-motion). */

/** a pre-token's final display pieces (== its tokens' text) */
const finalPieces = (p: Pretoken) => (p.steps.length ? p.steps[p.steps.length - 1].result : p.start);

export function TokenizeDemo({ ctx }: { ctx: ExplainCtx }) {
  // signature of the resident prompt; refetch when it changes
  const promptSig = ctx.trace.tokens
    .slice(0, ctx.trace.n_prompt)
    .map((t) => t.id)
    .join(",");
  const [m, setM] = useState<Merges | null>(null);
  const [wi, setWi] = useState(0);

  useEffect(() => {
    let dead = false;
    setM(null);
    getMerges()
      .then((d) => {
        if (dead) return;
        setM(d);
        // default to the first word that actually merges (skip lone-token punctuation)
        const first = d.pretokens.findIndex((p) => p.steps.length > 0);
        setWi(first < 0 ? 0 : first);
      })
      .catch(() => !dead && setM(null));
    return () => {
      dead = true;
    };
  }, [promptSig]);

  if (!m) return <div className="tok-status">loading the merges…</div>;
  const pts = m.pretokens;
  const active = pts[Math.min(wi, pts.length - 1)];

  return (
    <div className="tok-demo">
      {/* the whole prompt as its tokens; the active word is lit. click to switch. */}
      <div className="tok-context-cap">the prompt, as its final tokens · click a word to watch it form</div>
      <div className="tok-context">
        {pts.map((p, j) => (
          <button
            key={j}
            className={"tok-word" + (j === wi ? " active" : "")}
            title={`pre-token ${j}`}
            onClick={() => setWi(j)}
          >
            {finalPieces(p).map((piece, x) => {
              const lt = litToken(piece);
              return (
                <span key={x} className={lt.literal ? "geo-lit" : undefined}>
                  {lt.text}
                </span>
              );
            })}
          </button>
        ))}
      </div>

      {/* keyed by wi so useAutoplay restarts cleanly on each word */}
      <WordMerge key={wi} word={active} />

      <div className="tok-nav">
        <button disabled={wi <= 0} onClick={() => setWi(wi - 1)}>
          ‹ prev word
        </button>
        <span className="tok-nav-where">
          word <b>{wi + 1}</b> / {pts.length}
        </span>
        <button disabled={wi >= pts.length - 1} onClick={() => setWi(wi + 1)}>
          next word ›
        </button>
      </div>
    </div>
  );
}

/** One pre-token collapsing: byte-level → each real merge → the final token(s). */
function WordMerge({ word }: { word: Pretoken }) {
  const total = word.steps.length;
  const { i: k, playing, setI, toggle } = useAutoplay(total, { stepMs: 700 });
  const isDone = k >= total;

  const pieces = k === 0 ? word.start : word.steps[k - 1].result;
  const justMerged = k > 0 ? word.steps[k - 1] : null;
  const mergedText = justMerged ? justMerged.left + justMerged.right : null;
  const wordText = litToken(word.start.join(""));

  let label: ReactNode;
  if (total === 0) {
    label = (
      <>
        {disp(word.start.join(""))} is already a single token · id{" "}
        <b>{word.tokens[0]}</b>
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
        <span className="tok-merged">{disp(mergedText!)}</span> · rank {justMerged.rank}
      </>
    );
  }

  return (
    <div className="tok-word-demo">
      <div className="tok-word-title">
        now merging: <b className={wordText.literal ? "geo-lit" : undefined}>{wordText.text}</b>
      </div>

      <div className="tok-row">
        {pieces.map((piece, x) => {
          const lt = litToken(piece);
          const just = mergedText !== null && piece === mergedText && firstMatch(pieces, mergedText) === x;
          const raw = !isDone && piece.length <= 1;
          return (
            <span
              key={x}
              className={"tok-piece" + (raw ? " raw" : "") + (just ? " just" : "") + (isDone ? " done" : "")}
            >
              <span className={lt.literal ? "geo-lit" : undefined}>{lt.text}</span>
              {isDone && <span className="tok-id">{word.tokens[x]}</span>}
            </span>
          );
        })}
      </div>

      <div className="tok-label">{label}</div>

      {total > 0 && (
        <Stepper i={k} max={total} playing={playing} setI={setI} toggle={toggle} unit="merge" />
      )}
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
