import { useEffect, useState } from "react";
import * as api from "./api";
import type { Features, Language, TranslateResult } from "./api";
import { speak, supported as speechSupported, useVoice } from "./speech";

// Color-matched translation (ADR 0001 §4): each source word and the piece of
// the translation that renders it share a color. Hovering or tapping one side
// highlights its partner on the other.

const PALETTE = 10; // .c0 … .c9 in styles.css, reused cyclically

export function Translate({
  langs,
  features,
  initialText,
  initialLang,
  slow,
}: {
  langs: Language[];
  features: Features;
  initialText: string;
  initialLang: string;
  slow: boolean;
}) {
  const [from, setFrom] = useState(initialLang);
  const [to, setTo] = useState("en");
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<number | null>(null); // highlighted color group
  const voiceTo = useVoice(result?.target ?? to);

  // Follow the reader's text and language until the user edits here.
  useEffect(() => setText(initialText), [initialText]);
  useEffect(() => setFrom(initialLang), [initialLang]);

  async function run(f = from, t = to, s = text) {
    setBusy(true);
    setError("");
    setFocus(null);
    try {
      setResult(await api.translate(f, t, s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function swap() {
    // Translate back: the old translation becomes the new source.
    const nextText = result?.translation ?? text;
    const [f, t] = [to, from];
    setFrom(f);
    setTo(t);
    setText(nextText);
    if (result) void run(f, t, nextText);
  }

  if (!features.translate) {
    return (
      <section className="translate">
        <h2>Translate</h2>
        <p className="hint">Translation isn't configured on this server yet (it needs a Claude API key).</p>
      </section>
    );
  }

  const tooLong = [...text].length > features.translateMaxChars;
  const cls = (c: number | undefined) =>
    c === undefined || c < 0 ? "piece" : `piece c${c % PALETTE}${focus === c ? " focus" : ""}${focus !== null && focus !== c ? " dim" : ""}`;

  return (
    <section className="translate">
      <h2>Translate</h2>
      <div className="controls">
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
          {langs.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={swap} disabled={busy} aria-label="Swap languages" title="Swap (translates the result back)">
          ⇄
        </button>
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
          {features.translateTargets.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name.split(" (")[0]}
            </option>
          ))}
        </select>
        <button onClick={() => run()} disabled={busy || !text.trim() || tooLong || from === to}>
          {busy ? "Translating…" : "Translate"}
        </button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Text to translate" />
      {tooLong && <p className="error">Up to {features.translateMaxChars} characters per translation.</p>}
      {from === to && <p className="hint">Pick two different languages.</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="pair" onMouseLeave={() => setFocus(null)}>
          <p className="side" lang={result.source}>
            {result.srcTokens.map((t, i) => {
              const c = result.srcColors?.[i];
              return t.kind === "word" ? (
                <span key={i} className={cls(c)} onMouseEnter={() => c !== undefined && c >= 0 && setFocus(c)} onClick={() => setFocus(c ?? null)}>
                  {t.text}
                </span>
              ) : (
                <span key={i}>{t.text}</span>
              );
            })}
          </p>
          <p className="side target" lang={result.target}>
            {result.segments.map((s, j) => {
              const c = result.segColors?.[j];
              return (
                <span key={j} className={cls(c)} onMouseEnter={() => c !== undefined && c >= 0 && setFocus(c)} onClick={() => setFocus(c ?? null)}>
                  {s.text}
                </span>
              );
            })}
            {speechSupported && voiceTo && (
              <button className="speak inline" onClick={() => speak(result.translation, result.target, voiceTo, slow)} aria-label="Read the translation aloud">
                🔊
              </button>
            )}
          </p>
          {!result.aligned && <p className="hint">{result.note}</p>}
          <p className="hint small">Machine translation by Claude. Matching colors show which words translate which.</p>
        </div>
      )}
    </section>
  );
}
