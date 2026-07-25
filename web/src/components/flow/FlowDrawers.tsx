import { esc, litToken, shadowTrace } from "../../lib";
import type { ExplainCtx } from "../Explanations";
import type { Trace } from "../../types";
import { AttentionInteractive } from "../AttentionInteractive";
import { EmbeddingRow } from "../EmbeddingRow";
import { ExplainerProvider, HotVarScope } from "../Explainer";
import { GeometryCard } from "../Geometry";
import { HeadField } from "../HeadField";
import { KvCacheDemo } from "../KvCacheDemo";
import { LensClimb } from "../LensClimb";
import { RmsNormDemo } from "../RmsNormDemo";
import { RopeDemo } from "../RopeDemo";
import { TemperatureDemo } from "../TemperatureDemo";
import { TokenizeDemo } from "../TokenizeDemo";
import { TopKDemo } from "../TopKDemo";
import { TopPDemo } from "../TopPDemo";
import { UnderHood } from "../UnderHood";
import { UnembedDemo } from "../UnembedDemo";
import { pickAnchor } from "../TokenSpace";
import { NOOP_EXPLAINER } from "./parts";

/* Every drawer body, in dock order (docs/design.md's map; copy from the script
   + addendum, verbatim). Split out of Flow.tsx (audit follow-up) — the shell
   owns the state, this owns the composition. */

/** the sampling drawer shows one knob at a time — the flow's own law applied
 *  inside the drawer (three stacked demos would bury the idea) */
export const KNOBS = ["temperature", "top-k", "top-p"] as const;
export type Knob = (typeof KNOBS)[number];

export interface DrawerBodyProps {
  drawer: string;
  trace: Trace;
  flowCtx: ExplainCtx | null;
  cur: number;
  frontier: number;
  busy: boolean;
  demo: boolean;
  knob: Knob;
  setKnob: (k: Knob) => void;
  pickTok: number | null;
  setPickTok: (p: number | null) => void;
  ffnLayer: number;
  setFfnLayer: (l: number) => void;
  openGoLive: () => void;
  /** force candidate `id` at `cur` — the shell owns the fork + view reset */
  onFork: (id: number) => void;
}

