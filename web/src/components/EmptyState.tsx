import { generate } from "../api";
import { DEFAULT_PARAMS } from "../lib";

const SUGGESTIONS = [
  "The cat sat on the",
  "The capital of France is",
  "Once upon a time, in a quiet village,",
  "1 + 1 =",
];

export function EmptyState({ onPick }: { onPick: (p: string) => void }) {
  const run = (p: string) => {
    onPick(p);
    void generate(p, DEFAULT_PARAMS);
  };

  return (
    <section className="empty">
      <div className="empty-jp">推論</div>
      <p className="empty-line">
        watch a language model think. type a prompt above — or pick one — and every number
        you'll see comes from a real forward pass running on this machine.
      </p>
      <div className="empty-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => run(s)}>
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
