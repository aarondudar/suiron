/* All the explanatory copy in one place, so the voice can be tuned without
   touching component logic. JSX (not .ts) because the copy uses <b> emphasis.
   Voice: plain language, real terms defined in passing, no em-dashes, no
   out-of-scope analogies. */
import type { ReactNode } from "react";
import { confidence, layerGlance, q } from "../lib";
import type { FocusTarget, GenParams, Sel, Step, Trace } from "../types";
import { EngineSource } from "./EngineSource";
import { StageMath, type Stage } from "./StageMath";
import { TemperatureDemo } from "./TemperatureDemo";

/* always-on one-line subtitle under each band's title (depth 0). orientation,
   not explanation — the Explainer is the on-demand depth. */
export const SUB = {
  prompt: "type some text and choose how the model continues it.",
  tokens: "your text, split into the pieces the model reads. click one to inspect it.",
  logits: "the model's ranked guesses for the next token.",
  selection: "how the model goes from ranked guesses to one actual token.",
  layers: "the token's vector flows through every layer in order; each one reads the earlier tokens. open a layer for its heads and math.",
  quant: "the same model stored in fewer bytes, and the speed that buys.",
};

/* ---------------------------------------------------------------------------
   The concept registry.

   Everything an explanation needs is assembled once per render into ExplainCtx
   (every field trace-derived; nothing here triggers an engine call). A Concept
   turns that context into prose grounded in the CURRENT token, optional deeper
   rungs, an optional embedded demo, and what to light up while it is open.

   The Explainer renders a concept GENERICALLY — intro(ctx), rungs.map(body),
   interactive(ctx), highlight(ctx) — and never branches on which concept it is.
   So adding the top-k / top-p demos later is purely new entries here plus an
   <Explain of="…"/> anchor: a new `interactive` body, no type or surface change.
   --------------------------------------------------------------------------- */

export interface ExplainCtx {
  trace: Trace;
  cur: number; // inspected token position
  step: Step; // trace.steps[cur]
  sel?: Sel; // step.sel (undefined for a prompt token)
  params: GenParams; // live generation settings
  layer: number; // focused layer (openLayer, else a sensible default)
}

/** one on-demand depth level. `body` is universal: prose, this token's real
 *  numbers, reused engine source, or a demo — a new kind of depth is a new
 *  body, never a new type. */
export interface ExplainRung {
  label: string;
  body: (c: ExplainCtx) => ReactNode;
}

export interface Concept {
  id: string;
  title: string;
  intro: (c: ExplainCtx) => ReactNode; // plain language, grounded in THIS token
  rungs?: ExplainRung[]; // optional deeper levels
  highlight?: (c: ExplainCtx) => FocusTarget; // what to light up while open
  interactive?: (c: ExplainCtx) => ReactNode; // optional embedded demo
}

/** a "the code" rung that reuses the live engine source endpoint. */
const code = (fn: string): ExplainRung => ({ label: "the code", body: () => <EngineSource fn={fn} /> });

/** a "the math" rung: this token's real numbers for one compute stage, fetched
 *  on demand (the old band-05 math, relocated to the single depth surface). */
const mathRung = (stage: Stage): ExplainRung => ({
  label: "the math",
  body: (c) => <StageMath ctx={c} stage={stage} />,
});

const tok = (c: ExplainCtx, p: number) => q(c.trace.tokens[p]?.t ?? "");

