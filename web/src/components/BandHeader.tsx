import type { ReactNode } from "react";

/* The shared header for all six bands — one consistent three-depth hierarchy:
   depth 0 = label (idx + title) + an always-on one-line subtitle;
   depth 1 = the explain block, revealed by the global toggle (body.explain),
             animated open via a grid-rows reveal, sitting above the dense
             content in the same place every time.
   (depth 2 — math/code/real-block — stays a per-band affordance, passed as
   `children` into the label's right-aligned control slot.) */
export function BandHeader({
  idx,
  title,
  sub,
  explain,
  children,
}: {
  idx: string;
  title: ReactNode;
  sub: ReactNode;
  explain: ReactNode;
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
      <div className="band-explain">
        <div className="explain-inner">
          <div className="explain-body">{explain}</div>
        </div>
      </div>
    </>
  );
}
