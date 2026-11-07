import { useEffect, useState } from "react";
import * as api from "./api";
import type { Features, Language, ReadResult, Token } from "./api";
import { MAX_HISTORY, useHistory, type HistoryItem } from "./history";
import { speak, stop, supported as speechSupported, useSpeaking, useVoice } from "./speech";
import { Translate } from "./Translate";

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
  const [slow, setSlow] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useHistory();
  const voice = useVoice(result?.lang ?? lang);
  const speaking = useSpeaking();
  const [features, setFeatures] = useState<Features | null>(null);

  useEffect(() => {
    api.languages().then(setLangs).catch((e) => setError(String(e.message ?? e)));
    api.features().then(setFeatures).catch(() => setFeatures(null));
  }, []);

  async function readText(l: string, t: string, record = true) {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const r = await api.read(l, t);
      setResult(r);
      if (record) history.add("text", l, t);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function pick(i: number) {
    setSelected(i);
    const t = result?.tokens[i];
    if (t && result) history.add("word", result.lang, t.text);
  }

  async function reopen(h: HistoryItem) {
    setShowHistory(false);
    setLang(h.lang);
    setText(h.value);
    const r = await readText(h.lang, h.value, h.kind === "text");
    // A word opens with its panel showing.
    if (r && h.kind === "word") {
      const i = r.tokens.findIndex((t) => t.kind === "word");
      if (i >= 0) setSelected(i);
    }
  }

  const say = (s: string) => speak(s, result?.lang ?? lang, voice, slow);
  const current = langs.find((l) => l.code === lang);
  const words = result?.tokens.filter((t) => t.kind === "word").length ?? 0;
  const sel = selected !== null ? result?.tokens[selected] : undefined;
  const canSpeak = speechSupported && !!voice;

  return (
    <div className="app">
      <header>
        <h1>🌱 Sprout</h1>
        <span className="tagline">Read real text. Tap a word.</span>
        <button className="link" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          History ({history.items.length})
        </button>
      </header>

      {showHistory && <HistoryList items={history.items} onOpen={reopen} onClear={history.clear} />}

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
          <label className="toggle" title="Slower speech">
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />
            slow audio
          </label>
          <button onClick={() => readText(lang, text)} disabled={busy || !text.trim()}>
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
              <TokenView key={i} t={t} showReading={showReading} active={i === selected} onPick={() => pick(i)} />
            ))}
            <p className="stats">
              {canSpeak && (
                <button className="speak" onClick={() => say(result.tokens.map((t) => t.text).join(""))} aria-label="Read the whole text aloud">
                  🔊 Read aloud
                </button>
              )}
              {words} words · {result.known} in the dictionary
              {current?.dictionary && <> · {current.dictionary}</>}
            </p>
            {speechSupported && !voice && (
              <p className="stats">No voice for this language on this device. Install a Chinese (zh-CN) voice in your OS speech settings to hear it.</p>
            )}
          </article>
          <aside className="panel">
            {sel ? <WordPanel t={sel} onSpeak={canSpeak ? say : undefined} /> : <p className="hint">Tap a word to see its meaning.</p>}
          </aside>
        </main>
      )}

      {features && <Translate langs={langs} features={features} initialText={result ? result.tokens.map((t) => t.text).join("") : text} initialLang={result?.lang ?? lang} slow={slow} />}

      {speaking && (
        <button className="stop" onClick={stop} aria-label="Stop audio">
          ■ Stop
        </button>
      )}

      <footer>
        Dictionary: <a href="https://cc-cedict.org">CC-CEDICT</a> (CC BY-SA 4.0) · Audio: your device's speech voices · Translation: Google ·{" "}
        <a href="https://github.com/Blacklotus89898/Sprout">source</a>
      </footer>
    </div>
  );
}

function HistoryList({ items, onOpen, onClear }: { items: HistoryItem[]; onOpen: (h: HistoryItem) => void; onClear: () => void }) {
  return (
    <section className="history">
      <div className="history-head">
        <strong>Recent</strong>
        <span className="hint">
          last {MAX_HISTORY}, kept in this browser only
        </span>
        {items.length > 0 && (
          <button className="link" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="hint">Nothing yet. Texts you read and words you tap show up here.</p>
      ) : (
        <ul>
          {items.map((h) => (
            <li key={`${h.kind}:${h.lang}:${h.value}`}>
              <button className="history-item" onClick={() => onOpen(h)} title={h.value}>
                <span className={`badge ${h.kind}`}>{h.kind}</span>
                <span className="history-value">{h.value}</span>
                <time className="hint">{new Date(h.at).toLocaleString()}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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

function WordPanel({ t, onSpeak }: { t: Token; onSpeak?: (s: string) => void }) {
  const speakBtn = onSpeak && (
    <button className="speak" onClick={() => onSpeak(t.text)} aria-label={`Pronounce ${t.text}`}>
      🔊
    </button>
  );
  if (!t.senses?.length) {
    return (
      <div>
        <h2 className="headword">
          {t.text} {speakBtn}
        </h2>
        <p className="hint">Not in the dictionary.</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="headword">
        {t.text}
        {t.senses[0].variant && <span className="variant">{t.senses[0].variant}</span>} {speakBtn}
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
