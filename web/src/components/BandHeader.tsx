import type { ReactNode } from "react";

/* The shared header for all bands: an index + title, an always-on one-line
   subtitle (depth 0 orientation), and an optional right-aligned control slot.
   On-demand explanation is no longer a per-band block — it lives in the
   Explainer, summoned by <Explain of="…"/> anchors placed next to the things
   they explain (often in `title` or `children`). */
export function BandHeader({
  idx,
  title,
  step,
  sub,
  children,
}: {
  idx: string;
  title: ReactNode;
  /** the guided flow's step word this band deepens (the vocabulary bridge:
   *  design.md's five steps are the app's spine vocabulary) */
  step?: string;
  sub: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="label">
        <span className="idx">{idx}</span>
        <span className="band-title">{title}</span>
        {step && <span className="band-step">{step}</span>}
        {children && <span className="band-ctl">{children}</span>}
      </div>
      <div className="band-sub">{sub}</div>
    </>
  );
}
