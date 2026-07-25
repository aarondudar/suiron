/* the dive points: which drawers dock to which step (docs/design.md's map).
   A step may dock several; the single-drawer rule still holds — opening one
   closes any other.

   `tab` is the dock handle on the spine — the copy-script ADDENDUM owns these
   verbatim. `label` is the drawer's title once open: the script's long
   "drawer button" phrase for the nine scripted drawers, and the handle itself
   for the four adopted drawers (which have no long phrase). Dock order follows
   the addendum's handle order per step. */

export interface Dive {
  id: string;
  tab: string;
  label: string;
}

export const DIVES: Record<number, Dive[]> = {
  1: [
    { id: "merges", tab: "how pieces form", label: "watch the text become tokens" },
    { id: "meaning", tab: "the map of meaning", label: "the map of meaning" },
  ],
  2: [
    { id: "dot", tab: "score one look", label: "watch one look get scored" },
    { id: "heads", tab: "16 readers", label: "see all 16 ways it looks" },
    { id: "rope", tab: "word order", label: "how it knows word order" },
  ],
  3: [
    { id: "rmsnorm", tab: "kept steady", label: "how a layer keeps the numbers sane" },
    { id: "ffn", tab: "reworked", label: "reworked" },
    { id: "residual", tab: "guess by depth", label: "why early guesses exist at all" },
  ],
  4: [
    { id: "sampling", tab: "bend the odds", label: "bend the odds" },
    { id: "fork", tab: "fork it", label: "take the road not taken" },
    { id: "unembed", tab: "the readout", label: "the readout" },
  ],
  5: [
    { id: "cache", tab: "why it's fast", label: "why the loop is fast" },
    { id: "worlds", tab: "two worlds", label: "two worlds" },
  ],
};
