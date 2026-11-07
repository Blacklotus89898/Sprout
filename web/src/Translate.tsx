import { useEffect, useState } from "react";
import * as api from "./api";
import type { Features, Language, TranslateResult } from "./api";
import * as browser from "./browserTranslate";
import { speak, supported as speechSupported, useVoice } from "./speech";

// Color-matched translation (ADR 0002, 0003): Google translates, preferably
// on-device through Chrome's built-in translator, else via the server key.
// Sprout's own
// dictionary colors a Chinese word and an English word alike only when the
// word's CC-CEDICT definitions contain it. Unproven words stay plain.
// Hovering or tapping one side highlights its partner on the other.

const PALETTE = 10; // .c0 … .c9 in styles.css, reused cyclically

export function Translate({
  langs,
  features,
  initialText,
  initialLang,
  slow,
  attached = false,
}: {
  langs: Language[];
  features: Features;
  initialText: string;
  initialLang: string;
  slow: boolean;
  attached?: boolean; // under the reader: translates the text being read, so no source picker or text box
}) {
  const [from, setFrom] = useState(initialLang);
  const [to, setTo] = useState("en");
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<number | null>(null); // highlighted color group
  const [engine, setEngine] = useState<"device" | "cloud">("device");
  const [progress, setProgress] = useState<number | null>(null); // model download, 0–1
  const voiceTo = useVoice(result?.target ?? to);

  // Follow the reader's text and language until the user edits here.
  useEffect(() => setText(initialText), [initialText]);
  useEffect(() => setFrom(initialLang), [initialLang]);
  // When the on-device model is already there, translating is free and
  // instant: do it as soon as a text is read, so the meaning sits under it.
  useEffect(() => {
    let live = true;
    if (initialText.trim() && initialLang !== to && [...initialText].length <= features.translateMaxChars) {
      void browser.ready(initialLang, to).then((ok) => {
        if (ok && live) void run(initialLang, to, initialText);
      });
    }
    return () => {
      live = false;
    };
  }, [initialText, initialLang]);

  async function run(f = from, t = to, s = text) {
    setBusy(true);
    setError("");
    setFocus(null);
    try {
      // On-device first (free, offline); the server's Google key otherwise.
      const local = browser.supported ? await browser.translate(f, t, s, setProgress).catch(() => null) : null;
      if (local) {
        const r = await api.align(f, t, s, local.translation);
        if (local.note) r.note = r.note ? `${local.note} ${r.note}` : local.note;
        setEngine("device");
        setResult(r);
      } else if (features.translate) {
        setEngine("cloud");
        setResult(await api.translate(f, t, s));
      } else {
        throw new Error("This browser can't translate this pair on-device, and the server has no Google Translate key.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
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

  if (!features.translate && !browser.supported) {
    return (
      <section className="translate">
        <h2>Translate</h2>
        <p className="hint">Translation isn't configured on this server yet . Open Sprout in desktop Chrome (138+) to translate on-device for free, or add a Google Translate API key to the server.</p>
      </section>
    );
  }

  const tooLong = [...text].length > features.translateMaxChars;
  const cls = (c: number | undefined) =>
    c === undefined || c < 0 ? "piece" : `piece c${c % PALETTE}${focus === c ? " focus" : ""}${focus !== null && focus !== c ? " dim" : ""}`;

  return (
    <section className="translate">
      {!attached && <h2>Translate</h2>}
      <div className="controls">
        {attached && <span className="hint">Translate to</span>}
        {!attached && (
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
          {langs.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        )}
        {!attached && (
        <button className="secondary" onClick={swap} disabled={busy} aria-label="Swap languages" title="Swap (translates the result back)">
          ⇄
        </button>
        )}
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
          {features.translateTargets.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name.split(" (")[0]}
            </option>
          ))}
        </select>
        <button onClick={() => run()} disabled={busy || !text.trim() || tooLong || from === to}>
          {busy ? (progress !== null && progress < 1 ? `Downloading model ${Math.round(progress * 100)}%` : "Translating…") : "Translate"}
        </button>
      </div>
      {!attached && <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Text to translate" />}
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
            {result.tgtTokens.map((t, j) => {
              const c = result.tgtColors?.[j];
              return t.kind === "word" ? (
                <span key={j} className={cls(c)} onMouseEnter={() => c !== undefined && c >= 0 && setFocus(c)} onClick={() => setFocus(c ?? null)}>
                  {t.text}
                </span>
              ) : (
                <span key={j}>{t.text}</span>
              );
            })}
            {speechSupported && voiceTo && (
              <button className="speak inline" onClick={() => speak(result.translation, result.target, voiceTo, slow)} aria-label="Read the translation aloud">
                🔊
              </button>
            )}
          </p>
          {result.srcColors && (
            <p className="hint small">
              {result.matched} of {result.words} words matched by the dictionary. Matching colors are words the dictionary confirms; plain words weren't proven.
            </p>
          )}
          {result.note && <p className="hint">{result.note}</p>}
          <p className="hint small">
            Translation: {engine === "device" ? "Google's model, on this device (Chrome)" : "Google Translate"}. Word matching: CC-CEDICT, no AI.
          </p>
        </div>
      )}
    </section>
  );
}
