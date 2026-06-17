/* All the explanatory copy in one place, so the voice can be tuned without
   touching component logic. JSX (not .ts) because the copy uses <b> emphasis.
   Voice: plain language, real terms defined in passing, no em-dashes, no
   out-of-scope analogies. */
import type { ReactNode } from "react";

/* always-on one-line subtitle under each band's title (depth 0) */
export const SUB = {
  prompt: "type some text and choose how the model continues it.",
  tokens: "your text, split into the pieces the model reads. click one to inspect it.",
  logits: "the model's ranked guesses for the next token.",
  selection: "how the model goes from ranked guesses to one actual token.",
  layers: "what each layer looked at, from the first layer to the last.",
  machine: "the real math that turned this token into a prediction.",
  quant: "the same model stored in fewer bytes, and the speed that buys.",
};

/* the depth-1 explain block per band (revealed by the global explain toggle) */
export const EXPLAIN: Record<string, ReactNode> = {
  prompt: (
    <>
      a language model reads text and predicts the next piece, then repeats. you type the
      starting text here. <b>temperature</b>, <b>top-k</b>, and <b>top-p</b> control how the model
      chooses among its options when it is unsure. the backend setting picks which version of the
      math runs. none of these change the model itself, only how you ask it to continue.
    </>
  ),
  tokens: (
    <>
      the model does not read letters or whole words. it reads <b>tokens</b>, which are common
      chunks of text. frequent words are usually one token, and rarer words get split into a few.
      the bar and brightness under a token show how sure the model was when it generated that one.
      the tokens you typed (the prompt) have neither. the lines connect the token you are
      inspecting to the earlier tokens it paid the most attention to, with the strongest in red.
    </>
  ),
  logits: (
    <>
      after the text runs through the whole model, it gives a score to every token in its
      vocabulary (about 152,000 of them). a step called <b>softmax</b> turns those scores into
      probabilities, percentages that add up to 100%. this is the model's honest guess before any
      randomness is added. click a bar to <b>force</b> that token instead and watch the model keep
      going from your choice.
    </>
  ),
  selection: (
    <>
      the probabilities above are only rankings. to produce text the model has to commit to one
      token. <b>temperature</b> changes how evenly it treats the options, <b>top-k</b> and{" "}
      <b>top-p</b> drop the least likely ones, and then a single random draw picks the winner. at
      temperature 0 there is no randomness and it always takes the top option. this step is where a
      model's "creativity" comes from.
    </>
  ),
  layers: (
    <>
      the model is a stack of layers, and the text passes through them in order. at each layer
      every token looks back at earlier tokens and pulls in information from the ones that matter.
      this looking-back is called <b>attention</b>. the dots show where a layer looked, bigger
      meaning more attention and red the strongest, and the percentage names its top target. the
      number on the right is roughly how much information has built up by that layer. the small tag
      sums up the pattern: <b>local</b> (nearby tokens), <b>focused</b> (one earlier token),{" "}
      <b>broad</b> (spread out), or <b>sink</b> (parked on the first token, which means the layer
      found nothing useful to read). hover a row to light up its reach in the tokens above, or
      click it to open the individual heads.
    </>
  ),
  machine: (
    <>
      this is the actual calculation the model ran for this token, broken into steps. each step
      opens three ways: a plain description, the real numbers from this token, and the actual code
      from the engine that did the work. this is the most detailed view in the tool.
    </>
  ),
};

/* band 06 explain is dynamic (it quotes the live memory figures) */
export function quantExplain(f32Gib: string, q8Gib: string): ReactNode {
  return (
    <>
      a model is a big pile of numbers called <b>weights</b>, and they can be stored at different
      sizes. <b>f32</b> keeps each weight as a full 32-bit number, so the model takes {f32Gib} GiB
      to move through memory for every token. <b>q8</b> stores each weight in 8 bits, a quarter of
      the size, so the same work moves only {q8Gib} GiB. speed here is limited by how fast those
      numbers can be read from memory, so moving fewer of them is most of why q8 is faster.
      <br />
      <br />
      q8 does not change the answer in any meaningful way. the weights were already saved in the
      small 8-bit format, so both paths use the exact same numbers and q8 only skips a conversion
      step. the model picks the same token at each step either way (checked against f32). only the
      speed differs.
    </>
  );
}

/* band 05 "the machine" — per-stage cards. Each `plain` takes the same context
   object (some stages ignore it) so the component can call them uniformly. */
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
