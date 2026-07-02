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
import { AttentionInteractive } from "./AttentionInteractive";
import { EngineSource } from "./EngineSource";
import { Explain, Term } from "./Explainer";
import { EmbeddingRow } from "./EmbeddingRow";
import { GeometryCard, type Read } from "./Geometry";
import { KvCacheDemo } from "./KvCacheDemo";
import { ModelOverview } from "./ModelOverview";
import { RmsNormDemo } from "./RmsNormDemo";
import { RnormSparkline } from "./RnormSparkline";
import { RopeDemo } from "./RopeDemo";
import { TokenizeDemo } from "./TokenizeDemo";
import { UnembedDemo } from "./UnembedDemo";
import { TemperatureDemo } from "./TemperatureDemo";
import { TopKDemo } from "./TopKDemo";
import { TopPDemo } from "./TopPDemo";
import { UnderHood } from "./UnderHood";

/* always-on one-line subtitle under each band's title (depth 0). orientation,
   not explanation — the Explainer is the on-demand depth. */
export const SUB = {
  prompt: "type some text and choose how the model continues it.",
  chat: "talk to the resident model: the same loop, run live with the chat template and the q8 backend.",
  tokens: "the input text, split into the pieces the model reads. click one to inspect it.",
  logits: "the model's ranked guesses for this token; the one it picked is highlighted in the strip above.",
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
  cur: number; // inspected token position (its identity, and the draw that picked it)
  prod: number; // the position whose forward pass produced `cur` (cur-1; -1 at the seed)
  step: Step; // the PRODUCING step, trace.steps[prod] — how `cur` was produced
  sel?: Sel; // trace.steps[cur].sel — the draw that picked `cur` (undefined for a prompt token)
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

/** Which band hosts each concept's inline card (docs/16): the explanation
 *  renders inside the module it explains, right under its header. Every concept
 *  MUST have a home (pinned by a test); concepts opened before any tokens exist
 *  fall back to band "00" in App. */
export const CARD_HOME: Record<string, string> = {
  model: "00",
  settings: "00",
  temperature: "00",
  topk: "00",
  topp: "00",
  tokenization: "01",
  confidence: "01",
  loop: "01",
  embedding: "02",
  position: "02",
  norm: "02",
  attention: "02",
  kvcache: "02",
  feedforward: "02",
  residual: "02",
  logits: "03",
  geometry: "04",
  lens: "04",
  draw: "05",
  quantization: "06",
  scaling: "epilogue",
  agents: "epilogue",
};

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
          <b>token ID</b> is <b>{t?.id}</b>, its index into the vocabulary. Step
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
    interactive: (c) => (
      <>
        <EmbeddingRow ctx={c} />
        <UnderHood ctx={c} stage="embedding" />
      </>
    ),
    rungs: [geoRung("meaning")],
    intro: (c) => {
      const t = c.trace.tokens[c.cur];
      return (
        <>
          A <Term name="token">token ID</Term> is only an index; there is no arithmetic to perform on
          "entry 8251". The model looks the index up in an{" "}
          <Term name="token_embd">embedding table</Term> with one row per vocabulary entry, each a
          vector of <Term name="h">1,024</Term> numbers learned during training. That row is the
          token's starting representation, before any context has been mixed in, and it is what
          enters the stack of layers. The lookup for the current token, {q(t?.t ?? "")}, is shown
          below as real numbers. The same table reappears at the final stage, where its rows are reused
          to convert the output vector into a score for every token in the vocabulary: the model
          reads the same table to start and to finish.
        </>
      );
    },
  },

  position: {
    id: "position",
    title: "where the token sits",
    highlight: (c) => ({ kind: "token", pos: c.cur }),
    interactive: (c) => <RopeDemo ctx={c} />,
    rungs: [code("rope")],
    intro: (c) => (
      <>
        A transformer reads every token at once, so order is not built in; it has to be added.
        Attention, the next step, compares tokens using two small vectors each one carries: a{" "}
        <b>query</b> and a <b>key</b>. Before any comparison happens, every query and key is rotated
        by an angle set by its token's position in the sequence (rotary position embedding, or{" "}
        <b>RoPE</b>). This token sits
        at position <b>{c.cur}</b>. The same word rotated for an early position points differently
        from the same word later on, so {q(c.trace.tokens[c.cur]?.t ?? "")} here is not identical to
        the same token elsewhere. The plot below runs that rotation on this token's real query, pair
        by pair; the rotated values are exactly what attention then compares.
      </>
    ),
  },

  norm: {
    id: "norm",
    title: "keeping the size stable",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => <RmsNormDemo ctx={c} />,
    rungs: [code("rmsnorm")],
    intro: (c) => (
      <>
        Before each step inside a layer, first attention and then feed-forward, the token's vector is
        rescaled to a stable overall size (<b>RMSNorm</b>: divide every number by the root mean
        square of its 1,024 values, then scale by a learned weight). Across the{" "}
        <b>{c.trace.layers}</b> stacked layers this keeps the numbers from growing without bound or
        collapsing toward zero, and the same operation runs once more at the very end, before the
        vocabulary scores. Dividing by the rms is a uniform scale: it changes the vector's length,
        not its direction. The worked view below steps it on this token's real numbers.
      </>
    ),
  },

  attention: {
    id: "attention",
    title: "attention",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => <AttentionInteractive ctx={c} />,
    intro: (c) => {
      const g = c.cur > 0 ? layerGlance(c.step, c.layer, c.cur) : null;
      return (
        <>
          Predicting the next token requires context, the tokens that came before. <b>Attention</b>{" "}
          is the step that supplies it: at each layer, every token looks back at the earlier tokens
          and pulls in information from the ones that matter. It does this by scoring every earlier
          token, rescaling those <Term name="scores">scores</Term> with <b>softmax</b> into{" "}
          <Term name="weights">weights</Term> that add up to 100%, then blending the tokens by those
          weights. It is the only step where tokens exchange information. The highlighted dots show
          where each layer looked, larger meaning more attention and red the strongest.{" "}
          {g ? (
            <>
              For this token, layer {c.layer} attended hardest back to {tok(c, g.topPos)} (
              <b>{(g.share * 100).toFixed(0)}%</b> of its attention).
            </>
          ) : (
            <>The first token has nothing earlier to look at, so there is no attention to show.</>
          )}{" "}
          Reaching back like this only works because each earlier token's key and value are already
          sitting in the <Explain of="kvcache">KV cache</Explain>, not recomputed here.
        </>
      );
    },
  },

  kvcache: {
    id: "kvcache",
    title: "the KV cache",
    highlight: (c) => ({ kind: "layer", layer: c.layer }),
    interactive: (c) => <KvCacheDemo ctx={c} />,
    intro: (c) => {
      const n = c.prod + 1;
      return (
        <>
          Every layer's attention needs each earlier token's <b>key</b> and <b>value</b> vectors, the
          ones its own query is compared against and blended from. Recomputing them on every step
          would redo all the earlier work each time the sequence grows by one token. Instead, the
          moment a token is processed, its keys and values at every layer are written once into the{" "}
          <b>KV cache</b> and kept (one pair per <b>KV head</b>; small groups of attention heads
          share each pair).
          Producing the next token only computes the new token's own query, key, and value, then reads
          every key and value already in the cache. By the pass that produced this token, the cache
          held <b>{n}</b> position{n === 1 ? "" : "s"} at each of the <b>{c.trace.layers}</b> layers.
          This is exactly what the attention arcs above are drawing: reading back over cached
          positions, not recomputing them. At real scale this cache is what a{" "}
          <Explain of="scaling">paged KV cache</Explain> manages across many conversations at once.
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
        an <Term name="up">up</Term>, then <Term name="silu">silu</Term> uses the gate to decide how
        much of each up value to keep, before they are compressed back to 1,024. Unlike the attention
        step just above it, this one moves no information between tokens; it only reshapes this
        token's own vector. The gate and up activations below are the real values these two
        projections produce for this token.
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
    title: "what the model predicted here",
    highlight: () => ({ kind: "el", ref: "logit-0" }),
    interactive: (c) => <GeometryCard ctx={c} read="prediction" />,
    rungs: [
      { label: "the unembed, worked", body: (c) => <UnembedDemo ctx={c} /> },
      code("matmul"),
    ],
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
          This is the prediction that produced the token under inspection. After the previous token
          passed through every layer, the model held one final 1,024-number vector and scored the
          next token by comparing that vector against every row of the <b>embedding table</b>, the
          same table that turned token IDs into vectors at the start: a closer match means a higher
          score. That comparison is called the <b>unembedding</b>, and each raw score is a{" "}
          <b>logit</b>. <b>Softmax</b> then turns all 151,936 logits into
          probabilities that add up to 100%, and the token at the top is the one that became{" "}
          {tok(c, c.cur)}.{read} Click a bar to <b>force</b> a different token here instead and watch
          the model continue from that choice. These rankings build up gradually:{" "}
          <Explain of="lens" label="watch this prediction form across the layers" />.
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
          distance set by <b>cosine</b> similarity (how closely two directions align), so the
          nearest entries are the ones the model treats as most alike. <b>What comes next</b> centers on the output direction that
          produced this token and arranges the candidate tokens around it by how high the model
          scored each, so the strongest sits closest to the center
          {win ? (
            <>
              ; here it pointed hardest at {q(win[1])}
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
          The residual stream is not only growing in size; it is this token's prediction resolving.
          At each layer of the pass that produced this token, the model can be stopped early and
          asked what it would predict from there: apply the final normalization and the same
          unembedding the real output uses, then read the top token. That per-layer read is called
          the <b>logit lens</b>.{" "}
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
    interactive: (c) =>
      c.sel ? <TemperatureDemo cand={c.sel.cand} temp={c.sel.temp} chosen={c.sel.chosen} /> : null,
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
    interactive: (c) =>
      c.sel ? <TopKDemo cand={c.sel.cand} k={c.sel.top_k} temp={c.sel.temp} chosen={c.sel.chosen} /> : null,
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
    interactive: (c) =>
      c.sel ? <TopPDemo cand={c.sel.cand} p={c.sel.top_p} temp={c.sel.temp} chosen={c.sel.chosen} /> : null,
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
            there is no randomness: the highest-scoring candidate always wins, and this token was
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

  // ---- the epilogue: framing OUTSIDE the verified instrument ----
  // Everything above was computed and verified in this lab. These two concepts
  // describe how the same operations scale and how an agent wraps this loop;
  // none of it is implemented in suiron, and the band says so at its boundary.
  scaling: {
    id: "scaling",
    title: "how this scales",
    highlight: () => ({ kind: "el", ref: "epilogue" }),
    intro: () => (
      <>
        Everything in the lab so far is the engine running one sequence on one machine, the simplest
        correct version of each operation. Production inference keeps these exact operations and
        changes only how they are scheduled and stored, to serve many requests quickly. The notes
        below name, for each surface you used, the single change that happens at scale. None of it is
        implemented in suiron: this is where the verified instrument ends and a description of the
        wider system begins.
      </>
    ),
  },

  agents: {
    id: "agents",
    title: "from this loop to an agent",
    highlight: () => ({ kind: "el", ref: "epilogue" }),
    intro: () => (
      <>
        A coding agent, including the assistant that may have helped build this, runs the same loop
        you just watched: score the vocabulary, draw one token, append it, and repeat. What makes it
        feel like more is a wrapper around that loop, all of it outside the model. A <b>chat
        template</b> formats the conversation into tokens with role markers; the control tokens it
        inserts, such as <code>{"<|im_start|>"}</code> and <code>{"<|im_end|>"}</code>, are ordinary
        vocabulary entries with their own token IDs, drawn by the same sampling step as any word. A{" "}
        <b>harness</b>, which is plain code around the model, watches the token stream, and when the
        model predicts a token it recognizes as a tool call it pauses generation, runs the tool
        itself, writes the result back into the context as more tokens, and resumes. The model never
        runs a tool. It predicts a token; external code reads that token and acts. Using a tool is
        next-token prediction plus a wrapper.
      </>
    ),
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
