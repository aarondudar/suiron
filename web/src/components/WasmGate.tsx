import { useEffect, useState, type ReactNode } from "react";
import { boot, bootDemo, goLive } from "../wasmBackend";
import { WELCOME_SEEN_KEY, WelcomeStory } from "./Welcome";

/* The static build's ONE front door (docs/17 + 19). Boot order:
   1. try the instant demo — a shipped recording of one real run; the lab is
      alive in seconds with zero model download;
   2. no recording shipped → the full download gate (as before).
   While in demo mode, a "go live" overlay (opened via the header's recorded
   tag or any disabled action) runs the download/progress flow and replays the
   recorded run on the real engine. The gate/overlay tells the project's story
   (single-source copy) and marks the welcome as seen — never two gates. */

interface BootState {
  msg: string;
  frac: number | null;
  err: string | null;
  done: boolean;
}

const IDLE: BootState = { msg: "starting…", frac: null, err: null, done: false };

/* coarse pointer ≈ phone/tablet. Running the full model in-tab needs ~1 GB of
   working memory; mobile browsers cap tab memory hard and kill the tab instead
   of erroring, so warn before the ~640 MB commit (the demo needs none of this). */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

function markWelcomeSeen() {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    /* private mode — fine */
  }
}

function GateBody({
  s,
  onRetry,
  retryLabel = "retry",
}: {
  s: BootState;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="wasmgate">
      <div className="wasmgate-brand">
        suiron<span className="jp">推論</span>
      </div>
      {s.err ? (
        <>
          <div className="wasmgate-err">could not start: {s.err}</div>
          <button className="wasmgate-retry" onClick={onRetry}>
            {retryLabel}
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
          {COARSE && (
            <div className="wasmgate-warn">
              running the full model in a phone browser needs a lot of memory and may crash the tab —
              a desktop browser is recommended for the live engine.
            </div>
          )}
          <div className="wasmgate-story">
            <WelcomeStory />
          </div>
        </>
      )}
    </div>
  );
}

export function WasmGate({ children }: { children: ReactNode }) {
  const [s, setS] = useState<BootState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  // the go-live overlay: null = closed, otherwise its own boot state
  const [live, setLive] = useState<BootState | null>(null);

  useEffect(() => {
    let dead = false;
    void bootDemo().then((demo) => {
      if (dead) return;
      if (demo) {
        // instant: no gate ever shows, so the Welcome overlay (first visit)
        // stays the storyteller
        setS({ ...IDLE, done: true });
        return;
      }
      // no recording shipped — the full gate, as before
      boot((msg, frac) => !dead && setS({ msg, frac, err: null, done: false }))
        .then(() => {
          markWelcomeSeen();
          if (!dead) setS({ ...IDLE, done: true });
        })
        .catch((e: unknown) => {
          if (!dead) setS({ msg: "", frac: null, err: String(e), done: false });
        });
    });
    return () => {
      dead = true;
    };
  }, [attempt]);

  // "go live" requested from inside the demo (header tag / a disabled action)
  useEffect(() => {
    const open = () => {
      setLive((cur) => cur ?? { ...IDLE });
      goLive((msg, frac) => setLive({ msg, frac, err: null, done: false }))
        .then(() => setLive(null)) // the polling picks up the live engine
        .catch((e: unknown) => setLive({ msg: "", frac: null, err: String(e), done: false }));
    };
    window.addEventListener("suiron-open-golive", open);
    return () => window.removeEventListener("suiron-open-golive", open);
  }, []);

  if (!s.done) return <GateBody s={s} onRetry={() => setAttempt((a) => a + 1)} />;

  return (
    <>
      {children}
      {live && (
        <div className="welcome-scrim">
          <div className="golive">
            <GateBody s={live} onRetry={() => setLive(null)} retryLabel="close" />
          </div>
        </div>
      )}
    </>
  );
}