export function DrawerBody(p: DrawerBodyProps) {
  const {
    drawer,
    trace,
    flowCtx,
    cur,
    frontier,
    busy,
    demo,
    knob,
    setKnob,
    pickTok,
    setPickTok,
    ffnLayer,
    setFfnLayer,
    openGoLive,
    onFork,
  } = p;

  if (drawer === "dot" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            How hard to look is a single number, and here is the arithmetic that makes it. Each
            token carries a list of numbers called a vector. The current token asks with one
            vector, the query; each earlier token answers with another, the key. Multiply them
            piece by piece, add it up, and that is the score.
          </p>
          <p className="fl-d-do">Step the multiply-and-add to the end.</p>
        </div>
        <AttentionInteractive ctx={flowCtx} />
      </>
    );
  if (drawer === "merges" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            The tokenizer builds tokens by merging, over and over, the pair of neighbouring
            pieces it has seen together most often. These are the real merges for your text, in
            the real order.
          </p>
          <p className="fl-d-do">Step through the merges.</p>
          <p className="fl-d-proof">
            The pieces you end on are exactly the tokens the model reads. Same ids, same order,
            checked against the engine.
          </p>
        </div>
        <TokenizeDemo ctx={flowCtx} />
      </>
    );
  if (drawer === "meaning" && flowCtx) {
    // default = the same anchor as the step's meaning space (the produced
    // answer), so the step and its drawer tell one story; the chip row is
    // the visible, deliberate override
    const mPos = Math.max(0, Math.min(pickTok ?? pickAnchor(flowCtx.trace), frontier));
    const mCtx = { ...flowCtx, cur: mPos };
    return (
      <ExplainerProvider value={NOOP_EXPLAINER}>
        <div className="fl-drawer-note fl-d">
          <p>
            Each token is looked up as a vector, a long list of numbers that places it on the
            model's map of meaning. Nearby points mean similar things.
          </p>
          <p className="fl-d-do">Pick a token and see its closest neighbours on that map.</p>
          <p className="fl-d-proof">
            These neighbours are computed from the model's own numbers, not a thesaurus.
          </p>
        </div>
        <div className="fl-pick-row">
          {flowCtx.trace.tokens.map((tok, i) => (
            <button
              key={i}
              className={"fl-chip pickable" + (i === mPos ? " on" : "")}
              title={`id ${tok.id} · pos ${i}`}
              onClick={() => setPickTok(i)}
            >
              {esc(tok.t)}
            </button>
          ))}
        </div>
        <EmbeddingRow ctx={mCtx} />
        <GeometryCard ctx={mCtx} read="meaning" />
      </ExplainerProvider>
    );
  }
  if (drawer === "sampling" && flowCtx?.sel?.forced)
    // a forced token kept the model's shares but not its logits, so the dials
    // would reshape fiction — say so instead of pretending
    return (
      <div className="fl-stub">
        you forced this token, so there was no draw to bend. step to a token the model drew and
        the dials come back.
      </div>
    );
  if (drawer === "sampling" && flowCtx?.sel) {
    const sel = flowCtx.sel;
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            Three dials shape the draw. Temperature sharpens or flattens the shares. Top-k throws
            away all but the k likeliest tickets. Top-p keeps just enough tickets to cover a share
            p.
          </p>
          <p className="fl-d-do">Drag each dial and watch the odds redraw, live.</p>
          <p className="fl-d-proof">
            These are the engine's probabilities recomputed at each setting, not an illustration.
          </p>
        </div>
        <div className="seg fl-knob-seg">
          {KNOBS.map((k) => (
            <button
              key={k}
              className={"seg-opt" + (knob === k ? " on" : "")}
              onClick={() => setKnob(k)}
            >
              {k}
            </button>
          ))}
        </div>
        {knob === "temperature" && (
          <TemperatureDemo cand={sel.cand} temp={sel.temp} chosen={sel.chosen} />
        )}
        {knob === "top-k" && (
          <TopKDemo cand={sel.cand} k={sel.top_k} temp={sel.temp} chosen={sel.chosen} />
        )}
        {knob === "top-p" && (
          <TopPDemo cand={sel.cand} p={sel.top_p} temp={sel.temp} chosen={sel.chosen} />
        )}
      </>
    );
  }
  if (drawer === "sampling" && flowCtx)
    // there IS a run — a missing sel means a prompt token, and no amount of
    // stepping will ever give this position a draw
    return (
      <div className="fl-stub">
        you supplied this token, so there was no draw. step to a token the model drew.
      </div>
    );
  if (drawer === "sampling")
    return <div className="fl-stub">no recorded draw at this position. run a step first.</div>;
  if (drawer === "fork" && flowCtx) {
    const top = (flowCtx.step.top ?? []).slice(0, 6);
    const chosenId = flowCtx.trace.tokens[cur]?.id;
    // "picked" is the model's word; a token a human forced says so
    const forcedHere = !!flowCtx.trace.steps[cur]?.sel?.forced;
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            The draw could have landed elsewhere. Pick any candidate the model did not choose and
            make history go that way instead; the model continues for real from there.
          </p>
          <p className="fl-d-do">Click a grey candidate.</p>
          <p className="fl-d-proof">
            Both futures ran through the same engine. At the fork the odds were identical; only
            the draw differed.
          </p>
        </div>
        <div className="fl-fork-opts">
          {top.map(([id, t, p2]) => (
            <button
              key={id}
              className={"fl-fork-opt" + (id === chosenId ? " picked" : "")}
              disabled={id === chosenId || busy}
              onClick={() => {
                if (demo) {
                  // the recording can't rewrite history — that needs the engine
                  openGoLive();
                  return;
                }
                onFork(id);
              }}
            >
              <span className="fl-fork-tok">{esc(t)}</span>
              <span className="fl-fork-p">{(p2 * 100).toFixed(1)}%</span>
              {id === chosenId && (
                <span className="fl-fork-tag">{forcedHere ? "forced" : "picked"}</span>
              )}
            </button>
          ))}
        </div>
        {/* the payoff, right where the choice was made: once a fork lands, both
            futures appear side by side here — no jump, the tour resumes from
            this sub-step (Aaron, 2026-07-24: the old phase-5 teleport buried
            the comparison and lost the reader's place) */}
        {busy && (
          <div className="fl-status" role="status">
            the model is running…
          </div>
        )}
        {!busy && trace.fork && <WorldsPair trace={trace} />}
      </>
    );
  }
  if (drawer === "worlds" && trace.fork) {
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            You forked history earlier, or can now. Here both futures sit side by side: same
            model, same odds at the fork, different draw.
          </p>
          <p className="fl-d-do">Compare the two sentences token by token.</p>
          <p className="fl-d-proof">
            Both ran through the same engine; the divergence is only the draw.
          </p>
        </div>
        <WorldsPair trace={trace} />
      </>
    );
  }
  if (drawer === "ffn" && flowCtx) {
    const nL = flowCtx.trace.layers;
    const at = ffnLayer >= 0 ? Math.min(ffnLayer, nL - 1) : flowCtx.layer;
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            After looking back, each token is reworked on its own: its vector is expanded,
            filtered, and compressed back. Unlike looking back, this step moves nothing between
            words.
          </p>
          <p className="fl-d-do">Watch which of the 3,072 filters fire for this token.</p>
          <p className="fl-d-proof">The activations shown are read from the run.</p>
        </div>
        <div className="attn-controls">
          <label className="uh-sel">
            layer{" "}
            <input
              type="number"
              min={0}
              max={nL - 1}
              value={at}
              onChange={(e) => setFfnLayer(Math.min(nL - 1, Math.max(0, +e.target.value)))}
            />
          </label>
        </div>
        <HotVarScope>
          <UnderHood ctx={flowCtx} stage="feedforward" layer={at} head={0} />
        </HotVarScope>
      </>
    );
  }
  if (drawer === "unembed" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            The final vector is compared against every token the model knows. Each comparison is
            one number, a logit; softmax turns the whole list into probabilities.
          </p>
          <p className="fl-d-do">Scrub the list and watch scores become shares.</p>
          <p className="fl-d-proof">The shares equal the engine's, and they sum to 1.</p>
        </div>
        <UnembedDemo ctx={flowCtx} />
      </>
    );
  if (drawer === "rmsnorm" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            Twenty-eight rounds of arithmetic would blow the numbers up or shrink them to
            nothing. Before each move, the layer rescales the token's vector to a steady size.
            That rescaling is called RMSNorm.
          </p>
          <p className="fl-d-do">Watch one real vector get rescaled.</p>
          <p className="fl-d-proof">
            The rescaled values equal the engine's, and the size after is the same at every layer.
          </p>
        </div>
        <RmsNormDemo ctx={flowCtx} />
      </>
    );
  if (drawer === "residual" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            Each layer does not replace the token's vector, it adds to it. The running total is
            called the residual, and because it exists, you can stop at any layer and read out
            what the model would guess so far. That readout is the climb you just watched; its
            formal name is the logit lens.
          </p>
          <p className="fl-d-do">Drag the layer slider and read the guess at each depth.</p>
          <p className="fl-d-proof">
            At the last layer the readout equals the model's real answer exactly. That is the test
            that keeps this honest.
          </p>
        </div>
        {/* storyboard RULING: "guess by depth" docks the lens-depth reader
            (the layer slider reading the guess at each depth); SignalField
            retired to the expert view, its copy never matched it. */}
        <LensClimb trace={flowCtx.trace} prod={flowCtx.prod} prodStep={flowCtx.step} />
      </>
    );
  if (drawer === "heads" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            The model looks back 16 different ways at once. Each is called a head, and each learns
            its own habit: some watch the previous word, some hunt for repeats, some track
            grammar.
          </p>
          <p className="fl-d-do">Hover a head to see where it looks in your sentence.</p>
          <p className="fl-d-proof">These weights are read from the run, not drawn for effect.</p>
        </div>
        <HeadField trace={flowCtx.trace} step={flowCtx.step} prod={flowCtx.prod} />
      </>
    );
  if (drawer === "rope" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            Word order matters: 'dog bites man' is not 'man bites dog'. Before the scores are
            made, each query and key is rotated by an angle that depends on its position, so the
            same word asks a different question from a different place.
          </p>
          <p className="fl-d-do">Slide the position and watch the rotation.</p>
          <p className="fl-d-proof">
            The rotated values match the engine's, which is how it knows where each word sits.
          </p>
        </div>
        <RopeDemo ctx={flowCtx} />
      </>
    );
  if (drawer === "cache" && flowCtx)
    return (
      <>
        <div className="fl-drawer-note fl-d">
          <p>
            Each pass, only the newest token is new; everything the model worked out about the
            earlier ones is kept in a cache and reused. That is why the loop does not slow down as
            the sentence grows.
          </p>
          <p className="fl-d-do">Step a token and watch one column get added, not recomputed.</p>
          <p className="fl-d-proof">
            The cached values are the ones the engine reads on the next pass.
          </p>
        </div>
        <KvCacheDemo ctx={flowCtx} />
      </>
    );
  return (
    <div className="fl-stub">
      this deep-dive re-homes an existing module here. coming soon, one pass at a time. until
      then it lives in the <a href="?view=expert">expert view</a>.
    </div>
  );
}

