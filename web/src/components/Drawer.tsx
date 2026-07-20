import { useEffect, useRef, type ReactNode } from "react";

/* The single-drawer host (docs/design.md): exactly one deep-dive at a time,
   shown OVER the current step. The step recedes underneath — it never
   unmounts — and closing returns exactly to it. This component owns the a11y
   contract: dialog semantics, Esc closes, focus moves to the close control on
   open and returns to the opener on close. Reduced motion: appear, no slide. */

export function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // focus in on open; hand focus back to whatever opened us on close
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fl-drawer" role="dialog" aria-modal="true" aria-label={label}>
      <div className="fl-drawer-head">
        <span className="fl-drawer-title">{label}</span>
        <button ref={closeRef} className="fl-drawer-close" onClick={onClose}>
          × close
        </button>
      </div>
      <div className="fl-drawer-body">{children}</div>
      <div className="fl-drawer-foot">one drawer at a time · closing returns you to the step</div>
    </div>
  );
}
