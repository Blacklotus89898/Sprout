import { useEffect, useMemo, useState } from "react";
import * as api from "./api";
import type { Features, Language, ReadResult, Token } from "./api";
import { MAX_HISTORY, useHistory, type HistoryItem } from "./history";
import { speak, stop, supported as speechSupported, useSpeaking, useSpeechProgress, useVoice } from "./speech";
import { Practice } from "./Practice";
import { Shadow, sentences } from "./Shadow";
import { Translate } from "./Translate";
import { TokenView } from "./Tokens";
import { Tutor } from "./Tutor";
import { Words } from "./Words";
import { useCards, type Card } from "./cards";

const SAMPLE =
  "我们每天学习中文。今天天气非常好，我和朋友一起去公园散步，然后在咖啡馆看书。";

type Mode = "read" | "words" | "tutor";

export function App() {
  const [mode, setMode] = useState<Mode>("read");
  const cards = useCards();
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
  const voicePack = mode === "read" ? (result?.lang ?? lang) : lang;
  const voice = useVoice(voicePack);
  const speaking = useSpeaking();
  const progress = useSpeechProgress();
  const [features, setFeatures] = useState<Features | null>(null);
  const [editing, setEditing] = useState(false); // text box open after a text has been read
  const [sentence, setSentence] = useState(0); // shadowing position

  useEffect(() => {
    api.languages().then(setLangs).catch((e) => setError(String(e.message ?? e)));
    api.features().then(setFeatures).catch(() => setFeatures(null));
    // Open on a ready-to-use reader instead of an empty page.
    void readText("cmn-Hans", SAMPLE, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readText(l: string, t: string, record = true) {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const r = await api.read(l, t);
      setResult(r);
      setEditing(false);
      setSentence(0);
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

  const say = (s: string) => speak(s, voicePack, voice, slow);
  // Saved words can be in another language than the one selected.
  const sayIn = (s: string, l: string) => speak(s, l, l === voicePack ? voice : undefined, slow);

  async function openCard(c: Card) {
    setMode("read");
    setLang(c.lang);
    const t = c.sentence || c.word;
    setText(t);
    const r = await readText(c.lang, t, false);
    const i = r ? r.tokens.findIndex((x) => x.text === c.word) : -1;
    if (i >= 0) setSelected(i);
  }
  const current = langs.find((l) => l.code === lang);
  const words = result?.tokens.filter((t) => t.kind === "word").length ?? 0;
  const sel = selected !== null ? result?.tokens[selected] : undefined;
  const canSpeak = speechSupported && !!voice;
  const fullText = result ? result.tokens.map((t) => t.text).join("") : "";
  const sents = useMemo(() => (result ? sentences(result.tokens) : []), [result]);
  const showInput = !result || editing;
  const selSentence = selected !== null ? sents.find((x) => selected >= x.start && selected < x.end)?.text ?? "" : "";
  const studying = cards.cards.filter((c) => c.lang === lang).map((c) => c.word);
  // The token being spoken while the whole text is read aloud. Speech
  // positions are UTF-16 indexes, so walk the tokens in that unit.
  let speakingAt = -1;
  if (progress && result && progress.text === fullText) {
    for (let i = 0, off = 0; i < result.tokens.length; off += result.tokens[i].text.length, i++) {
      if (progress.pos < off + result.tokens[i].text.length) {
        speakingAt = i;
        break;
      }
    }
  }

  return (
    <div className="app">
      <header>
        <h1>🌱 Sprout</h1>
        <span className="tagline">Read real text. Tap a word.</span>
        <nav className="modes" aria-label="Sections">
          {(
            [
              ["read", "📖 Read"],
              ["words", `⭐ Words${cards.due.length ? ` (${cards.due.length} due)` : ""}`],
              ["tutor", "💬 Tutor"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} className={`mode${mode === m ? " on" : ""}`} onClick={() => setMode(m)} aria-current={mode === m ? "page" : undefined}>
              {label}
            </button>
          ))}
        </nav>
        <button className="link" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          History ({history.items.length})
        </button>
      </header>

      {showHistory && <HistoryList items={history.items} onOpen={reopen} onClear={history.clear} />}

      {mode === "words" && <Words cards={cards} onSpeak={speechSupported ? sayIn : undefined} onOpen={openCard} />}

      {mode === "tutor" && (
        <>
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
            </div>
          </section>
          <Tutor
            pack={lang}
            langName={current?.name ?? lang}
            studying={studying}
            showReading={showReading}
            onSpeak={canSpeak ? say : undefined}
            isSaved={(w) => cards.has(lang, w)}
            onSave={cards.add}
          />
        </>
      )}

      {mode === "read" && (
        <>
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
          {showInput ? (
            <button onClick={() => readText(lang, text)} disabled={busy || !text.trim()}>
              {busy ? "Reading…" : "Read"}
            </button>
          ) : (
            <button onClick={() => setEditing(true)}>✎ New text</button>
          )}
          {editing && result && (
            <button className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
        {showInput && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus={editing}
            placeholder="Paste text in the language you're learning: an article, lyrics, a message from a friend…"
          />
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <main className="reader-layout">
          <div className="reader-col">
            <article className="reader" lang={result.lang}>
              {result.tokens.map((t, i) => (
                <TokenView key={i} t={t} showReading={showReading} active={i === selected} speaking={i === speakingAt} saved={t.kind === "word" && cards.has(result.lang, t.text)} onPick={() => pick(i)} />
              ))}
              <p className="stats">
                {canSpeak && (
                  <button className="speak" onClick={() => say(fullText)} aria-label="Read the whole text aloud">
                    🔊 Read aloud
                  </button>
                )}
                {words} words · {result.known} in the dictionary
                {current?.dictionary && <> · {current.dictionary}</>}
              </p>
              <p className="stats">
                Tap any word for its meaning, its sound and pronunciation practice.
                {current?.romanization === "pinyin" && (
                  <span className="legend" aria-label="Tone colors">
                    {" "}
                    Tones: <span className="tone1">1 ā</span> <span className="tone2">2 á</span> <span className="tone3">3 ǎ</span>{" "}
                    <span className="tone4">4 à</span> <span className="tone5">neutral a</span>
                  </span>
                )}
              </p>
              {speechSupported && !voice && (
                <p className="stats">No voice for this language on this device. Install a Chinese (zh-CN) voice in your OS speech settings to hear it.</p>
              )}
            </article>
            {features && <Translate langs={langs} features={features} initialText={fullText} initialLang={result.lang} slow={slow} attached />}
            <Shadow list={sents} index={Math.min(sentence, sents.length - 1)} onIndex={setSentence} onSpeak={canSpeak ? say : undefined} />
          </div>
          <aside className="panel">
            {sel ? (
              <WordPanel
                t={sel}
                onSpeak={canSpeak ? say : undefined}
                saved={cards.has(result.lang, sel.text)}
                onSave={() => sel.senses?.[0] && cards.add({ lang: result.lang, word: sel.text, syllables: sel.senses[0].syllables ?? [], defs: sel.senses[0].defs, sentence: selSentence })}
              />
            ) : <p className="hint">Tap a word to see its meaning.</p>}
          </aside>
        </main>
      )}

      {features && !result && <Translate langs={langs} features={features} initialText={text} initialLang={lang} slow={slow} />}
        </>
      )}

      {speaking && (
        <>
          <div
            className="speech-progress"
            role="progressbar"
            aria-label="Speech progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)}
          >
            <span style={{ width: `${(progress?.fraction ?? 0) * 100}%` }} />
          </div>
          <button className="stop" onClick={stop} aria-label="Stop audio">
            ■ Stop
          </button>
        </>
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

function WordPanel({ t, onSpeak, saved, onSave }: { t: Token; onSpeak?: (s: string) => void; saved: boolean; onSave: () => void }) {
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
        <Practice key={t.text} word={t.text} syllables={[]} onSpeak={onSpeak && (() => onSpeak(t.text))} />
      </div>
    );
  }
  return (
    <div>
      <h2 className="headword">
        {t.text}
        {t.senses[0].variant && <span className="variant">{t.senses[0].variant}</span>} {speakBtn}
        <button className="save" onClick={onSave} disabled={saved} title={saved ? "In your saved words" : "Save for review"}>
          {saved ? "✓ Saved" : "＋ Save"}
        </button>
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
      <h3 className="practice-title">Practice</h3>
      <Practice key={t.text} word={t.text} syllables={t.senses[0].syllables ?? []} onSpeak={onSpeak && (() => onSpeak(t.text))} />
    </div>
  );
}
