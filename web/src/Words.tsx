import { useRef, useState } from "react";
import { preview, type Card, type Grade, type useCards } from "./cards";
import { Practice } from "./Practice";

// Saved words: review the ones that are due (flashcards with a simple
// spaced-repetition schedule), browse or remove them, and back them up.
// Browser-only (ADR 0005), so Export is the only copy outside this browser.

type Cards = ReturnType<typeof useCards>;

export function Words({ cards, onSpeak, onOpen }: { cards: Cards; onSpeak?: (text: string, lang: string) => void; onOpen: (c: Card) => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);

  function exportJSON() {
    const blob = new Blob([JSON.stringify(cards.cards, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sprout-words-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importFile(f: File) {
    try {
      const n = cards.importJSON(await f.text());
      setNote(n ? `Imported ${n} new word${n === 1 ? "" : "s"}.` : "Nothing new in that file.");
    } catch {
      setNote("That file isn't a Sprout word export.");
    }
  }

  if (reviewing && cards.due.length) {
    return <Review card={cards.due[0]} left={cards.due.length} onGrade={cards.grade} onSpeak={onSpeak} onDone={() => setReviewing(false)} />;
  }

  return (
    <section className="words">
      <div className="words-head">
        <h2>⭐ Saved words</h2>
        <span className="hint small">
          {cards.cards.length} saved · {cards.due.length} due · kept in this browser only
        </span>
        <button onClick={() => setReviewing(true)} disabled={!cards.due.length} className="primary">
          {cards.due.length ? `Review ${cards.due.length}` : "Nothing due"}
        </button>
      </div>
      {reviewing && !cards.due.length && <p className="hint">All done for now. 🌱</p>}
      {cards.cards.length === 0 ? (
        <p className="hint">No saved words yet. Tap a word in the reader or the tutor and press ＋ Save.</p>
      ) : (
        <ul className="word-list">
          {[...cards.cards]
            .sort((a, b) => b.added - a.added)
            .map((c) => (
              <li key={`${c.lang}:${c.word}`}>
                <button className="link word-open" onClick={() => onOpen(c)} title="Open in the reader">
                  <span className="w" lang={c.lang}>
                    {c.word}
                  </span>
                </button>
                <Reading c={c} />
                <span className="hint def">{c.defs[0]}</span>
                <span className="hint small due">{dueLabel(c)}</span>
                <button className="link remove" onClick={() => cards.remove(c)} aria-label={`Remove ${c.word}`}>
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}
      <p className="hint small">
        <button className="link" onClick={exportJSON} disabled={!cards.cards.length}>
          Export
        </button>{" "}
        ·{" "}
        <button className="link" onClick={() => file.current?.click()}>
          Import
        </button>{" "}
        a backup (JSON). Clearing site data deletes saved words, so export now and then.
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </p>
      {note && <p className="hint small">{note}</p>}
    </section>
  );
}

function Review({
  card,
  left,
  onGrade,
  onSpeak,
  onDone,
}: {
  card: Card;
  left: number;
  onGrade: (c: Card, g: Grade) => void;
  onSpeak?: (text: string, lang: string) => void;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(false);
  const key = `${card.lang}:${card.word}:${card.reviews}`;
  const grade = (g: Grade) => {
    setShown(false);
    onGrade(card, g);
  };
  return (
    <section className="words review" key={key}>
      <div className="words-head">
        <h2>⭐ Review</h2>
        <span className="hint small">{left} left</span>
        <button className="secondary" onClick={onDone}>
          Stop
        </button>
      </div>
      <div className="flash">
        <div className="flash-word" lang={card.lang}>
          {card.word}
          {onSpeak && shown && (
            <button className="speak inline" onClick={() => onSpeak(card.word, card.lang)} aria-label="Hear it">
              🔊
            </button>
          )}
        </div>
        {!shown ? (
          <>
            <p className="hint">Say it and recall its meaning, then check.</p>
            <button className="primary" onClick={() => setShown(true)} autoFocus>
              Show answer
            </button>
          </>
        ) : (
          <>
            <div className="reading">
              <Reading c={card} />
            </div>
            <ol className="flash-defs">
              {card.defs.slice(0, 4).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ol>
            {card.sentence && (
              <p className="flash-sentence" lang={card.lang}>
                {highlight(card.sentence, card.word)}
              </p>
            )}
            <div className="grades">
              {(["again", "good", "easy"] as Grade[]).map((g) => (
                <button key={g} className={`grade ${g}`} onClick={() => grade(g)}>
                  {g[0].toUpperCase() + g.slice(1)}
                  <span className="hint small">{preview(card, g)}</span>
                </button>
              ))}
            </div>
            <h3 className="practice-title">Practice</h3>
            <Practice key={key} word={card.word} syllables={card.syllables} onSpeak={onSpeak && (() => onSpeak(card.word, card.lang))} />
          </>
        )}
      </div>
    </section>
  );
}

function Reading({ c }: { c: Card }) {
  return (
    <span className="card-reading">
      {c.syllables.length
        ? c.syllables.map((y, i) => (
            <span key={i} className={`tone${y.tone}`}>
              {y.text}{" "}
            </span>
          ))
        : c.reading}
    </span>
  );
}

function highlight(sentence: string, word: string) {
  const i = sentence.indexOf(word);
  if (i < 0) return sentence;
  return (
    <>
      {sentence.slice(0, i)}
      <mark>{word}</mark>
      {sentence.slice(i + word.length)}
    </>
  );
}

function dueLabel(c: Card): string {
  const ms = c.due - Date.now();
  if (ms <= 0) return "due";
  const d = Math.round(ms / 86_400_000);
  return d < 1 ? "later today" : d === 1 ? "tomorrow" : `in ${d} days`;
}
