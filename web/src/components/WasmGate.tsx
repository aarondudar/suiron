import { useEffect, useState, type ReactNode } from "react";
import { boot } from "../wasmBackend";
import { WELCOME_SEEN_KEY, WelcomeStory } from "./Welcome";

/* The static build's ONE front door (docs/17): downloads the model once (with
   progress), caches it in IndexedDB, loads the wasm engine, then hands over to
   the lab. The download wait doubles as the reading moment — the gate tells
   the project's story (the same single-source copy as the welcome overlay) and
   marks the welcome as seen, so no second gate ever appears. Only mounted when
   the build was made with VITE_BACKEND=wasm. */

interface BootState {
  msg: string;
  frac: number | null;
  err: string | null;
  done: boolean;
}

export function WasmGate({ children }: { children: ReactNode }) {
  const [s, setS] = useState<BootState>({ msg: "starting…", frac: null, err: null, done: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    boot((msg, frac) => !dead && setS({ msg, frac, err: null, done: false }))
      .then(() => {
        // the gate told the story; the welcome overlay must not gate again
        try {
          localStorage.setItem(WELCOME_SEEN_KEY, "1");
        } catch {
          /* private mode — fine */
        }
        if (!dead) setS({ msg: "", frac: null, err: null, done: true });
      })
      .catch((e: unknown) => {
        if (!dead) setS({ msg: "", frac: null, err: String(e), done: false });
      });
    return () => {
      dead = true;
    };
  }, [attempt]);

  if (s.done) return children;

  return (
    <div className="wasmgate">
      <div className="wasmgate-brand">
        suiron<span className="jp">推論</span>
      </div>
      {s.err ? (
        <>
          <div className="wasmgate-err">could not start: {s.err}</div>
          <button className="wasmgate-retry" onClick={() => setAttempt((a) => a + 1)}>
            retry
          </button>
        </>
      ) : (
        <>
          <div className="wasmgate-msg">{s.msg}</div>
          <div className="wasmgate-bar">
            <div
              className="wasmgate-fill"
              style={{ width: s.frac === null ? "100%" : `${(s.frac * 100).toFixed(1)}%` }}
              data-indeterminate={s.frac === null || undefined}
            />
          </div>
          <div className="wasmgate-note">
            the whole model runs in your browser: a one-time ~640 MB download, cached locally, then
            nothing leaves your device.
          </div>
          <div className="wasmgate-story">
            <WelcomeStory />
          </div>
        </>
      )}
    </div>
  );
}
