import { useEffect, useState } from "react";
import * as api from "./api";
import type { Language, ReadResult, Token } from "./api";

const SAMPLE =
  "我们每天学习中文。今天天气非常好，我和朋友一起去公园散步，然后在咖啡馆看书。";

export function App() {
  const [langs, setLangs] = useState<Language[]>([]);
  const [lang, setLang] = useState("cmn-Hans");
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReading, setShowReading] = useState(true);

  useEffect(() => {
    api.languages().then(setLangs).catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function onRead() {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      setResult(await api.read(lang, text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const current = langs.find((l) => l.code === lang);
  const words = result?.tokens.filter((t) => t.kind === "word").length ?? 0;
  const sel = selected !== null ? result?.tokens[selected] : undefined;

  return (
    <div className="app">
      <header>
        <h1>🌱 Sprout</h1>
        <span className="tagline">Read real text. Tap a word.</span>
      </header>

      <section className="input">
        <div className="controls">
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            {langs.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={showReading} onChange={(e) => setShowReading(e.target.checked)} />
            {current?.romanization ?? "reading"}
          </label>
          <button onClick={onRead} disabled={busy || !text.trim()}>
            {busy ? "Reading…" : "Read"}
          </button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste text in the language you're learning" />
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <main className="reader-layout">
          <article className="reader" lang={result.lang}>
            {result.tokens.map((t, i) => (
              <TokenView key={i} t={t} showReading={showReading} active={i === selected} onPick={() => setSelected(i)} />
            ))}
            <p className="stats">
              {words} words · {result.known} in the dictionary
              {current?.dictionary && <> · {current.dictionary}</>}
            </p>
          </article>
          <aside className="panel">{sel ? <WordPanel t={sel} /> : <p className="hint">Tap a word to see its meaning.</p>}</aside>
        </main>
      )}

      <footer>
        Dictionary: <a href="https://cc-cedict.org">CC-CEDICT</a> (CC BY-SA 4.0) ·{" "}
        <a href="https://github.com/Blacklotus89898/Sprout">source</a>
      </footer>
    </div>
  );
}

function TokenView({ t, showReading, active, onPick }: { t: Token; showReading: boolean; active: boolean; onPick: () => void }) {
  if (t.kind !== "word") return <span className={t.kind}>{t.text}</span>;
  const sense = t.senses?.[0];
  const syl = sense?.syllables ?? [];
  const chars = [...t.text];
  // Color per character by tone only when syllables line up 1:1 with characters.
  const aligned = syl.length === chars.length;
  return (
    <button className={`word${active ? " active" : ""}${sense ? "" : " unknown"}`} onClick={onPick} title={sense?.defs[0]}>
      {chars.map((c, i) => (
        <ruby key={i} className={aligned ? `tone${syl[i].tone}` : undefined}>
          {c}
          <rt>{showReading && aligned ? syl[i].text : ""}</rt>
        </ruby>
      ))}
    </button>
  );
}

function WordPanel({ t }: { t: Token }) {
  if (!t.senses?.length) {
    return (
      <div>
        <h2 className="headword">{t.text}</h2>
        <p className="hint">Not in the dictionary.</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="headword">
        {t.text}
        {t.senses[0].variant && <span className="variant">{t.senses[0].variant}</span>}
      </h2>
      {t.senses.map((s, i) => (
        <div key={i} className="sense">
          <div className="reading">
            {(s.syllables ?? []).map((y, j) => (
              <span key={j} className={`tone${y.tone}`}>
                {y.text}{" "}
              </span>
            ))}
          </div>
          <ol>
            {s.defs.map((d, j) => (
              <li key={j}>{d}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
