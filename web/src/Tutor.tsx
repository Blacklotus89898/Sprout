import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { ReadResult, Token } from "./api";
import type { NewCard } from "./cards";
import { TokenView } from "./Tokens";
import * as tutor from "./browserTutor";

// Chat with an on-device model in the language you're learning (ADR 0005).
// Its replies go through Sprout's own reader, so every word is tappable with
// its dictionary reading, and a reply full of unknown words is flagged.

type Turn = { who: "me"; text: string } | { who: "tutor"; r: tutor.Reply; read: ReadResult | null };

export function Tutor({
  pack,
  langName,
  studying,
  showReading,
  onSpeak,
  isSaved,
  onSave,
}: {
  pack: string;
  langName: string;
  studying: string[]; // saved words in this language, offered to the tutor
  showReading: boolean;
  onSpeak?: (text: string) => void;
  isSaved: (word: string) => boolean;
  onSave: (c: NewCard) => void;
}) {
  const [mode, setMode] = useState<tutor.Mode | null | undefined>(undefined); // undefined = checking
  const [scenario, setScenario] = useState<string>(tutor.SCENARIOS[0].id);
  const [level, setLevel] = useState<string>(tutor.LEVELS[0].id);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [pick, setPick] = useState<{ turn: number; tok: number } | null>(null);
  const session = useRef<tutor.Tutor | null>(null);
  const end = useRef<HTMLDivElement>(null);

  function reset() {
    session.current?.destroy();
    session.current = null;
    setTurns([]);
    setPick(null);
    setOverflow(false);
    setError("");
  }

  useEffect(() => {
    reset();
    setMode(undefined);
    let live = true;
    void tutor.probe(pack).then((m) => live && setMode(m));
    return () => {
      live = false;
      session.current?.destroy();
      session.current = null;
    };
  }, [pack]);

  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollIntoView, and
    // an effect may only return a cleanup function.
    void end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, busy]);

  async function tutorTurn(text: string | null) {
    const s = session.current;
    if (!s) return;
    const r = await s.ask(text);
    const read = await api.read(pack, r.reply).catch(() => null);
    setTurns((t) => [...t, { who: "tutor", r, read }]);
    if (autoSpeak) onSpeak?.(r.reply);
  }

  async function begin() {
    if (!mode) return;
    reset();
    setBusy(true);
    try {
      // Straight from the click: creating may download the model (user gesture needed).
      session.current = await tutor.start(pack, mode, scenario, level, studying, setProgress);
      session.current.onOverflow(() => setOverflow(true));
      setProgress(null);
      setMode({ ...mode, state: "available" });
      await tutorTurn(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !session.current) return;
    setInput("");
    setTurns((t) => [...t, { who: "me", text }]);
    setBusy(true);
    setError("");
    try {
      await tutorTurn(text);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!tutor.tutorable(pack)) return <section className="tutor"><p className="hint">No tutor for {langName} yet.</p></section>;
  if (mode === undefined) return <section className="tutor"><p className="hint">Checking this browser's built-in AI…</p></section>;
  if (mode === null) {
    return (
      <section className="tutor">
        <h2>💬 Conversation tutor</h2>
        <p className="hint">
          The tutor runs on Chrome's built-in AI model (Gemini Nano), on this device, for free. This browser doesn't offer it. It needs desktop
          Chrome 148 or newer on Windows, macOS or Linux, about 22 GB of free disk, and a GPU with more than 4 GB of memory (or 16 GB of RAM).
          Check <code>chrome://on-device-internals</code> for the model's status.
        </p>
      </section>
    );
  }

  const started = !!session.current || turns.length > 0;
  const picked = pick && turns[pick.turn]?.who === "tutor" ? (turns[pick.turn] as Extract<Turn, { who: "tutor" }>).read?.tokens[pick.tok] : undefined;

  return (
    <section className="tutor">
      <div className="tutor-head">
        <h2>💬 Conversation tutor</h2>
        <span className="hint small">
          On-device (Chrome's Gemini Nano): free, private.{" "}
          {mode.kind === "experimental" && <strong className="warn">Experimental for {langName}: Chrome doesn't officially support it yet, so replies may be weak or in the wrong language.</strong>}
        </span>
      </div>
      <div className="controls">
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario" disabled={busy}>
          {tutor.SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level" disabled={busy}>
          {tutor.LEVELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button onClick={begin} disabled={busy}>
          {started ? "↻ New conversation" : "Start"}
        </button>
        {onSpeak && (
          <label className="toggle">
            <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />
            speak replies
          </label>
        )}
      </div>
      {!started && mode.state !== "available" && !busy && (
        <p className="hint small">The first start downloads the model once (a few GB); after that it works offline.</p>
      )}
      {progress !== null && <p className="hint small">Downloading the model… {Math.round(progress * 100)}%</p>}

      <div className="chat">
        {turns.map((t, i) =>
          t.who === "me" ? (
            <div key={i} className="bubble me" lang={pack}>
              {t.text}
            </div>
          ) : (
            <TutorBubble key={i} t={t} pack={pack} showReading={showReading} onSpeak={onSpeak} picked={pick?.turn === i ? pick.tok : null} onPick={(tok) => setPick({ turn: i, tok })} />
          ),
        )}
        {busy && started && <div className="bubble tutor hint">…</div>}
        <div ref={end} />
      </div>

      {picked && <Gloss t={picked} pack={pack} onSpeak={onSpeak} saved={isSaved(picked.text)} onSave={onSave} sentence={(turns[pick!.turn] as Extract<Turn, { who: "tutor" }>).r.reply} />}

      {overflow && <p className="hint small">The conversation got long, so the tutor has forgotten its oldest turns.</p>}
      {error && <p className="error small">{error}</p>}

      {started && (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Answer in ${langName} (or English if you're stuck)`} lang={pack} disabled={busy} />
          <button type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      )}
      <p className="hint small">Tap a word in a reply for its meaning. Suggestions come from the model and can be wrong; Sprout's dictionary and tone check are the reference.</p>
    </section>
  );
}

function TutorBubble({
  t,
  pack,
  showReading,
  onSpeak,
  picked,
  onPick,
}: {
  t: { r: tutor.Reply; read: ReadResult | null };
  pack: string;
  showReading: boolean;
  onSpeak?: (s: string) => void;
  picked: number | null;
  onPick: (tok: number) => void;
}) {
  const [showEnglish, setShowEnglish] = useState(false);
  const words = t.read?.tokens.filter((x) => x.kind === "word").length ?? 0;
  // Sprout's own check on the model: a reply mostly made of words the
  // dictionary doesn't know is probably garbled.
  const doubtful = t.read && words >= 3 && t.read.known / words < 0.5;
  return (
    <div className="bubble tutor">
      {t.r.suggested && (
        <div className="suggestion">
          <span className="hint small">Try saying:</span> <span lang={pack}>{t.r.suggested}</span>
          {onSpeak && (
            <button className="speak inline" onClick={() => onSpeak(t.r.suggested)} aria-label="Hear the suggestion">
              🔊
            </button>
          )}
          {t.r.why && <div className="hint small">{t.r.why}</div>}
        </div>
      )}
      <div className="reply" lang={pack}>
        {t.read ? t.read.tokens.map((x, i) => <TokenView key={i} t={x} showReading={showReading} active={picked === i} onPick={() => onPick(i)} />) : t.r.reply}
        {onSpeak && (
          <button className="speak inline" onClick={() => onSpeak(t.r.reply)} aria-label="Hear the reply">
            🔊
          </button>
        )}
      </div>
      {t.r.english && (
        <button className="link english" onClick={() => setShowEnglish((v) => !v)}>
          {showEnglish ? t.r.english : "Show English"}
        </button>
      )}
      {doubtful && <p className="hint small">⚠ Many words here aren't in the dictionary; this reply may be garbled.</p>}
    </div>
  );
}

function Gloss({ t, pack, onSpeak, saved, onSave, sentence }: { t: Token; pack: string; onSpeak?: (s: string) => void; saved: boolean; onSave: (c: NewCard) => void; sentence: string }) {
  const s = t.senses?.[0];
  return (
    <div className="gloss">
      <strong lang={pack}>{t.text}</strong>{" "}
      {(s?.syllables ?? []).map((y, j) => (
        <span key={j} className={`tone${y.tone}`}>
          {y.text}{" "}
        </span>
      ))}
      {onSpeak && (
        <button className="speak inline" onClick={() => onSpeak(t.text)} aria-label={`Pronounce ${t.text}`}>
          🔊
        </button>
      )}
      <span className="hint"> {s ? s.defs.slice(0, 3).join("; ") : "Not in the dictionary."}</span>
      {s && (
        <button className="save" onClick={() => onSave({ lang: pack, word: t.text, syllables: s.syllables ?? [], defs: s.defs, sentence })} disabled={saved}>
          {saved ? "✓ Saved" : "＋ Save"}
        </button>
      )}
    </div>
  );
}

function message(e: unknown): string {
  if (e instanceof DOMException && e.name === "NotAllowedError") return "Chrome blocked the model. Press Start again (it needs a click).";
  if (e instanceof DOMException && e.name === "NotSupportedError") return "Chrome's model doesn't support this language.";
  return e instanceof Error ? e.message : String(e);
}
