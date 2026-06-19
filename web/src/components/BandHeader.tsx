import type { ReactNode } from "react";

/* The shared header for all bands: an index + title, an always-on one-line
   subtitle (depth 0 orientation), and an optional right-aligned control slot.
   On-demand explanation is no longer a per-band block — it lives in the
   Explainer, summoned by <Explain of="…"/> anchors placed next to the things
   they explain (often in `title` or `children`). */
export function BandHeader({
  idx,
  title,
  sub,
  children,
}: {
  idx: string;
  title: ReactNode;
  sub: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="label">
        <span className="idx">{idx}</span>
        <span className="band-title">{title}</span>
        {children && <span className="band-ctl">{children}</span>}
      </div>
      <div className="band-sub">{sub}</div>
    </>
  );
}
