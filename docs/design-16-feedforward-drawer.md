# design-16 — "read, then think" (sharpens drawer 3)

## Goal

Two-thirds of the model's parameters never appear in the flow: the
feed-forward half of every layer. New drawer on **sharpens**: the woven
engine source for the FFN (`UnderHood stage="feedforward"`) with THIS pass's
real gate/up/activation/down values threaded into the code, plus a layer
selector so the same block can be read at any depth.

## The teachable moment

UnderHood is already interactive in the right way: hover any named quantity
in the real Rust source and its actual value for this token appears in the
readout (the hotVar linkage). The flow adds the layer number input (the same
control AttentionInteractive uses) so "think" can be inspected at layer 0 vs
layer 26 — the values change, the code does not. Framing: every layer is
read (attention) then think (this block), and this is the thinking half.

## Mechanics

- `UnderHood` re-homed unchanged (uses the default no-op hotVar context —
  verified in design-01). A small flow-side layer input feeds it (head is
  irrelevant for the FFN stage; pass 0).

## Done when

The drawer shows the real FFN source with live values at a selectable layer;
hover linkage works; values change with the layer. Gate green.

## Commit

"lab: read-then-think drawer — the feed-forward half". Claude commits.
