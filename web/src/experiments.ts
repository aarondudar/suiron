import type { GenParams } from './types'

/* Curated experiments (docs/21): each is a real prompt plus one honest
   "watch for" line, so the lab teaches phenomena, not just mechanics. Every
   claim below was checked against the engine's actual output before it was
   written (greedy runs are deterministic, sampled runs pin their seed), and
   the markers they point at render only when the trace's numbers earn them. */

export interface Experiment {
  id: string
  title: string
  prompt: string
  /** one-line hook on the gallery card */
  hook: string
  /** frames the run once it lands: the watch-for line above the lifecycle */
  watchFor: string
  /** overrides on top of the defaults (n=1, temp 0, seed 7) */
  params?: Partial<GenParams>
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'lookup',
    title: 'the lookup',
    prompt: 'The capital of France is',
    hook: 'watch attention fetch a fact',
    watchFor:
      'in the layer stack, one layer locks most of its attention onto “France”: the fact is fetched by attention, and “Paris” wins the vote.',
  },
  {
    id: 'near-tie',
    title: 'the coin flip',
    prompt: 'My favorite ice cream flavor is',
    params: { temp: 0.8 },
    hook: 'two words, almost equal odds',
    watchFor:
      '“chocolate” and “vanilla” finish within about 2% of each other, a genuine near-tie. At temperature 0.8 the draw decides: change the seed and run again for a different flavor.',
  },
  {
    id: 'repetition',
    title: 'the repetition trap',
    prompt: 'The drum goes boom and the drum goes boom and the',
    params: { n: 16, temp: 0 },
    hook: 'greedy decoding walks in a circle',
    watchFor:
      'at temperature 0 the most likely token is always taken, and here that loops forever: each repetition makes the next more likely. Raise the temperature and run again to shake it loose.',
  },
  {
    id: 'induction',
    title: 'induction',
    prompt: 'glorp zim vex glorp zim vex glorp zim',
    params: { n: 3 },
    hook: 'made-up words, and it still knows what comes next',
    watchFor:
      'these words are nonsense, so no stored fact can help. A head finds the previous copy of the current token and reads what followed it last time: look for the induction marker in the layer stack.',
  },
  {
    id: 'japanese',
    title: 'japanese',
    prompt: 'こんにちは。私の名前は',
    params: { n: 6 },
    hook: 'one token can be five characters',
    watchFor:
      'the prompt arrives as raw UTF-8 bytes. Open the tokenization demo and watch bytes merge into characters and words: こんにちは ends as a single token.',
  },
]
