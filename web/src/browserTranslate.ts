// Chrome's built-in Translator API (desktop Chrome 138+): Google's translation
// model downloaded once and run on this device. Free, offline, no API key.
// Sprout prefers it when present and falls back to the server's Google Cloud
// key (if configured) elsewhere: phones, Safari, Firefox.
// https://developer.chrome.com/docs/ai/translator-api

type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface ChromeTranslator {
  translate(text: string): Promise<string>;
}

interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<ChromeTranslator>;
}

const api = (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;

export const supported = !!api;

// Sprout pack → the language tags Chrome's translator knows. It has no
// Cantonese; written Traditional Chinese is the nearest.
const CODE: Record<string, string> = { "cmn-Hans": "zh", "yue-Hant": "zh-Hant", es: "es", en: "en" };

const cache = new Map<string, Promise<ChromeTranslator>>();

/**
 * Translate on-device. Returns null when this browser can't do the pair, so
 * the caller can fall back to the server. onProgress gets 0–1 while a
 * language model downloads (first use of a pair only).
 */
export async function translate(
  from: string,
  to: string,
  text: string,
  onProgress?: (p: number) => void,
): Promise<{ translation: string; note?: string } | null> {
  const s = CODE[from], t = CODE[to];
  if (!api || !s || !t) return null;
  const key = `${s}>${t}`;
  let tr = cache.get(key);
  if (!tr) {
    const a = await api.availability({ sourceLanguage: s, targetLanguage: t });
    if (a === "unavailable") return null;
    tr = api.create({
      sourceLanguage: s,
      targetLanguage: t,
      monitor: (m) => m.addEventListener("downloadprogress", (e) => onProgress?.((e as ProgressEvent).loaded)),
    });
    cache.set(key, tr);
    tr.catch(() => cache.delete(key)); // a failed create (e.g. no user gesture) can be retried
  }
  const translation = await (await tr).translate(text);
  const canto = from === "yue-Hant" || to === "yue-Hant";
  return { translation, note: canto ? "Chrome's translator has no Cantonese, so this is written Traditional Chinese." : undefined };
}