/* Both futures side by side: the forked run vs the run it replaced. Shared by
   the fork drawer (inline payoff, right after the click) and the "two worlds"
   handle on the loop step. */
export function WorldsPair({ trace }: { trace: Trace }) {
  if (!trace.fork) return null;
  const shadow = shadowTrace(trace);
  const at = trace.fork.pos;
  if (!shadow)
    return (
      <div className="fl-stub">
        this run's replaced tail wasn't recorded, so the other world can't be shown. fork again
        to compare.
      </div>
    );
  // the replaced token was not always the model's: a second fork replaces a
  // token you forced, and a fork inside the prompt replaces your own text —
  // the tag (and red, the model's colour) must not claim the model chose it
  const shadowForced = !!shadow.steps[at]?.sel?.forced;
  const shadowPrompt = at < shadow.n_prompt;
  const otherTag = shadowPrompt
    ? "your prompt had"
    : shadowForced
      ? "you forced earlier"
      : "the model chose";
  const otherIsModel = !shadowPrompt && !shadowForced;
  const world = (tr: Trace, label: string, tag: string, model: boolean) => (
    <div className="fl-world">
      <div className="fl-world-label">{label}</div>
      <div className="fl-world-chips">
        {tr.tokens.map((tok, i) => (
          <span
            key={i}
            className={
              "fl-chip" +
              (i < at ? " dim" : "") +
              (i === at ? (model ? " new" : " forced") : "")
            }
            title={`id ${tok.id} · pos ${i}`}
          >
            {i === at && <i className="fl-readhead">{tag}</i>}
            {/* the divergence token must be legible even when it is pure
                whitespace — show it the way the geometry labels do */}
            {i === at ? litToken(tok.t).text : esc(tok.t)}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <>
      {world(trace, "this world", "you forced", false)}
      {world(shadow, "the other world", otherTag, otherIsModel)}
    </>
  );
}
