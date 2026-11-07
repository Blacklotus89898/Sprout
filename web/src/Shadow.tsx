import type { Syllable, Token } from "./api";
import { Practice } from "./Practice";

// Shadowing: step through the text one sentence at a time. Hear it, say it
// back, replay both, and compare your pitch with the sentence's tone shapes.

export type Sentence = { start: number; end: number; text: string; syllables: Syllable[] };

// Clause punctuation too: a learner shadows a breath-sized phrase, and a long
// sentence would run past the 8-second recording limit.
const ENDS = new Set(["。", "！", "？", "!", "?", ".", "；", ";", "…", "\n", "，", ",", "、", "：", ":"]);

/** Split reader tokens into phrases (token index ranges, end exclusive). */
export function sentences(tokens: Token[]): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const flush = (end: number) => {
    const toks = tokens.slice(start, end);
    const text = toks.map((t) => t.text).join("").trim();
    if (toks.some((t) => t.kind === "word")) {
      // Tone shapes only when every word has one reading per character;
      // otherwise the sentence still records and replays, without the chart.
      const syl: Syllable[] = [];
      let complete = true;
      for (const t of toks) {
        if (t.kind !== "word") continue;
        const s = t.senses?.[0]?.syllables ?? [];
        if (s.length && s.length === [...t.text].length) syl.push(...s);
        else complete = false;
      }
      out.push({ start, end, text, syllables: complete ? syl : [] });
    }
    start = end;
  };
  tokens.forEach((t, i) => {
    if (t.kind === "punct" && ENDS.has(t.text)) flush(i + 1);
  });
  if (start < tokens.length) flush(tokens.length);
  return out;
}

export function Shadow({
  list,
  index,
  onIndex,
  onSpeak,
}: {
  list: Sentence[];
  index: number;
  onIndex: (i: number) => void;
  onSpeak?: (text: string) => void;
}) {
  const s = list[index];
  if (!s) return null;
  return (
    <section className="shadow">
      <div className="shadow-head">
        <h2>🎙 Shadow, phrase by phrase</h2>
        <span className="hint small">Hear it, say it back, compare.</span>
        <div className="shadow-nav">
          <button className="secondary" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous phrase">
            ◀
          </button>
          <span className="hint">
            {index + 1} / {list.length}
          </span>
          <button className="secondary" onClick={() => onIndex(index + 1)} disabled={index === list.length - 1} aria-label="Next phrase">
            ▶
          </button>
        </div>
      </div>
      <p className="shadow-text">
        {s.text}
        {s.syllables.length > 0 && (
          <span className="shadow-pinyin">
            {s.syllables.map((y, i) => (
              <span key={i} className={`tone${y.tone}`}>
                {y.text}{" "}
              </span>
            ))}
          </span>
        )}
      </p>
      <Practice key={s.start} word={s.text} syllables={s.syllables} onSpeak={onSpeak && (() => onSpeak(s.text))} verdicts={s.syllables.length <= 4} />
    </section>
  );
}