export const CONCEPTS: Record<string, Concept> = {
  model: {
    id: "model",
    title: "what this is",
    highlight: () => ({ kind: "el", ref: "spec" }),
    intro: (c) => (
      <>
        a language model does just one thing: given some text, it gives <b>every</b> token in its
        fixed dictionary a score for how likely it is to come next, then picks one. everything else
        on this page is how it computes that score well. this model is Qwen3-0.6B:{" "}
        <b>{c.trace.layers}</b> layers stacked in order, <b>{c.trace.heads}</b> attention heads (
        {c.trace.kv_heads} key/value groups), each token carried as <b>1,024</b> numbers, and a
        dictionary of <b>151,936</b> possible tokens. keep that dictionary in mind; the whole story
        comes back to it.
      </>
    ),
  },

  settings: {
    id: "settings",
    title: "the settings",
    highlight: () => ({ kind: "el", ref: "ctl-params" }),
    intro: (c) => {
      const p = c.params;
      return (
        <>
          these change how the model commits to a token once it has the scores, not what the model
          knows. <b>temperature {p.temp}</b> sets how evenly it treats its options (0 always takes
          the top one). <b>top-k {p.top_k}</b> keeps only that many options; <b>top-p {p.top_p}</b>{" "}
          keeps the smallest set that covers that much probability; <b>seed {p.seed}</b> fixes the
          randomness so a run repeats exactly. <b>backend {p.backend}</b> picks which arithmetic runs
          (same answer, different speed). change one and re-run to see the choice change.
        </>
      );
    },
  },

  tokenization: {
    id: "tokenization",
    title: "tokens",
    highlight: (c) => ({ kind: "token", pos: c.cur }),
    intro: (c) => {
      const t = c.trace.tokens[c.cur];
      return (
        <>
          the model only knows the pieces in its dictionary, so the first job is always to chop your
          text into them. these pieces are <b>tokens</b>, common chunks of text: frequent words are
          usually one token, rarer words get split into a few. your text became{" "}
          {c.trace.tokens.length} of them. the token you are inspecting, number {c.cur}, is{" "}
          {q(t?.t ?? "")}, which is entry <b>{t?.id}</b> in that fixed dictionary of 151,936 tokens.
        </>
      );
    },
  },

  confidence: {
    id: "confidence",
    title: "confidence",
    highlight: (c) => ({ kind: "token", pos: c.cur }),
    rungs: [code("softmax")],
    intro: (c) => {
      const conf = confidence(c.trace, c.cur);
      if (conf === null)
        return (
          <>
            this is a prompt token, one you typed. the model did not generate it, so it has no
            confidence to show. select a generated token (anything after your prompt) to see how
            sure the model was when it produced it.
          </>
        );
      return (
        <>
          the small bar and the brightness under a generated token show how sure the model was when
          it picked it. here it gave {tok(c, c.cur)} a probability of <b>{(conf * 100).toFixed(1)}%</b>.
          a bright, full bar means it was confident; a short, dim one means it was choosing among
          many roughly equal options. this number is the probability from the step that produced
          this token, run through <b>softmax</b>.
        </>
      );
    },
  },

  embedding: {
    id: "embedding",
    title: "the token becomes a vector",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    rungs: [mathRung("embedding"), code("embedding")],
    intro: (c) => (
      <>
        a token id is just a number, and you cannot do math with "entry 8251". so the model looks it
        up in a big table that has <b>one row per dictionary entry</b>, getting a row of{" "}
        <b>1,024 numbers</b> it learned during training. that row is the token's starting meaning,
        and it is what flows into the stack of layers. as the token passes through, information from
        the earlier tokens gets added on top of it. {q(c.trace.tokens[c.cur]?.t ?? "")} is the
        vector entering layer 0 here. keep this table in mind: it comes back at the very end.
      </>
    ),
  },

  attention: {
    id: "attention",
    title: "attention",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    rungs: [mathRung("attention"), code("attention")],
    intro: (c) => {
      const g = c.cur > 0 ? layerGlance(c.step, c.layer, c.cur + 1) : null;
      return (
        <>
          to predict what comes next, a token has to use its context, the words before it. at each
          layer every token looks back at the earlier tokens and pulls in information from the ones
          that matter. this looking-back is called <b>attention</b>, and it is the only step where
          tokens share information. the dots in band 02 show where each layer looked, bigger meaning
          more attention and red the strongest.{" "}
          {g ? (
            <>
              for this token, layer {c.layer} attended hardest back to {tok(c, g.topPos)} (
              <b>{(g.share * 100).toFixed(0)}%</b> of its attention).
            </>
          ) : (
            <>the first token has nothing earlier to look at, so there is no attention to show.</>
          )}
        </>
      );
    },
  },

  feedforward: {
    id: "feedforward",
    title: "feed-forward",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    rungs: [mathRung("feedforward"), code("ffn")],
    intro: () => (
      <>
        after a token has read the others through attention, each token is processed on its own. its{" "}
        <b>1,024</b> numbers are expanded to <b>3,072</b>, each passed through a function called{" "}
        <b>silu</b> that decides how much of it to keep, then squeezed back down to 1,024. no other
        tokens are involved in this step. this is where most of the model's learned facts live.
      </>
    ),
  },

  residual: {
    id: "residual",
    title: "the residual stream",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    rungs: [code("forward")],
    intro: (c) => {
      const r = c.step.rnorm ?? [];
      const last = r.length - 1;
      return (
        <>
          one layer only refines the meaning a little, so the model stacks <b>{c.trace.layers}</b>{" "}
          of them and the token passes through every one. a layer does not replace the token's
          numbers, it <b>adds</b> its result onto a running total called the <b>residual stream</b>.
          the number on the right of each layer row is how big that running total has grown, measured
          as its rms (root mean square, a single number for the overall size of the 1,024 values).
          here it climbs from <b>{r[0]?.toFixed(1)}</b> at layer 0 to <b>{r[last]?.toFixed(1)}</b> at
          the top, as understanding accumulates.
        </>
      );
    },
  },

  logits: {
    id: "logits",
    title: "what the model expects next",
    highlight: () => ({ kind: "el", ref: "logit-0" }),
    rungs: [code("matmul")],
    intro: (c) => {
      const top = c.step.top ?? [];
      const a = top[0];
      const b = top[1];
      let read: ReactNode = null;
      if (a && b) {
        const gap = a[2] - b[2];
        read =
          gap > 0.5 ? (
            <>
              {" "}
              here it is a runaway: {q(a[1])} at <b>{(a[2] * 100).toFixed(0)}%</b>, far ahead of
              everything else.
            </>
          ) : gap < 0.08 ? (
            <>
              {" "}
              here it is nearly a tie: {q(a[1])} at <b>{(a[2] * 100).toFixed(0)}%</b> against{" "}
              {q(b[1])} at <b>{(b[2] * 100).toFixed(0)}%</b>.
            </>
          ) : (
            <>
              {" "}
              here {q(a[1])} leads at <b>{(a[2] * 100).toFixed(0)}%</b>, with {q(b[1])} behind at{" "}
              <b>{(b[2] * 100).toFixed(0)}%</b>.
            </>
          );
      }
      return (
        <>
          once the token has passed through all the layers, the model holds one final 1,024-number
          vector. here is the trick that ties it together: to score the next token it compares that
          vector against <b>every row of the same dictionary table that turned tokens into vectors at
          the start</b>. the dictionary is used at both ends, once to read the text and once to score
          what comes next. a closer match is a higher score (a <b>logit</b>); <b>softmax</b> turns
          all 151,936 scores into probabilities that add up to 100%.{read} click a bar to{" "}
          <b>force</b> that token instead and watch the model keep going from your choice.
        </>
      );
    },
  },

  temperature: {
    id: "temperature",
    title: "temperature",
    highlight: () => ({ kind: "el", ref: "ctl-temp" }),
    rungs: [code("softmax")],
    interactive: (c) => (c.sel ? <TemperatureDemo cand={c.sel.cand} temp={c.sel.temp} /> : null),
    intro: (c) => {
      if (!c.sel)
        return (
          <>
            <b>temperature</b> controls how evenly the model treats its options when it commits to
            one token. select a generated token to see it applied to a real distribution and try the
            slider.
          </>
        );
      return (
        <>
          <b>temperature</b> reshapes the probabilities just before the random draw. low temperature
          sharpens them toward the single top pick; high temperature flattens them so less likely
          tokens get a real chance. at temperature 0 there is no randomness at all. this token was
          produced at temperature <b>{c.sel.temp}</b>. drag the slider below to watch this token's
          own options re-balance.
        </>
      );
    },
  },

  topk: {
    id: "topk",
    title: "top-k",
    highlight: () => ({ kind: "el", ref: "ctl-topk" }),
    // post-v2: a TopKDemo interactive drops in here as one more entry, no reshape.
    intro: (c) => (
      <>
        <b>top-k</b> keeps only the k highest-scoring tokens and discards the rest before the draw
        {c.sel ? (
          <>
            ; this token used k = <b>{c.sel.top_k}</b>
          </>
        ) : null}
        . it is a hard cap that stops the model from ever picking something wildly unlikely, no
        matter how the randomness falls.
      </>
    ),
  },

  topp: {
    id: "topp",
    title: "top-p",
    highlight: () => ({ kind: "el", ref: "ctl-topp" }),
    // post-v2: a TopPDemo interactive drops in here the same way.
    intro: (c) => (
      <>
        <b>top-p</b> (also called nucleus) keeps the smallest group of top tokens whose
        probabilities add up to p, then draws only from those
        {c.sel ? (
          <>
            ; this token used p = <b>{c.sel.top_p}</b>
          </>
        ) : null}
        . unlike top-k it adapts to the moment: a confident step keeps just a few options, an
        uncertain one keeps more.
      </>
    ),
  },

  draw: {
    id: "draw",
    title: "the random draw",
    highlight: () => ({ kind: "el", ref: "draw-bar" }),
    intro: (c) => {
      if (!c.sel)
        return (
          <>
            this is a prompt token, so nothing was drawn. select a generated token to see how a
            single random number turns the ranked options into one actual choice.
          </>
        );
      if (c.sel.r === null)
        return (
          <>
            a ranking is not yet a choice, so the model has to commit to one token. at temperature 0
            there is no randomness: the highest-scoring survivor always wins, and this token was
            chosen that way. raise the temperature to turn this step into a weighted random draw with
            a visible bar.
          </>
        );
      return (
        <>
          a ranking is not yet a choice, so the model commits to one token. after the cuts, the
          surviving tokens line up on a bar, each owning a slice as wide as its probability. one
          random number, <b>r = {c.sel.r.toFixed(4)}</b> (fixed by the seed), lands in exactly one
          slice and picks the winner: {tok(c, c.cur)}. same seed, same r, same token every time.
        </>
      );
    },
  },

  loop: {
    id: "loop",
    title: "and then it repeats",
    highlight: (c) => ({ kind: "token", pos: c.cur }),
    rungs: [code("forward")],
    intro: (c) => {
      const t = q(c.trace.tokens[c.cur]?.t ?? "");
      return (
        <>
          a language model only ever predicts <b>one</b> next token. once it is chosen it is added to
          the end of the text, and the whole process you just watched runs again from the top, now
          reading everything including the token it just wrote. that single repeated step is how a
          few words become whole paragraphs. {t} was one full pass through the model; the next token
          is another. generation is nothing more than the one function from the start — score the
          dictionary, pick one — run over and over.
        </>
      );
    },
  },

  quantization: {
    id: "quantization",
    title: "quantization",
    highlight: () => ({ kind: "el", ref: "ctl-backend" }),
    intro: (c) => {
      const tps = c.trace.tps ?? { f32: null, q8: null };
      const params = 596_049_920; // Qwen3-0.6B
      const gib = (b: number) => (b / 1024 ** 3).toFixed(2);
      const f32 = gib(params * 4);
      const q8 = gib((params * 34) / 32); // 34 bytes per 32 weights
      return (
        <>
          a model is a big pile of numbers called <b>weights</b>, and they can be stored at different
          sizes. <b>f32</b> keeps each weight as a full 32-bit number, so {f32} GiB has to move
          through memory for every token. <b>q8</b> stores each weight in 8 bits, a quarter of the
          size, so the same work moves only {q8} GiB. speed here is limited by how fast numbers can
          be read from memory, so moving fewer of them is most of why q8 is faster.{" "}
          {tps.f32 && tps.q8 ? (
            <>
              measured on this machine: <b>{tps.f32.toFixed(1)}</b> vs <b>{tps.q8.toFixed(1)}</b>{" "}
              tok/s.
            </>
          ) : (
            <>run both backends to measure the difference live.</>
          )}{" "}
          q8 is a lossy approximation that lands on the same prediction (checked against f32); only
          the speed differs.
        </>
      );
    },
  },
};
