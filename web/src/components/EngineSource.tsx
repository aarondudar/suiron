import { useEffect, useState } from "react";
import { getSource } from "../api";
import { CodeView } from "./CodeView";

/* Renders one real function from the engine, fetched live from /api/v1/source.
   Used by the Explainer's "the code" rungs on the non-compute concepts (the
   compute concepts weave their code into UnderHood). Click-gated, so the default
   view never makes this call. The rendering itself — tinting, line notes,
   caption, copy/GitHub, folds — is the shared CodeView (design-32). */

export function EngineSource({ fn }: { fn: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void getSource(fn).then(setSrc);
  }, [fn]);
  if (src === null) return <pre className="code">loading…</pre>;
  return <CodeView fn={fn} src={src} />;
}
