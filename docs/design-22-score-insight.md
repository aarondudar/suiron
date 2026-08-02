# design-22 — why THIS number: insight inside the worked dot

## Goal (Aaron, 2026-07-20)

The dot drawer shows the arithmetic but not the meaning of its shape — a
spike at component 61 goes unexplained, and the score's afterlife is
invisible. Add four honest, per-instance captions computed from values the
drawer already holds (or fetches through the existing cached inspect):

1. **Concentration** — the few signed components that carry ≥50% of the
   final sum, named ("components 61, 12, 88 give 4.1 of the 6.4"); when no
   few dominate, say the match is spread — both are real findings. While the
   accumulation plays, the current term is tagged when it is one of them.
2. **The discriminator** — against the strongest rival source, the top
   coordinates of q·(k_this − k_rival): where the head actually told the two
   words apart. One extra cached inspect fetch; shown only when the engine's
   scores genuinely order that way.
3. **The RoPE channel** — the biggest component's rotation pair and its real
   period (from the model's RoPE theta): fast pairs encode position, slow
   pairs barely feel it. The number is the claim; the gloss stays one clause.
4. **The forward thread** — after the blend: this read's softmax share of
   the head's output, and where it goes next (the running vector; "the
   signal" drawer shows it move).

## Honesty

Every clause cites a computed number; no dimension semantics are claimed
(that's SAE territory and out of scope). The RoPE theta (1e6) is a model
constant from the GGUF metadata, same footing as the vocab count.

## Files

DotProduct.tsx (the module gains the insight block — a sanctioned feature
change, not a re-homing), styles.css.

## Commit

"lab: why this number — insight in the worked dot". Claude commits.
