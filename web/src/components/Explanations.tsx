/* All the explanatory copy in one place, so the voice can be tuned without
   touching component logic. JSX (not .ts) because the copy uses <b> emphasis.
   Voice: textbook-clear and authoritative. Sentence case for body prose;
   subtitles, labels, and data stay lowercase. Third-person declarative, with
   imperatives only for real UI actions. Every term is defined once in its home
   concept and reused by name. No em-dashes, no teasers. Canonical terms:
   vocabulary (not "dictionary"), token / token ID, embedding table, residual
   stream, attention, logit, softmax, weights. */
import type { ReactNode } from "react";
import { confidence, layerGlance, q } from "../lib";
import type { FocusTarget, GenParams, Sel, Step, Trace } from "../types";
import { DotProduct } from "./DotProduct";
import { EngineSource } from "./EngineSource";
import { Explain, Term } from "./Explainer";
import { GeometryCard, type Read } from "./Geometry";
import { ModelOverview } from "./ModelOverview";
import { RnormSparkline } from "./RnormSparkline";
import { TokenizeDemo } from "./TokenizeDemo";
import { TemperatureDemo } from "./TemperatureDemo";
import { TopKDemo } from "./TopKDemo";
import { TopPDemo } from "./TopPDemo";
import { UnderHood } from "./UnderHood";

/* always-on one-line subtitle under each band's title (depth 0). orientation,
   not explanation — the Explainer is the on-demand depth. */
