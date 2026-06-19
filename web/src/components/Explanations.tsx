/* All the explanatory copy in one place, so the voice can be tuned without
   touching component logic. JSX (not .ts) because the copy uses <b> emphasis.
   Voice: plain language, real terms defined in passing, no em-dashes, no
   out-of-scope analogies. */
import type { ReactNode } from "react";
import { confidence, layerGlance, q } from "../lib";
import type { FocusTarget, GenParams, Sel, Step, Trace } from "../types";
import { EngineSource } from "./EngineSource";
import { TemperatureDemo } from "./TemperatureDemo";

/* always-on one-line subtitle under each band's title (depth 0). orientation,
   not explanation — the Explainer is the on-demand depth. */
export const SUB = {
  prompt: "type some text and choose how the model continues it.",
  tokens: "your text, split into the pieces the model reads. click one to inspect it.",
  logits: "the model's ranked guesses for the next token.",
  selection: "how the model goes from ranked guesses to one actual token.",
  layers: "what each layer looked at, from the first layer to the last.",
  machine: "the real math that turned this token into a prediction.",
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

const tok = (c: ExplainCtx, p: number) => q(c.trace.tokens[p]?.t ?? "");

export const CONCEPTS: Record<string, Concept> = {
  tokenization: {
    id: "tokenization",
    title: "tokens",
    highlight: (c) => ({ kind: "token", pos: c.cur }),
    intro: (c) => {
      const t = c.trace.tokens[c.cur];
      return (
        <>
          the model does not read letters or whole words. it reads <b>tokens</b>, common chunks of
          text. your text became {c.trace.tokens.length} of them. frequent words are usually one
          token, and rarer words get split into a few. the token you are inspecting, number{" "}
          {c.cur}, is {q(t?.t ?? "")}, which is entry <b>{t?.id}</b> in the model's fixed list of
          151,936 possible tokens.
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

  attention: {
    id: "attention",
    title: "attention",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    rungs: [code("attention")],
    intro: (c) => {
      const g = c.cur > 0 ? layerGlance(c.step, c.layer, c.cur + 1) : null;
      return (
        <>
          the model is a stack of layers and the text passes through them in order. at each layer
          every token looks back at earlier tokens and pulls in information from the ones that
          matter. this looking-back is called <b>attention</b>. the dots in band 04 show where each
          layer looked, bigger meaning more attention and red the strongest.{" "}
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
          each layer does not replace the token's numbers, it <b>adds</b> its result onto a running
          total called the <b>residual stream</b>. the number on the right of each layer row is how
          big that running total has grown, measured as its rms (root mean square, a single number
          for the overall size of the 1,024 values). here it climbs from <b>{r[0]?.toFixed(1)}</b>{" "}
          at layer 0 to <b>{r[last]?.toFixed(1)}</b> at the top, as the model piles on information.
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
          once the token has passed through all the layers, the model gives a score (a <b>logit</b>)
          to every token in its vocabulary, about 152,000 of them. <b>softmax</b> turns those scores
          into probabilities that add up to 100%. this is the model's honest ranking before any
          randomness.{read} click a bar to <b>force</b> that token instead and watch the model keep
          going from your choice.
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
            at temperature 0 there is no draw: the highest-scoring survivor always wins, and this
            token was chosen that way. raise the temperature to turn this step into a weighted random
            draw with a visible bar.
          </>
        );
      return (
        <>
          after the cuts, the surviving tokens line up on a bar, each owning a slice as wide as its
          probability. one random number, <b>r = {c.sel.r.toFixed(4)}</b> (fixed by the seed), lands
          in exactly one slice and picks the winner: {tok(c, c.cur)}. same seed, same r, same token
          every time.
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

/* ---------------------------------------------------------------------------
   band 05 "the machine" — per-stage cards. Each `plain` takes the same context
   object (some stages ignore it) so the component can call them uniformly.
   These stay as the deepest always-available view; the Explainer's rungs reuse
   the same engine source the cards do.
   --------------------------------------------------------------------------- */
export interface MachineCtx {
  nTokens: number;
  cur: number;
  tokText: string;
  tokId: number | undefined;
  layer: number;
}

export const MACHINE: Record<string, { title: string; plain: (c: MachineCtx) => ReactNode }> = {
  tokenize: {
    title: "1 · tokenize",
    plain: (c) => (
      <>
        your text was split into {c.nTokens} tokens, each one looked up in the model's fixed list
        of 151,936 possible tokens. the token you are inspecting, number {c.cur}, is {c.tokText},
        which is entry {c.tokId} in that list.
      </>
    ),
  },
  meaning: {
    title: "2 · token meaning",
    plain: (c) => (
      <>
        each token's id points to a row of 1,024 numbers the model learned during training. that
        row is the token's starting meaning. as it moves through the layers, information from
        other tokens gets added in. those 1,024 numbers (a vector) are what enters layer {c.layer}.
      </>
    ),
  },
  normalize: {
    title: "3 · normalize (rmsnorm)",
    plain: () => (
      <>
        before the next step the 1,024 numbers are rescaled to a consistent size. their
        proportions stay the same, only the overall scale changes. this keeps the values from
        growing or shrinking too much as they pass through layer after layer. the step is called
        rmsnorm.
      </>
    ),
  },
  attention: {
    title: "4 · attention",
    plain: () => (
      <>
        this is the step where the token reads the earlier tokens. it builds a <b>query</b> from
        its own numbers, and every earlier token offers a <b>key</b> and a <b>value</b>. comparing
        the query to each key gives a score for how relevant that token is. <b>softmax</b> turns
        the scores into percentages, and the token takes a blend of the values weighted by those
        percentages. this is the only step where tokens share information.
      </>
    ),
  },
  feedforward: {
    title: "5 · feed-forward (swiglu)",
    plain: () => (
      <>
        after reading context, the token is processed on its own. its 1,024 numbers are expanded
        to 3,072, each passed through a function called <b>silu</b> that decides how much of it to
        keep, then squeezed back down to 1,024. no other tokens are involved in this step.
      </>
    ),
  },
  score: {
    title: "6 · score every token",
    plain: () => (
      <>
        after the last layer, the final 1,024 numbers are compared against the stored meaning of
        every token in the vocabulary, one comparison each. a closer match means a higher score.
        those scores are exactly what band 02 shows, and the choice among them is band 03. so this
        is the same ending you already saw.
      </>
    ),
  },
};
