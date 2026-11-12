// Saved words and a simple review schedule, kept in this browser only
// (ADR 0005). Like history.ts, every storage access is guarded: a private
// window or cleared site data means no saved words, never a broken reader.
// Export/import (JSON) is the backup, since nothing reaches the server.

import { useCallback, useEffect, useState } from "react";
import type { Syllable } from "./api";

export interface Card {
  lang: string;
  word: string;
  syllables: Syllable[]; // reading of the first sense; empty when none
  reading: string; // the reading as text (pinyin with tone marks)
  defs: string[]; // first sense's definitions
  sentence: string; // the sentence it was saved from ("" if none)
  added: number; // epoch ms
  box: number; // Leitner box: 0 = learning … INTERVAL_DAYS.length-1 = long-term
  due: number; // epoch ms
  reviews: number;
  lapses: number;
}

export type Grade = "again" | "good" | "easy";

const KEY = "sprout.cards.v1";
const DAY = 86_400_000;
/** Days until the next review, by box. Box 0 is "again": back in 10 minutes. */
export const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35, 90];
const AGAIN_MS = 10 * 60_000;

/**
 * Next state after a review (pure, deterministic). Again drops to box 0;
 * Good moves up one box; Easy moves up two.
 */
export function schedule(c: Card, g: Grade, now: number): Card {
  const top = INTERVAL_DAYS.length - 1;
  const box = g === "again" ? 0 : Math.min(top, Math.max(1, c.box + (g === "easy" ? 2 : 1)));
  const due = box === 0 ? now + AGAIN_MS : now + INTERVAL_DAYS[box] * DAY;
  return { ...c, box, due, reviews: c.reviews + 1, lapses: c.lapses + (g === "again" && c.box > 0 ? 1 : 0) };
}

/** How long a grade would push the card out, for the button labels. */
export function preview(c: Card, g: Grade): string {
  const s = schedule(c, g, 0);
  if (s.box === 0) return "10 min";
  const d = INTERVAL_DAYS[s.box];
  return d === 1 ? "1 day" : d < 30 ? `${d} days` : `${Math.round(d / 30)} mo`;
}

export const sameCard = (a: { lang: string; word: string }, b: { lang: string; word: string }) => a.lang === b.lang && a.word === b.word;

/** Keep only well-formed cards (storage and imports are untrusted). */
export function sanitize(raw: unknown): Card[] {
  if (!Array.isArray(raw)) return [];
  const out: Card[] = [];
  for (const x of raw as Partial<Card>[]) {
    if (!x || typeof x.lang !== "string" || typeof x.word !== "string" || !x.word.trim()) continue;
    if (out.some((c) => sameCard(c, x as Card))) continue;
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    out.push({
      lang: x.lang,
      word: x.word.slice(0, 64),
      syllables: Array.isArray(x.syllables)
        ? x.syllables.filter((s) => s && typeof s.text === "string" && typeof s.tone === "number").slice(0, 32)
        : [],
      reading: typeof x.reading === "string" ? x.reading.slice(0, 200) : "",
      defs: Array.isArray(x.defs) ? x.defs.filter((d) => typeof d === "string").slice(0, 12) : [],
      sentence: typeof x.sentence === "string" ? x.sentence.slice(0, 500) : "",
      added: num(x.added, Date.now()),
      box: Math.min(INTERVAL_DAYS.length - 1, Math.max(0, Math.round(num(x.box, 0)))),
      due: num(x.due, 0),
      reviews: num(x.reviews, 0),
      lapses: num(x.lapses, 0),
    });
  }
  return out;
}

function load(): Card[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function save(cards: Card[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch {
    /* storage full or blocked: changes last until the tab closes */
  }
}

export type NewCard = Pick<Card, "lang" | "word" | "syllables" | "defs" | "sentence">;

export function useCards() {
  const [cards, setCards] = useState<Card[]>(load);
  const [now, setNow] = useState(Date.now());

  // Re-check what's due every minute, and pick up changes from other tabs.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    const onStorage = (e: StorageEvent) => e.key === KEY && setCards(load());
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((f: (prev: Card[]) => Card[]) => {
    setCards((prev) => {
      const next = f(prev);
      save(next);
      return next;
    });
    setNow(Date.now());
  }, []);

  const add = useCallback(
    (c: NewCard) =>
      update((prev) => {
        if (prev.some((p) => sameCard(p, c))) return prev;
        const t = Date.now();
        const reading = c.syllables.map((s) => s.text).join(" ");
        return [{ ...c, reading, added: t, box: 0, due: t, reviews: 0, lapses: 0 }, ...prev];
      }),
    [update],
  );
  const remove = useCallback((c: { lang: string; word: string }) => update((prev) => prev.filter((p) => !sameCard(p, c))), [update]);
  const grade = useCallback(
    (c: Card, g: Grade) => update((prev) => prev.map((p) => (sameCard(p, c) ? schedule(p, g, Date.now()) : p))),
    [update],
  );
  /** Merge an exported file; cards already saved keep their own progress. */
  const importJSON = useCallback(
    (json: string): number => {
      const incoming = sanitize(JSON.parse(json));
      let added = 0;
      update((prev) => {
        const fresh = incoming.filter((c) => !prev.some((p) => sameCard(p, c)));
        added = fresh.length;
        return [...prev, ...fresh];
      });
      return added;
    },
    [update],
  );

  const has = useCallback((lang: string, word: string) => cards.some((c) => c.lang === lang && c.word === word), [cards]);
  // `now` ticks each minute; Date.now() also counts a word saved a moment ago.
  const t = Math.max(now, Date.now());
  const due = cards.filter((c) => c.due <= t).sort((a, b) => a.due - b.due);

  return { cards, due, has, add, remove, grade, importJSON };
}