export const SUB = {
  prompt: "type some text and choose how the model continues it.",
  tokens: "the input text, split into the pieces the model reads. click one to inspect it.",
  logits: "the model's ranked guesses for the next token.",
  selection: "how the model goes from ranked guesses to one actual token.",
  layers: "the token's vector flows through every layer in order; each one reads the earlier tokens. open a layer for its heads and math.",
  geometry: "every token is a direction in space; the next token is whichever vocabulary vector that direction points at most.",
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

/** a collapsed "geometric picture" rung: the compact geometry card as a coda
 *  (the standalone band carries its prominence; in the drawer it closes the read). */
const geoRung = (read: Read): ExplainRung => ({
  label: "the geometric picture",
  body: (c) => <GeometryCard ctx={c} read={read} />,
});

const tok = (c: ExplainCtx, p: number) => q(c.trace.tokens[p]?.t ?? "");

export const CONCEPTS: Record<string, Concept> = {
  model: {
    id: "model",
    title: "what this is",
    highlight: () => ({ kind: "el", ref: "spec" }),
    intro: (c) => <ModelOverview trace={c.trace} />,
  },

  settings: {
    id: "settings",
    title: "the settings",
    highlight: () => ({ kind: "el", ref: "ctl-params" }),
    intro: () => (
      <>
        These control how the model commits to a token once it has the scores, not what the model
        knows. Each is explained at its own marker: temperature, top-k, and top-p above, the seed at
        the random draw, and the backend under quantization. Change one and re-run to see the choice
        change.
      </>
    ),
  },

  tokenization: {
    id: "tokenization",
    title: "tokens",
    highlight: (c) => ({ kind: "token", pos: c.cur }),
    interactive: (c) => <TokenizeDemo ctx={c} />,
    intro: (c) => {
      const t = c.trace.tokens[c.cur];
      return (
        <>
          The model only reads tokens from its vocabulary, so the first step is to split the input
          text into them. A <b>token</b> is a common chunk of text: frequent words are usually a
          single token, rarer words split into a few. The text became {c.trace.tokens.length} of
          them. The token under inspection, number {c.cur}, is {q(t?.t ?? "")}; its{" "}
          <b>token ID</b> is <b>{t?.id}</b>, its index into the vocabulary of 151,936 tokens. Step
          through the merges below to watch the text collapse, byte pair by byte pair, into exactly
          these tokens.
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
            This is a prompt token, part of the text the run started from, not generated by the
            model, so it has no confidence to show. Select a generated token, any one after the
            prompt, to see how sure the model was when it produced it.
          </>
        );
      return (
        <>
          The bar and the brightness under a generated token show how sure the model was when it
          picked it. Here it gave {tok(c, c.cur)} a probability of{" "}
          <b>{(conf * 100).toFixed(1)}%</b>. A full, bright bar means high confidence; a short, dim
          one means the choice was close among many options. This is the token's <b>softmax</b>{" "}
          probability at the step that produced it.
        </>
      );
    },
  },

  embedding: {
    id: "embedding",
    title: "the token becomes a vector",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => <UnderHood ctx={c} stage="embedding" />,
    rungs: [geoRung("meaning")],
    intro: (c) => (
      <>
        A <Term name="token">token ID</Term> is only an index; there is no arithmetic to perform on
        "entry 8251". The model looks the index up in an{" "}
        <Term name="token_embd">embedding table</Term> with one row per vocabulary entry, each a
        vector of <Term name="h">1,024</Term> numbers learned during training. That row is the
        token's starting
        representation, before any context has been mixed in, and it is what enters the stack of
        layers. As the token passes through, each layer adds information gathered from earlier
        tokens. For the current token, {q(c.trace.tokens[c.cur]?.t ?? "")}, this row is the vector
        entering layer 0. The same table reappears at the final stage, where its rows are reused to
        convert the output vector into a score for every token in the vocabulary.
      </>
    ),
  },

  attention: {
    id: "attention",
    title: "attention",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => (
      <>
        <DotProduct ctx={c} />
        <UnderHood ctx={c} stage="attention" />
      </>
    ),
    intro: (c) => {
      const g = c.cur > 0 ? layerGlance(c.step, c.layer, c.cur + 1) : null;
      return (
        <>
          Predicting the next token requires context, the tokens that came before. <b>Attention</b>{" "}
          is the step that supplies it: at each layer, every token looks back at the earlier tokens
          and pulls in information from the ones that matter. It does this by scoring every earlier
          token, turning those <Term name="scores">scores</Term> into{" "}
          <Term name="weights">weights</Term> with softmax, then blending the tokens by those
          weights. It is the only step where tokens exchange information. The highlighted dots show
          where each layer looked, larger meaning more attention and red the strongest.{" "}
          {g ? (
            <>
              For this token, layer {c.layer} attended hardest back to {tok(c, g.topPos)} (
              <b>{(g.share * 100).toFixed(0)}%</b> of its attention).
            </>
          ) : (
            <>The first token has nothing earlier to look at, so there is no attention to show.</>
          )}
        </>
      );
    },
  },

  feedforward: {
    id: "feedforward",
    title: "feed-forward",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => <UnderHood ctx={c} stage="feedforward" />,
    intro: () => (
      <>
        After attention has mixed in context, each token is processed on its own. Its <b>1,024</b>{" "}
        numbers are expanded to <b>3,072</b> by two projections, a <Term name="gate">gate</Term> and
        an <Term name="up">up</Term>, then a function called <Term name="silu">silu</Term> decides
        how much of each to keep before they are compressed back to 1,024. No other tokens are
        involved. This feed-forward step is where most of the model's learned facts are stored.
      </>
    ),
  },

  residual: {
    id: "residual",
    title: "the residual stream",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => <RnormSparkline step={c.step} layer={c.layer} layers={c.trace.layers} />,
    rungs: [code("forward")],
    intro: (c) => {
      const r = c.step.rnorm ?? [];
      const last = r.length - 1;
      return (
        <>
          A single layer refines the meaning only a little, so the model stacks{" "}
          <b>{c.trace.layers}</b> of them and the token passes through every one. A layer does not
          replace the token's numbers; it <b>adds</b> its result onto a running total called the{" "}
          <b>residual stream</b>. The number at the right of each layer row is the size of that
          running total, its rms (root mean square, one number summarizing the magnitude of the 1,024
          values). It climbs from <b>{r[0]?.toFixed(1)}</b> at layer 0 to{" "}
          <b>{r[last]?.toFixed(1)}</b> at the final layer as information accumulates. The magnitude
          grows, but the prediction itself is a direction:{" "}
          <Explain of="lens" label="watch it resolve layer by layer" />.
        </>
      );
    },
  },

  logits: {
    id: "logits",
    title: "what the model expects next",
    highlight: () => ({ kind: "el", ref: "logit-0" }),
    interactive: (c) => <GeometryCard ctx={c} read="prediction" />,
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
              Here one token runs away with it: {q(a[1])} at <b>{(a[2] * 100).toFixed(0)}%</b>, far
              ahead of the rest.
            </>
          ) : gap < 0.08 ? (
            <>
              {" "}
              Here it is nearly a tie: {q(a[1])} at <b>{(a[2] * 100).toFixed(0)}%</b> against{" "}
              {q(b[1])} at <b>{(b[2] * 100).toFixed(0)}%</b>.
            </>
          ) : (
            <>
              {" "}
              Here {q(a[1])} leads at <b>{(a[2] * 100).toFixed(0)}%</b>, with {q(b[1])} behind at{" "}
              <b>{(b[2] * 100).toFixed(0)}%</b>.
            </>
          );
      }
      return (
        <>
          Once the token has passed through every layer, the model holds one final 1,024-number
          vector. To score the next token it compares that vector against every row of the{" "}
          <b>embedding table</b>, the same table that turned token IDs into vectors at the start: a
          closer match means a higher score. Each raw score is a <b>logit</b>. <b>Softmax</b> then
          turns all 151,936 logits into probabilities that add up to 100%.{read} Click a bar to{" "}
          <b>force</b> that token instead and watch the model continue from that choice. These
          rankings build up gradually: <Explain of="lens" label="watch this prediction form across the layers" />.
        </>
      );
    },
  },

  geometry: {
    id: "geometry",
    title: "the geometry of one prediction",
    highlight: () => ({ kind: "el", ref: "geo" }),
    intro: (c) => {
      const top = c.step.top ?? [];
      const win = top[0];
      return (
        <>
          Every token's <b>1,024</b> numbers are a direction in space, and directions that point a
          similar way mean similar things. This view draws that directly. <b>What it means</b>{" "}
          centers on the inspected token and places its closest vocabulary entries around it, with
          distance set by <b>cosine</b> similarity, so the nearest entries are the ones the
          model treats as most alike. <b>What comes next</b> centers on the direction the token
          produces after every layer and arranges the candidate next-tokens around it by how high
          the model scores each, so the strongest sits closest to the center
          {win ? (
            <>
              ; here it points hardest at {q(win[1])}
            </>
          ) : null}
          . The attention edges show the earlier tokens that built that direction. Distance is the
          only thing the position encodes; the angle around the center is just spacing.
        </>
      );
    },
  },

  lens: {
    id: "lens",
    title: "the prediction, forming",
    highlight: () => ({ kind: "el", ref: "geo" }),
    interactive: (c) => <GeometryCard ctx={c} read="lens" />,
    intro: (c) => {
      const win = c.step.top?.[0];
      return (
        <>
          The residual stream is not only growing in size; it is a prediction resolving. The{" "}
          <b>logit lens</b> asks, at each layer, what the model would predict if it stopped there:
          it applies the final normalization and the same unembedding the output uses, and reads the
          top token.{" "}
          {win ? (
            <>
              By the last layer the top guess is {q(win[1])} at <b>{(win[2] * 100).toFixed(0)}%</b>.{" "}
            </>
          ) : null}
          Drag the layer slider to watch it climb: early layers guess something unrelated, and the
          winner moves to the center as the layers resolve. The layer stack marks where it first
          takes the lead, and the final layer matches the ranked guesses exactly.
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
            <b>Temperature</b> controls how evenly the model treats its options when it commits to a
            token. Select a generated token to see it applied to a real distribution and try the
            slider.
          </>
        );
      return (
        <>
          <b>Temperature</b> reshapes the softmax probabilities just before the random draw. Low
          temperature sharpens them toward the single top token; high temperature flattens them so
          less likely tokens get a real chance; at temperature 0 there is no randomness. This token
          was produced at temperature <b>{c.sel.temp}</b>. Drag the slider to rebalance this token's
          own options.
        </>
      );
    },
  },

  topk: {
    id: "topk",
    title: "top-k",
    highlight: () => ({ kind: "el", ref: "ctl-topk" }),
    interactive: (c) => (c.sel ? <TopKDemo cand={c.sel.cand} k={c.sel.top_k} temp={c.sel.temp} /> : null),
    intro: (c) => (
      <>
        <b>Top-k</b> keeps only the k highest-scoring tokens and discards the rest before the draw
        {c.sel ? (
          <>
            ; this token used k = <b>{c.sel.top_k}</b>
          </>
        ) : null}
        . It is a hard cap that prevents the model from ever selecting a very unlikely token,
        regardless of how the random draw falls.
      </>
    ),
  },

  topp: {
    id: "topp",
    title: "top-p",
    highlight: () => ({ kind: "el", ref: "ctl-topp" }),
    interactive: (c) => (c.sel ? <TopPDemo cand={c.sel.cand} p={c.sel.top_p} temp={c.sel.temp} /> : null),
    intro: (c) => (
      <>
        <b>Top-p</b> (nucleus sampling) keeps the smallest group of top tokens whose probabilities
        add up to p, then draws only from those
        {c.sel ? (
          <>
            ; this token used p = <b>{c.sel.top_p}</b>
          </>
        ) : null}
        . Unlike top-k it adapts to the moment: a confident step keeps just a few options, an
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
            This is a prompt token, so nothing was drawn. Select a generated token to see how a
            single random number turns the ranked options into one choice.
          </>
        );
      if (c.sel.r === null)
        return (
          <>
            A ranking is not yet a choice, so the model must commit to one token. At temperature 0
            there is no randomness: the highest-scoring survivor always wins, and this token was
            chosen that way. Raise the temperature to turn this step into a weighted random draw.
          </>
        );
      return (
        <>
          A ranking is not yet a choice, so the model commits to one token. The surviving tokens line
          up on a bar, each owning a slice as wide as its probability, and one random number lands in
          a single slice and selects it. Here <b>r = {c.sel.r.toFixed(4)}</b>, drawn from the{" "}
          <b>seed</b>, a fixed starting point for the randomness so the same settings reproduce the
          same draw. It selects {tok(c, c.cur)}.
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
          The model predicts only <b>one</b> token at a time. Once a token is chosen it is appended
          to the text, and the entire process repeats from the start, now reading everything
          including the token just written. {t} was one full pass through the model; the next token
          is another. Generation is this single function, score the vocabulary and pick one token,
          run over and over.
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
          The model is a large array of numbers called <b>weights</b>. This file already stores them
          in 8-bit blocks (the Q8_0 format). The two backends read the same blocks but move different
          amounts of memory: <b>f32</b> first expands each weight to a full 32-bit float, so {f32} GiB
          passes through memory for every token, while <b>q8</b> multiplies the 8-bit blocks directly
          and moves only {q8} GiB. Speed here is limited by how fast weights can be read from memory,
          so moving fewer bytes is most of why q8 is faster.{" "}
          {tps.f32 && tps.q8 ? (
            <>
              Measured on this machine: <b>{tps.f32.toFixed(1)}</b> vs <b>{tps.q8.toFixed(1)}</b>{" "}
              tok/s.
            </>
          ) : (
            <>Run both backends to measure the difference live.</>
          )}{" "}
          Both backends use the same numbers and produce the same token; only the memory moved, and
          so the speed, differs.
        </>
      );
    },
  },
};
