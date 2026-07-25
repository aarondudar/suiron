import { Suspense, lazy } from "react";
import { Flow } from "./components/Flow";
import { decodeLink } from "./link";

/* The router. The guided flow is the default experience (docs/design.md); the
   old everything-at-once stack stays reachable at ?view=expert — and deep links
   without a `view` field (every pre-flow link) land there too, so shared links
   keep working. Flow links (`view=flow`) restore inside the flow.

   The expert stack code-splits behind a lazy import: the default flow ships
   without it. */

const INITIAL_LINK = decodeLink(window.location.hash);

const EXPERT =
  new URLSearchParams(window.location.search).get("view") === "expert" ||
  (INITIAL_LINK !== null && INITIAL_LINK.view !== "flow");

const ExpertLab = lazy(() =>
  import("./components/ExpertLab").then((m) => ({ default: m.ExpertLab })),
);

export default function App() {
  if (!EXPERT) return <Flow />;
  return (
    <Suspense fallback={<div className="label">connecting to suiron…</div>}>
      <ExpertLab />
    </Suspense>
  );
}
