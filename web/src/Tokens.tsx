import type { Token } from "./api";

// One reader token: a tappable word with tone colors and reading, or plain
// punctuation/space. Shared by the reader and the tutor's replies.
export function TokenView({ t, showReading, active = false, speaking = false, saved = false, onPick }: { t: Token; showReading: boolean; active?: boolean; speaking?: boolean; saved?: boolean; onPick: () => void }) {
  if (t.kind !== "word") return <span className={`${t.kind}${speaking ? " speaking" : ""}`}>{t.text}</span>;
  const sense = t.senses?.[0];
  const syl = sense?.syllables ?? [];
  const chars = [...t.text];
  // Color per character by tone only when syllables line up 1:1 with characters.
  const aligned = syl.length === chars.length;
  return (
    <button className={`word${active ? " active" : ""}${speaking ? " speaking" : ""}${saved ? " saved" : ""}${sense ? "" : " unknown"}`} onClick={onPick} title={sense?.defs[0]}>
      {chars.map((c, i) => (
        <ruby key={i} className={aligned ? `tone${syl[i].tone}` : undefined}>
          {c}
          <rt>{showReading && aligned ? syl[i].text : ""}</rt>
        </ruby>
      ))}
    </button>
  );
}
