import { useMemo } from "react";
import { esc, moments, q, shadowTrace } from "../lib";
import type { Trace } from "../types";

/* The counterfactual microscope (docs/22): after a fork, the engine keeps the
   replaced run's tail as a shadow, so both futures can be read side by side.
   Everything here is the two runs' real recorded data — the shadow was
   computed when it was the live run; nothing is recomputed or invented. */

const TOPN = 6;

/** one run's next-token distribution at the compared position */
function DistCol({
  title,
  chosen,
  top,
  ghost,
}: {
  title: string;
  /** the token this run actually has at the compared position (marks its bar) */
  chosen: number | null;
  top: [number, string, number][];
  /** the discarded run renders dimmer */
  ghost?: boolean;
}) {
  const rows = top.slice(0, TOPN);
  const pmax = rows.length ? rows[0][2] : 1;
  return (
    <div className={"fd-col" + (ghost ? " ghost" : "")}>
      <div className="fd-col-title">{title}</div>
      {rows.map(([id, text, p]) => (
        <div className={"fd-row" + (id === chosen ? " win" : "")} key={id}>
          <span className="fd-tokname">{esc(text)}</span>
          <div className="fd-barwrap">
            <div className="fd-bar" style={{ width: `${((p / pmax) * 100).toFixed(1)}%` }} />
          </div>
          <span className="fd-p">{(p * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function ForkDiff({
  trace,
  cur,
  setCur,
  dim,
}: {
  trace: Trace;
  cur: number;
  setCur: (i: number) => void;
  /** another band hosts the open concept card: recede with band 01 */
  dim?: boolean;
}) {
  const shadow = useMemo(() => shadowTrace(trace), [trace]);
  if (!shadow || !trace.fork) return null;
  const pos = trace.fork.pos;

  // both tails, from the fork point; the prefix is one shared history
  const lead = Math.max(0, pos - 3);
  const lane = (t: Trace, kind: "shadow" | "live") =>
    t.tokens.slice(pos).map((tok, i) => {
      const p = pos + i;
      const isCur = kind === "live" && p === cur;
      const isCmp = p === cur;
      return (
        <button
          key={p}
          className={
            "fd-tok" +
            (kind === "shadow" ? " ghost" : "") +
            (isCur ? " cur" : isCmp ? " cmp" : "") +
            (p === pos ? " first" : "")
          }
          title={`inspect position ${p}`}
          onClick={() => setCur(Math.min(p, trace.tokens.length - 1))}
        >
          {esc(tok.t)}
        </button>
      );
    });

  // the paired read at the inspected position (the fork point or later)
  const at = cur >= pos ? cur : null;
  const sEnded = at !== null && at >= shadow.tokens.length;
  const sProd = at !== null && !sEnded ? shadow.steps[at - 1] : null;
  const lProd = at !== null ? trace.steps[at - 1] : null;
  const sChosen = at !== null && !sEnded ? shadow.tokens[at].id : null;
  const lChosen = at !== null ? trace.tokens[at]?.id ?? null : null;
  const sLock = at !== null && !sEnded ? moments(shadow, at - 1).find((m) => m.kind === "attention") : null;
  const lLock = at !== null ? moments(trace, at - 1).find((m) => m.kind === "attention") : null;

  return (
    <section className={"forkdiff" + (dim ? " dimmed" : "")}>
      <div className="fd-head">
        ⑂ forked at {pos} · both futures, one different choice; the model continued each for real.
      </div>

      <div className="fd-lanes">
        <div className="fd-lane-label ghost">original · discarded</div>
        <div className="fd-lane">
          {lead > 0 && <span className="fd-ellipsis">…</span>}
          {trace.tokens.slice(lead, pos).map((tok, i) => (
            <span key={lead + i} className="fd-tok shared">
              {esc(tok.t)}
            </span>
          ))}
          <span className="fd-split">⑂</span>
          {lane(shadow, "shadow")}
        </div>
        <div className="fd-lane-label">fork · live</div>
        <div className="fd-lane">
          {lead > 0 && <span className="fd-ellipsis">…</span>}
          {trace.tokens.slice(lead, pos).map((tok, i) => (
            <span key={lead + i} className="fd-tok shared">
              {esc(tok.t)}
            </span>
          ))}
          <span className="fd-split">⑂</span>
          {lane(trace, "live")}
        </div>
      </div>

      {at === null ? (
        <div className="fd-hint">
          click a token at or after the fork to compare what each run predicted
        </div>
      ) : sEnded ? (
        <div className="fd-hint">the original run had already ended at position {at}</div>
      ) : (
        <>
          <div className="fd-cmp-head">
            {at === pos ? (
              <>
                position {pos}, where the paths split: one prediction, two choices. The original
                run took {q(shadow.tokens[at].t)}; the fork forced {q(trace.tokens[at]?.t ?? "")}.
              </>
            ) : (
              <>
                position {at}: after {at - pos} token{at - pos === 1 ? "" : "s"} of divergence,
                the two histories now predict differently.
              </>
            )}
          </div>
          <div className="fd-cols">
            {sProd && <DistCol title="the original run predicted" chosen={sChosen} top={sProd.top} ghost />}
            {lProd && <DistCol title="the forked run predicted" chosen={lChosen} top={lProd.top} />}
          </div>
          {(sLock || lLock) && at > pos && (
            <div className="fd-locks">
              {sLock && (
                <div className="fd-lock ghost">original: {sLock.label}</div>
              )}
              {lLock && <div className="fd-lock">fork: {lLock.label}</div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
