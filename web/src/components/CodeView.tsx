import { useMemo, useState, type ReactNode } from "react";

/* CodeView (design-32): every engine snippet, with depth. The code itself is
   still fetched from /api/v1/source — the engine's own files — and the layers
   here only DESCRIBE it, never paraphrase it:
   - a "why this code" caption (what to notice, what's deliberately naive);
   - per-line notes, matched by line CONTENT (substring), so if the source
     drifts an unmatched note simply doesn't render — never a wrong one;
   - line numbers, copy, and a link to the real file on GitHub;
   - long snippets fold the blocks that have their own walkthroughs.
   Tinting stays monochrome (structure bright, literals mid, commentary receded);
   red marks only the line you are reading. */

const REPO = "https://github.com/aarondudar/suiron/blob/main/";

interface Note {
  /** substring of the (served) line this note belongs to; first match wins */
  match: string;
  note: string;
}
interface Fold {
  start: string;
  end: string;
  label: string;
}
interface Meta {
  path: string;
  caption: string;
  notes: Note[];
  folds?: Fold[];
}

const MATH = "crates/suiron-core/src/math.rs";
const FWD = "crates/suiron-core/src/forward.rs";

export const CODE_META: Record<string, Meta> = {
  dot: {
    path: MATH,
    caption:
      "the engine's innermost loop — every attention score in the tour is this function on two 128-number vectors. naive on purpose: correctness before speed.",
    notes: [
      {
        match: "a.iter().zip(b)",
        note: "pair the components, multiply each pair, add them up — the whole comparison is this one line.",
      },
    ],
  },
  silu: {
    path: MATH,
    caption:
      "the nonlinearity inside the feed-forward half. without one of these between the matrix multiplies, all 28 layers would collapse into one linear map — this tiny curve is what buys depth.",
    notes: [
      {
        match: "x * (1.0",
        note: "sigmoid(x) is 0..1, so the value gates itself: negatives are squashed toward 0, positives pass nearly straight through.",
      },
    ],
  },
  embedding: {
    path: "crates/suiron-core/src/model.rs",
    caption:
      "the lookup the “meaning” drawer shows: 151,936 rows × 1,024 columns, and a token id simply indexes a row. that row IS the token's starting vector.",
    notes: [
      {
        match: "token as usize * h",
        note: "the id is just a row number — multiply by the row width to find where this token's 1,024 numbers start.",
      },
      {
        match: "&self.token_embd.data[start",
        note: "no compute: a borrow of the row in place. “looking a word up as a vector” is exactly this slice.",
      },
    ],
  },
  rmsnorm: {
    path: MATH,
    caption:
      "the reset before every read. dividing by the RMS standardizes the vector's size without touching its direction — then a learned per-channel weight re-emphasizes what the next block should see.",
    notes: [
      {
        match: "sum_of_squares",
        note: "square every component and add — the vector's overall energy.",
      },
      {
        match: "(mean_of_squares + eps).sqrt()",
        note: "the RMS: the typical size of one component. eps keeps a zero vector from dividing by zero.",
      },
      {
        match: "x[i] * weight[i] / rms",
        note: "divide by the RMS (reset the size), then scale each channel by its learned weight.",
      },
    ],
  },
  softmax: {
    path: MATH,
    caption:
      "how scores become percentages, everywhere in the tour — attention weights and the final word-odds are both this. exp makes everything positive and widens gaps; the divide turns the list into shares of 1.",
    notes: [
      {
        match: "fold(f32::NEG_INFINITY",
        note: "find the biggest score first…",
      },
      {
        match: "(v - max).exp()",
        note: "…and subtract it before exp — the result is unchanged, but e^score can no longer overflow.",
      },
      {
        match: "*v /= sum",
        note: "divide by the total so everything sums to exactly 1: scores become shares.",
      },
    ],
  },
  matmul: {
    path: MATH,
    caption:
      "the textbook three loops, kept deliberately naive as the correctness reference — the Metal GPU path must match this output exactly before it is allowed to be fast.",
    notes: [
      {
        match: "acc += a[i * k + p]",
        note: "the hot line: one multiply-add, run m×n×k times. almost all inference time is spent here.",
      },
      {
        match: "c[i * n + j] = acc",
        note: "flat row-major storage: element (row, col) lives at row·width + col.",
      },
    ],
  },
  rope: {
    path: MATH,
    caption:
      "position as rotation. before q meets k, each is spun by an angle set by its token's position — so their dot product depends on how far apart the words are, not just what they say.",
    notes: [
      {
        match: "base.powf(-(2.0",
        note: "each pair gets its own frequency: pair 0 spins fastest with position, the last pair barely moves.",
      },
      {
        match: "pos as f32 * freq_i",
        note: "the angle grows with position — this line is where word order enters the math.",
      },
      {
        match: "x0 * cos - x1 * sin",
        note: "a plain 2-D rotation of the pair (i, i+64): direction changes, length never does.",
      },
    ],
  },
  attention: {
    path: FWD,
    caption:
      "the “looks back” step, verbatim: for each head, score every earlier token, soften the scores into weights, and blend the earlier values by those weights. the `obs` lines are the microscope's taps — the numbers in the tour come from exactly here.",
    notes: [
      {
        match: "head / group",
        note: "grouped-query attention: 16 query heads share 8 k/v heads — two q heads read the same cached keys.",
      },
      {
        match: "dot(qh, kp) * scale",
        note: "one score: this token's query against an earlier token's key, scaled by 1/√128 — the worked demo rebuilds this by hand.",
      },
      {
        match: "let weights = softmax(&scores)",
        note: "scores → shares of attention (the same softmax as the final word-odds).",
      },
      {
        match: "out[d] += w * vp[d]",
        note: "the read itself: every earlier token's value vector, added in proportion to its weight.",
      },
    ],
  },
  ffn: {
    path: FWD,
    caption:
      "the “think” half of every layer: expand to 3,072 channels, let the gate choose, compress back, add. attention moved information between words — this transforms it in place.",
    notes: [
      {
        match: "rmsnorm(&x, &layer.ffn_norm",
        note: "the reset again — every block reads a standardized copy of the signal.",
      },
      {
        match: "layer.ffn_gate.matvec",
        note: "two independent projections of the same input: one to gate, one to carry.",
      },
      {
        match: "silu(gate[i]) * up[i]",
        note: "SwiGLU: the gate (squashed toward 0..1) decides, channel by channel, how much of `up` passes.",
      },
      {
        match: "x[i] += down[i]",
        note: "the block never replaces the vector — it adds its adjustment to the running signal.",
      },
    ],
  },
  forward: {
    path: FWD,
    caption:
      "one token's full journey, top to bottom — the function the whole tour is a picture of. the attention and feed-forward blocks fold away here because they have their own walkthroughs.",
    notes: [
      {
        match: "let mut x = model.embedding_row(token)",
        note: "the residual stream is born: one 1,024-number vector, the token's table row.",
      },
      {
        match: "for (li, layer) in model.layers",
        note: "the whole model is this loop, 28 times: look back, then think.",
      },
      {
        match: "x[i] += proj[i]",
        note: "attention's output is ADDED — the stream is never replaced, only adjusted.",
      },
      {
        match: "rmsnorm(&x, &model.output_norm",
        note: "one final reset before scoring.",
      },
      {
        match: "w_out.matvec(&xn, backend)",
        note: "the unembed: the finished vector against all 151,936 rows — the logits the last step samples from.",
      },
    ],
    folds: [
      {
        start: "// machine:attention:start",
        end: "// machine:attention:end",
        label: "the attention block — walked line by line in “looks back”",
      },
      {
        start: "// machine:ffn:start",
        end: "// machine:ffn:end",
        label: "the feed-forward block — walked line by line in “think”",
      },
    ],
  },
};

