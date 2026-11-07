// Types mirror the Go API (main.go, internal/lang). Keep them in sync.

export type Kind = "word" | "punct" | "space";

export interface Syllable {
  text: string;
  tone: number; // 1–4, 5 neutral, 0 untoned
}

export interface Sense {
  headword: string;
  variant?: string;
  reading?: string;
  syllables?: Syllable[];
  defs: string[];
}

export interface Token {
  text: string;
  start: number;
  end: number;
  kind: Kind;
  senses?: Sense[];
}

export interface ReadResult {
  lang: string;
  tokens: Token[];
  known: number;
}

export interface Language {
  code: string;
  name: string;
  romanization?: string;
  dictionary?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const languages = () => call<Language[]>("/api/languages");

export const read = (lang: string, text: string) =>
  call<ReadResult>("/api/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang, text }),
  });
