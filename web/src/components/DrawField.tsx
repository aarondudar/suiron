import { useEffect, useState } from "react";
import { getOdds } from "../api";
import { esc } from "../lib";
import type { Sel } from "../types";

/* "draws one", as an instrument (design-31, rebuilt design-35): the hat the
   step's copy describes, drawn as one whole divided. Each token's slice is its
   real share of the WHOLE vocabulary at the current temperature, and the last
   slice is everything the model did not shortlist — so the bar sums to 1 rather
   than to whatever happened to be on screen. Drag the dial and watch the shares
   redraw: at 0 one slice takes the bar (greedy), higher and the mass floods out
   to the also-rans. The token this run drew wears the red. Every width comes
   from the engine; the run's own temperature and draw are stated below.

   It was a cluster of discs on a sphere: area was a real share, but where a disc
   sat meant nothing, and the shares were renormalized over the fourteen shown,
   which overstated every one of them. */

const MAX = 14; // slices named individually (top survivors by logit); the rest is one slice

export function DrawField({
  sel,
  chosenId,
  pos,
}: {
  sel: Sel;
  chosenId: number;
  /** the position that produced this token. With it the read line can quote the
   *  share over the WHOLE vocabulary at the dialled temperature; without it the
   *  line shows no percentage at all, rather than the share-among-the-discs it
   *  used to print as if it were the model's odds (design-34, A1). */
  pos?: number;
}) {
  const [temp, setTemp] = useState(sel.temp);
  /* a forced token was never drawn: its trace keeps the model's real shares
     (p) but not the logits (stamped 0), so the temperature math has nothing
     true to work with — show the real shares, retire the dial */
  const forced = sel.forced;
  const surv = forced
    ? [...sel.cand].sort((a, b) => b.p - a.p).slice(0, MAX)
    : sel.cand
        .filter((c) => c.cut === "")
        .sort((a, b) => b.logit - a.logit)
        .slice(0, MAX);
  const ready = surv.length > 0;

  /* the client-side softmax that used to size the discs is gone with them: it
     normalized over the candidates on screen, which is exactly the overstatement
     design-34 removed from the prose. Every share here now comes from the engine
     over the whole vocabulary (design-35). */
  const chosenIdx = surv.findIndex((c) => c.id === chosenId);
  const chosenW = chosenIdx >= 0 ? surv[chosenIdx].p : 0; // forced only: the recorded share
  const chosenTok = chosenIdx >= 0 ? esc(surv[chosenIdx].t) : "";

  /* One request per temperature, not three. The read line used to ask for the
     chosen token's share on its own, which meant a second round trip for a number
     already inside `shares` below — and each round trip was a forward pass plus
     the unembed. The engine now memoizes the logits per position, so a drag costs
     ~2ms instead of ~400ms; asking once keeps it that way (Aaron, 2026-08-14:
     "a lot of lag when sliding the temperature"). */

  /* At temperature 0 the share is always 100% — but that is the DIAL collapsing
     onto the top pick, not the model being certain, and a reader who arrives on
     the run's own temp 0 would otherwise take it for confidence. So temp 0 also
     names the model's own odds (its share at temperature 1, the conventional
     reading of "how sure it is"). Aaron, 2026-08-10: "the copy should reflect
     temp 0 accurately". Cached, so this costs one extra forward at most. */
  const greedy = temp <= 0;
  const [base, setBase] = useState<number | null>(null);
  useEffect(() => {
    if (forced || pos === undefined || chosenIdx < 0 || !greedy) return;
    let dead = false;
    getOdds(pos, 1, [chosenId]).then((p) => !dead && setBase(p ? p[0] : null));
    return () => {
      dead = true;
    };
  }, [forced, pos, chosenId, chosenIdx, greedy]);

  /* every shown candidate's exact share at this temperature, so the bar below is
     a true partition: the segments plus "everything else" sum to 1 (design-35).
     Forced positions have their logits stamped 0, so there is nothing to score —
     they fall back to the shares the trace recorded, which is what the storyboard's
     forced-token ruling says those are. */
  const [shares, setShares] = useState<number[] | null>(null);
  useEffect(() => {
    if (forced || pos === undefined) return;
    let dead = false;
    const ids = surv.map((c) => c.id);
    const h = setTimeout(() => {
      getOdds(pos, temp, ids).then((p) => !dead && p && setShares(p));
    }, 40);
    return () => {
      dead = true;
      clearTimeout(h);
    };
    // surv is derived from sel.cand; its ids are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced, pos, temp, sel.cand]);

  const parts = forced ? surv.map((c) => c.p) : shares;
  const shown = parts ? parts.reduce((a, b) => a + b, 0) : 0;
  const rest = parts ? Math.max(0, 1 - shown) : 0;
  // the read line's number is the chosen token's slice of the very same bar
  const exact = parts && chosenIdx >= 0 ? (parts[chosenIdx] ?? null) : null;

  if (!ready)
    return (
      <div className="fl-status" role="status">
        prompt token — you supplied it, the model did not draw it
      </div>
    );

  return (
    <div className="fl-spacewrap">
      <div className="fl-space fl-space-draw">
        {/* the hat, drawn as one whole divided (design-35). The step's own copy
            calls this "pulling a ticket from a weighted hat" and "a probability
            is just the share of tickets" — so the picture is now that sentence:
            one bar, each token's slice its real share of the WHOLE vocabulary,
            with the rest of the vocabulary as the last slice so the bar honestly
            sums to 1. Was a cluster of discs on `sphereDirs`, where the loudest
            channel (where a disc sat) meant nothing at all. */}
        <div className="fl-tickets" role="img" aria-label="every token's share of the draw">
          {parts ? (
            <>
              {surv.map((c, i) => (
                <div
                  key={c.id}
                  className={"fl-tk" + (i === chosenIdx ? (forced ? " forced" : " won") : "")}
                  style={{ width: `${parts[i] * 100}%` }}
                  title={`${esc(c.t)} · ${(parts[i] * 100).toFixed(1)}%`}
                >
                  <span className="fl-tk-lab">{esc(c.t)}</span>
                </div>
              ))}
              <div
                className="fl-tk rest"
                style={{ width: `${rest * 100}%` }}
                title={`every other token · ${(rest * 100).toFixed(1)}%`}
              >
                <span className="fl-tk-lab">everything else</span>
              </div>
            </>
          ) : (
            <div className="fl-tk pending" style={{ width: "100%" }} />
          )}
        </div>
        <div className="fl-space-ov fl-space-ctx">
          {forced ? "suiron · draws one · forced" : `suiron · draws one · temp ${temp.toFixed(2)}`}
        </div>
        <div className="fl-space-ov fl-space-read">
          {forced ? (
            <>
              the model gave <span className="w">“{chosenTok}”</span>{" "}
              <span className="p">{(chosenW * 100).toFixed(1)}%</span> of the odds · you forced it
            </>
          ) : (
            greedy ? (
              <>
                at temp 0.00 the dial gives <span className="w">“{chosenTok}”</span> the whole draw
                {base !== null && (
                  <>
                    {" "}
                    · the model's own odds on it are{" "}
                    <span className="p">{(base * 100).toFixed(0)}%</span>
                  </>
                )}
              </>
            ) : (
              <>
                at temp {temp.toFixed(2)}, <span className="w">“{chosenTok}”</span>
                {exact !== null && (
                  <>
                    {" "}
                    holds <span className="p">{(exact * 100).toFixed(0)}%</span> of the odds
                  </>
                )}
              </>
            )
          )}
        </div>
      </div>
      {!forced && (
        <div className="fl-temp">
          <span>temp</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={temp}
            onChange={(e) => setTemp(parseFloat(e.target.value))}
            aria-label="temperature"
          />
          <span className="fl-temp-v">{temp.toFixed(2)}</span>
        </div>
      )}
      {/* The old line explained that disc AREA was a share among the candidates
          shown while the printed percentage was a share of the vocabulary — two
          different measures needing reconciling. There are no discs now, and no
          two measures: every slice width and the percentage above are the same
          full-vocabulary share, so the reconciliation is deleted rather than
          reworded (2026-08-14). What is left is the fact the picture cannot
          state — what this run actually did. */}
      <div className="fl-space-honest">
        {forced ? (
          <>nothing was drawn at this position — you forced this token</>
        ) : (
          <>
            on this run it drew at temp {sel.temp.toFixed(2)}
            {sel.r == null ? " (greedy — the top by rule)" : `, landing at r = ${sel.r.toFixed(3)}`}
          </>
        )}
      </div>
    </div>
  );
}
