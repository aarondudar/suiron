import { esc } from "../lib";
import type { Trace } from "../types";

export function TokenStrip({
  trace,
  cur,
  setCur,
}: {
  trace: Trace;
  cur: number;
  setCur: (i: number) => void;
}) {
  return (
    <section>
      <div className="label">
        tokens — click or ←/→ to step
        <span className="note">
          {" "}— each cell is one token; the text was chopped into these by byte-level BPE.
          dim borders = your prompt, bright borders = generated. red = the position you're inspecting
        </span>
      </div>
      <div className="strip">
        {trace.tokens.map((tok, i) => (
          <span
            key={i}
            className={"tok" + (i >= trace.n_prompt ? " gen" : "") + (i === cur ? " cur" : "")}
            title={`id ${tok.id} · pos ${i}`}
            onClick={() => setCur(i)}
          >
            {esc(tok.t)}
          </span>
        ))}
      </div>
    </section>
  );
}
