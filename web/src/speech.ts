// Pronunciation through the browser's own speech engine (Web Speech API).
// ADR 0001 §5, phase 1: free, nothing recorded or stored. Voice quality and
// availability depend on the device (Windows, Android and iOS ship Mandarin).

import { useEffect, useState } from "react";

// Sprout pack code → BCP 47 tag the speech engines use.
const SPEECH_LANG: Record<string, string> = {
  "cmn-Hans": "zh-CN",
  "yue-Hant": "zh-HK",
  es: "es-ES",
};

export const supported = typeof window !== "undefined" && "speechSynthesis" in window;

// Best voice for a pack: exact locale first, then the same language prefix.
function pickVoice(voices: SpeechSynthesisVoice[], pack: string): SpeechSynthesisVoice | undefined {
  const want = (SPEECH_LANG[pack] ?? pack).toLowerCase();
  const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  return (
    voices.find((v) => norm(v) === want && v.localService) ??
    voices.find((v) => norm(v) === want) ??
    voices.find((v) => norm(v).startsWith(want.split("-")[0] + "-"))
  );
}

/** The voice for a pack; undefined while voices load or if the device has none. */
export function useVoice(pack: string): SpeechSynthesisVoice | undefined {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (supported ? speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (!supported) return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update(); // Chrome loads voices asynchronously; Safari and Firefox mostly don't
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return pickVoice(voices, pack);
}

/** Speak text, cancelling anything already playing. */
export function speak(text: string, pack: string, voice: SpeechSynthesisVoice | undefined, slow: boolean) {
  if (!supported || !text.trim()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? SPEECH_LANG[pack] ?? pack;
  if (voice) u.voice = voice;
  u.rate = slow ? 0.6 : 0.9; // learners: a touch below native speed by default
  speechSynthesis.speak(u);
}
