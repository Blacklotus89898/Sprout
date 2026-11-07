// A temporary, per-browser history of the last 100 texts read and words
// looked up. It lives in localStorage only: nothing reaches the server, it
// can vanish (private windows, cleared site data), and every access is
// guarded so the reader works without it. Cards in phase 1b are the
// durable, server-side record.

import { useCallback, useState } from "react";

export interface HistoryItem {
  kind: "text" | "word";
  lang: string;
  value: string;
  at: number; // epoch ms
}

const KEY = "sprout.history.v1";
export const MAX_HISTORY = 100;

function load(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const items = raw ? (JSON.parse(raw) as HistoryItem[]) : [];
    return Array.isArray(items) ? items.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function save(items: HistoryItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked: history just isn't kept */
  }
}

/** Newest first; re-adding an entry moves it to the top instead of duplicating it. */
export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>(load);

  const add = useCallback((kind: HistoryItem["kind"], lang: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    setItems((prev) => {
      const next = [{ kind, lang, value: v, at: Date.now() }, ...prev.filter((i) => !(i.kind === kind && i.lang === lang && i.value === v))].slice(0, MAX_HISTORY);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    save([]);
    setItems([]);
  }, []);

  return { items, add, clear };
}
