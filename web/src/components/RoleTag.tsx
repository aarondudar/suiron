import { esc } from "../lib";
import type { Trace } from "../types";

/* A small band-header tag naming which token a band is anchored to, so the
   cur/prod split stays legible: "producing pass · N <tok>" for production bands
   (the read-head whose forward pass produced the inspected token) or "this
   token · N <tok>" for identity bands (the inspected token itself). Renders
   nothing at the seed (no producing pass). */
export function RoleTag({ trace, pos, kind }: { trace: Trace; pos: number; kind: "prod" | "cur" }) {
  if (pos < 0) return null;
  const t = esc(trace.tokens[pos]?.t ?? "");
  return (
    <span
      className={"role-tag role-" + kind}
      title={
        kind === "prod"
          ? "this band shows the forward pass that produced the inspected token; it ran at this position"
          : "this band is about the inspected token itself"
      }
    >
      {kind === "prod" ? "producing pass · " : "this token · "}
      {pos} “{t}”
    </span>
  );
}
