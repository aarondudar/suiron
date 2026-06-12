import { esc } from "../lib";
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
      <div className="draw-bar">
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
        ? "prompt token — given by you, not chosen by the model. the model only predicts what follows it (see the band above)."
        : "no selection recorded for this position."}
    </div>
  ) : (
    <SelDetail sel={sel} />
  );

  return (
    <section>
      <div className="label">
        <span className="idx">03</span>
        how this token was chosen
        <span className="note">
          {" "}— the sampler's actual decision pipeline for the current token, with the real
          numbers: logits → ÷temperature → softmax → top-k/top-p cuts → one uniform random
          draw lands in a segment
        </span>
      </div>
      <div>{body}</div>
    </section>
  );
}

function SelDetail({ sel }: { sel: Sel }) {
  const greedy = sel.r === null;
  const chosen = sel.cand.find((c) => c.id === sel.chosen) ?? sel.cand[0];
  const maxLogit = sel.cand[0]?.logit ?? 0;

  return (
    <>
      <div className="sel-params">
        {greedy ? (
          <>greedy (temp <b>0</b>) — the highest logit wins, no randomness</>
        ) : (
          <>
            temp <b>{sel.temp}</b> · top-k <b>{sel.top_k}</b> · top-p <b>{sel.top_p}</b> ·
            seed <b>{sel.seed}</b> · draw r = <b>{sel.r!.toFixed(4)}</b>
          </>
        )}
      </div>

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

      {greedy ? (
        <div className="sel-math">
          argmax: <span className="red">{esc(chosen.t)}</span> has the highest logit (
          <b>{chosen.logit.toFixed(3)}</b>), so it is selected deterministically. rerunning
          this prompt will always produce the same token.
        </div>
      ) : (
        <>
          <DrawBar sel={sel as Sel & { r: number }} />
          <div className="sel-math">
            p(<span className="red">{esc(chosen.t)}</span>) = e^((
            {chosen.logit.toFixed(2)} − {maxLogit.toFixed(2)}) / {sel.temp}) / Σ ={" "}
            <b>{(chosen.p * 100).toFixed(2)}%</b>
            {chosen.pf !== chosen.p && (
              <>
                {" "}→ renormalized to <b>{(chosen.pf * 100).toFixed(2)}%</b> after cuts
              </>
            )}
            . the uniform draw <b>r = {sel.r!.toFixed(4)}</b> (from seed {sel.seed}) lands in{" "}
            <span className="red">{esc(chosen.t)}</span>'s segment of the cumulative bar above —
            that is the entire reason this token exists in the output.
          </div>
        </>
      )}
    </>
  );
}