// ---- the shared monochrome Rust tinter (structure bright, literals mid) ----
const RUST_TOKEN =
  /(\/\/.*)|("(?:[^"\\]|\\.)*")|\b(pub|fn|let|mut|for|in|if|else|return|match|loop|while|use|struct|impl|enum|const|break|continue|as|where|self|Self)\b|\b(f16|f32|f64|u8|u16|u32|u64|usize|i8|i16|i32|i64|bool|str|Vec|Option|Some|None|String|KvCache|Model|Observer)\b|(\b\d[\d_]*(?:\.\d+)?(?:e-?\d+)?\b)/g;
const TOKEN_CLASS = ["c-comment", "c-str", "c-kw", "c-type", "c-num"];

export function tintLine(line: string, key: number): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(RUST_TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    const group = m.slice(1).findIndex((g) => g !== undefined);
    out.push(
      <span key={`${key}-${i}`} className={TOKEN_CLASS[group]}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out.length ? out : " ";
}

/** first unused note whose match is a substring of the line, in order */
function assignNotes(lines: string[], notes: Note[]): Map<number, string> {
  const used = new Set<number>();
  const map = new Map<number, string>();
  lines.forEach((l, i) => {
    for (let n = 0; n < notes.length; n++) {
      if (used.has(n) || !l.includes(notes[n].match)) continue;
      map.set(i, notes[n].note);
      used.add(n);
      break;
    }
  });
  return map;
}

interface FoldSpan {
  start: number;
  end: number;
  label: string;
}
function findFolds(lines: string[], folds: Fold[]): FoldSpan[] {
  const out: FoldSpan[] = [];
  for (const f of folds) {
    const s = lines.findIndex((l) => l.includes(f.start));
    if (s < 0) continue;
    const e = lines.findIndex((l, i) => i > s && l.includes(f.end));
    if (e < 0) continue;
    out.push({ start: s, end: e, label: f.label });
  }
  return out;
}

export function CodeView({
  fn,
  src,
  renderLine,
  readout,
  idle,
}: {
  fn: string;
  src: string;
  /** custom per-line renderer (UnderHood weaves its live variables); defaults
   *  to the plain tinter */
  renderLine?: (text: string, i: number) => ReactNode;
  /** an ACTIVE external readout (a hovered variable's live value) — outranks
   *  the line note: pointing at a name is more specific than the line around it */
  readout?: ReactNode;
  /** shown when nothing is active; CodeView falls back to its own hint */
  idle?: ReactNode;
}) {
  const meta = CODE_META[fn];
  const lines = useMemo(() => src.split("\n"), [src]);
  const notes = useMemo(() => assignNotes(lines, meta?.notes ?? []), [lines, meta]);
  const folds = useMemo(() => findFolds(lines, meta?.folds ?? []), [lines, meta]);
  const [pin, setPin] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const render = renderLine ?? tintLine;
  const activeLine = hover ?? pin;
  const activeNote = activeLine !== null ? notes.get(activeLine) : undefined;

  const copy = () => {
    void navigator.clipboard?.writeText(src).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  // rows, with folded spans collapsed to one clickable line
  const rows: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fold = folds.find((f) => f.start === i);
    if (fold) {
      const isOpen = open.has(fold.start);
      rows.push(
        <div
          key={`f${i}`}
          className="cv-fold"
          role="button"
          tabIndex={0}
          onClick={() =>
            setOpen((o) => {
              const next = new Set(o);
              if (isOpen) next.delete(fold.start);
              else next.add(fold.start);
              return next;
            })
          }
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).click()}
        >
          <span className="cv-ln" />
          <span className="cv-lc">
            {isOpen ? "⌃ fold" : `⋯ ${fold.end - fold.start + 1} lines`} · {fold.label}
          </span>
        </div>,
      );
      if (!isOpen) {
        i = fold.end;
        continue;
      }
    }
    const noted = notes.has(i);
    const lit = activeLine === i && noted;
    rows.push(
      <div
        key={i}
        className={"cv-line" + (noted ? " has-note" : "") + (lit ? " lit" : "")}
        onMouseEnter={noted ? () => setHover(i) : undefined}
        onMouseLeave={noted ? () => setHover(null) : undefined}
        onClick={noted ? () => setPin(pin === i ? null : i) : undefined}
      >
        <span className="cv-ln">{i + 1}</span>
        <span className="cv-lc">{render(lines[i], i)}</span>
      </div>,
    );
  }

  return (
    <div className="cv">
      <div className="cv-head">
        <span className="cv-path">{meta?.path ?? "engine source"}</span>
        <span className="cv-actions">
          <button onClick={copy} title="copy the snippet">
            {copied ? "copied ✓" : "copy"}
          </button>
          {meta && (
            <a href={REPO + meta.path} target="_blank" rel="noreferrer" title="the real file on GitHub">
              github ↗
            </a>
          )}
        </span>
      </div>
      {meta?.caption && <div className="cv-caption">{meta.caption}</div>}
      <pre className="code cv-code">{rows}</pre>
      <div className="cv-readout">
        {readout ??
          (activeNote ? (
            <span className="cv-note">{activeNote}</span>
          ) : (
            idle ?? (
              <span className="cv-idle">
                {notes.size ? "tap an underlined line for what it does" : "the engine's own source, served live"}
              </span>
            )
          ))}
      </div>
    </div>
  );
}
