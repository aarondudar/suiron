import { esc, q } from "../lib";
import { BandHeader } from "./BandHeader";
import { Explain } from "./Explainer";
import { SUB } from "./Explanations";
import type { Sel } from "../types";

function DrawBar({ sel }: { sel: Sel & { r: number } }) {
  const survivors = sel.cand.filter((c) => !c.cut && c.pf > 0);
  let cum = 0;
  const segs = survivors.map((c) => {
    const seg = (
      <div
        key={c.id}
        className={"draw-seg" + (c.id === sel.chosen ? " chosen" : "")}
        style={{ width: `${c.pf * 100}%` }}
        title={`${esc(c.t)}  [${(cum * 100).toFixed(1)}%, ${((cum + c.pf) * 100).toFixed(1)}%)`}
      />
    );
    cum += c.pf;
    return seg;
  });

  return (
    <div className="draw-wrap">
      <div className="draw-bar" data-explain-el="draw-bar">
        {segs}
        {cum < 0.999 && (
          <div
            className="draw-seg rest"
            style={{ width: `${(1 - cum) * 100}%` }}
            title={`… ${((1 - cum) * 100).toFixed(1)}% spread over the remaining survivors`}
          />
        )}
        <div className="draw-r" style={{ left: `${Math.min(sel.r, 0.999) * 100}%` }} />
      </div>
    </div>
  );
}

export function Selection({ sel, isPrompt }: { sel?: Sel; isPrompt: boolean }) {
  const body = !sel ? (
    <div className="sel-math">
      {isPrompt
        ? "prompt token. you typed this one, the model did not choose it. the model only predicts the tokens that come after it (see the band above)."
        : "no selection recorded for this position."}
    </div>
  ) : (
    <SelDetail sel={sel} />
  );

  return (
    <section>
      <BandHeader
        idx="03"
        title={
          <>
            how this token was chosen <Explain of="draw" />
          </>
        }
        sub={SUB.selection}
      />
      <div>{body}</div>
    </section>
  );
}

function SelDetail({ sel }: { sel: Sel }) {
  const greedy = sel.r === null;
  const chosen = sel.cand.find((c) => c.id === sel.chosen) ?? sel.cand[0];
  const maxLogit = sel.cand[0]?.logit ?? 0;

  if (sel.forced) {
    const fav = sel.cand[0];
    const wanted = fav && fav.id !== sel.chosen;
    return (
      <div className="sel-math">
        <span className="red">you</span> forced <span className="red">{q(chosen.t)}</span>{" "}
        here, so no sampling happened.{" "}
        {wanted ? (
          <>
            the model's own favorite was <b>{q(fav.t)}</b> at{" "}
            <b>{(fav.p * 100).toFixed(1)}%</b>
            {chosen.p > 0 && (
              <>
                {" "}(it gave your pick <b>{(chosen.p * 100).toFixed(1)}%</b>)
              </>
            )}
            .
          </>
        ) : (
          <>your pick matched the model's own favorite.</>
        )}{" "}
        every token after this point is the model continuing from the history{" "}
        <b>you</b> changed. the math is the same, the history is not.
      </div>
    );
  }

  return (
    <>
      <div className="sel-params">
        {greedy ? (
          <>greedy (temp <b>0</b>): the highest logit wins, with no randomness</>
        ) : (
          <>
            temp <b>{sel.temp}</b> · top-k <b>{sel.top_k}</b> · top-p <b>{sel.top_p}</b> ·
            seed <b>{sel.seed}</b> · draw r = <b>{sel.r!.toFixed(4)}</b>
          </>
        )}
      </div>

      <div className="tbl-scroll">
      <table className="sel">
        <thead>
          <tr>
            <th>candidate</th>
            <th>logit</th>
            <th>p @ temp</th>
            <th>final p</th>
            <th>fate</th>
          </tr>
        </thead>
        <tbody>
          {sel.cand.map((c) => {
            const cls = c.id === sel.chosen ? "chosen" : c.cut ? "cut" : "";
            const fate =
              c.id === sel.chosen
                ? "selected"
                : c.cut
                  ? `cut by ${c.cut}`
                  : greedy
                    ? "lower logit"
                    : "not drawn";
            return (
              <tr className={cls} key={c.id}>
                <td>{esc(c.t)}</td>
                <td>{c.logit.toFixed(3)}</td>
                <td>{c.cut === "top-k" ? "—" : `${(c.p * 100).toFixed(2)}%`}</td>
                <td>{c.cut ? "—" : `${(c.pf * 100).toFixed(2)}%`}</td>
                <td>{fate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {greedy ? (
        <div className="sel-math">
          argmax: <span className="red">{q(chosen.t)}</span> has the highest logit (
          <b>{chosen.logit.toFixed(3)}</b>), so it is selected deterministically. rerunning
          this prompt will always produce the same token.
        </div>
      ) : (
        <>
          <DrawBar sel={sel as Sel & { r: number }} />
          <div className="sel-math">
            p(<span className="red">{q(chosen.t)}</span>) = e^((
            {chosen.logit.toFixed(2)} − {maxLogit.toFixed(2)}) / {sel.temp}) / Σ ={" "}
            <b>{(chosen.p * 100).toFixed(2)}%</b>
            {chosen.pf !== chosen.p && (
              <>
                {" "}→ renormalized to <b>{(chosen.pf * 100).toFixed(2)}%</b> after cuts
              </>
            )}
            . the random draw <b>r = {sel.r!.toFixed(4)}</b> (from seed {sel.seed}) lands in{" "}
            <span className="red">{q(chosen.t)}</span>'s segment of the bar above. that is the
            whole reason this token is the one that came out.
          </div>
        </>
      )}
    </>
  );
}
