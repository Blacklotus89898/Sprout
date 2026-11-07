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

// "Speaking" state shared by every component: one engine, one queue.
const listeners = new Set<(on: boolean) => void>();
function setSpeaking(on: boolean) {
  listeners.forEach((l) => l(on));
}

/** True while anything is being spoken (drives the Stop button). */
export function useSpeaking(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return on;
}

// Progress of the current utterance, for the progress line and the
// highlighted word. Engines that fire word "boundary" events give the exact
// position; the rest (several Chinese voices) get an estimate from elapsed
// time, which the end event then snaps to 100%.
export type Progress = { text: string; pos: number; fraction: number };
const progressListeners = new Set<(p: Progress | null) => void>();
function setProgress(p: Progress | null) {
  progressListeners.forEach((l) => l(p));
}

/** Where speech currently is; null when nothing is playing. */
export function useSpeechProgress(): Progress | null {
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => {
    progressListeners.add(setP);
    return () => {
      progressListeners.delete(setP);
    };
  }, []);
  return p;
}

// Rough characters per second at rate 1, for the time-based estimate.
const CPS: Record<string, number> = { "cmn-Hans": 5, "yue-Hant": 5 };
let ticker: number | undefined;
// Chrome drops events of an utterance that has been garbage-collected while
// still speaking; holding it here keeps onend/onboundary firing.
let current: SpeechSynthesisUtterance | null = null;

/** Speak text, cancelling anything already playing. */
export function speak(text: string, pack: string, voice: SpeechSynthesisVoice | undefined, slow: boolean) {
  if (!supported || !text.trim()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? SPEECH_LANG[pack] ?? pack;
  if (voice) u.voice = voice;
  u.rate = slow ? 0.6 : 0.9; // learners: a touch below native speed by default
  const len = text.length;
  const report = (pos: number) => setProgress({ text, pos, fraction: Math.min(1, pos / len) });
  let boundaries = false;
  let started = 0;
  let mine: number | undefined; // this utterance's timer: a cancelled one must not stop the next one's
  window.clearInterval(ticker);
  u.onstart = () => {
    setSpeaking(true);
    started = performance.now();
    report(0);
    const cps = (CPS[pack] ?? 14) * u.rate;
    ticker = mine = window.setInterval(() => {
      if (!boundaries) report(Math.min(len * 0.97, ((performance.now() - started) / 1000) * cps));
    }, 100);
  };
  u.onboundary = (e) => {
    boundaries = true;
    report(e.charIndex);
  };
  // A cancel() fires onerror ("interrupted") or onend: either way, not speaking.
  u.onend = u.onerror = () => {
    window.clearInterval(mine);
    if (current === u) current = null;
    setSpeaking(speechSynthesis.speaking);
    if (!speechSynthesis.speaking) setProgress(null);
  };
  current = u;
  speechSynthesis.speak(u);
}

/** Stop all speech now. */
export function stop() {
  if (!supported) return;
  speechSynthesis.cancel();
  window.clearInterval(ticker);
  setSpeaking(false);
  setProgress(null);
}
