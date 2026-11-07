// Microphone recording for pronunciation practice. The audio stays in this
// tab: a blob URL for replay and a decoded buffer for pitch analysis. Nothing
// is uploaded or stored (ADR 0001 §5); a new take replaces the old one.

import { useEffect, useRef, useState } from "react";
import { ANALYSIS_RATE, yin, type Frame } from "./pitch";

export const supported =
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export const MAX_SECONDS = 8;

export type Take = { url: string; samples: Float32Array; sr: number; seconds: number };

/** What the mic hears while recording: elapsed seconds and a live pitch track. */
export type Live = { elapsed: number; frames: Frame[] };

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>();
  const [live, setLive] = useState<Live | null>(null);
  const raf = useRef<number>();

  // Free the previous take's blob URL whenever it is replaced or unmounted.
  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url);
  }, [take]);

  async function start() {
    setError("");
    if (!window.isSecureContext) {
      setError("Recording needs HTTPS (or localhost).");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone permission was denied." : `No microphone: ${String(e)}`);
      return;
    }
    const stopLive = listen(stream, setLive, raf);
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); // release the mic (indicator off)
      window.clearTimeout(timer.current);
      stopLive();
      setRecording(false);
      const blob = new Blob(chunks, { type: r.mimeType });
      try {
        const { samples, seconds } = await decode(blob);
        setTake({ url: URL.createObjectURL(blob), samples, sr: ANALYSIS_RATE, seconds });
      } catch (e) {
        setError(`Couldn't read the recording: ${String(e)}`);
      }
    };
    rec.current = r;
    r.start();
    setRecording(true);
    timer.current = window.setTimeout(stop, MAX_SECONDS * 1000);
  }

  function stop() {
    if (rec.current?.state === "recording") rec.current.stop();
  }

  return { recording, take, error, live, start, stop };
}

/**
 * Live pitch while recording: an AnalyserNode tapped off the mic, sampled
 * every animation frame, decimated to ~16 kHz so YIN stays cheap on phones.
 * Returns a function that stops listening.
 */
function listen(stream: MediaStream, onLive: (l: Live | null) => void, raf: { current?: number }): () => void {
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(an);
  const raw = new Float32Array(an.fftSize);
  const k = Math.max(1, Math.round(ctx.sampleRate / ANALYSIS_RATE));
  const small = new Float32Array(Math.floor(raw.length / k));
  const t0 = performance.now();
  const frames: Frame[] = [];
  const tick = () => {
    an.getFloatTimeDomainData(raw);
    let e = 0;
    for (let i = 0; i < small.length; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += raw[i * k + j];
      small[i] = s / k;
      e += small[i] * small[i];
    }
    const t = (performance.now() - t0) / 1000;
    const loud = Math.sqrt(e / small.length) > 0.01;
    frames.push({ t, f0: loud ? yin(small, ctx.sampleRate / k) : null });
    onLive({ elapsed: t, frames: frames.slice() });
    raf.current = requestAnimationFrame(tick);
  };
  raf.current = requestAnimationFrame(tick);
  return () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    void ctx.close();
    onLive(null);
  };
}

/** Decode a recording to mono samples at ANALYSIS_RATE (resampled by the browser). */
async function decode(blob: Blob): Promise<{ samples: Float32Array; seconds: number }> {
  const data = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(data);
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * ANALYSIS_RATE), ANALYSIS_RATE);
    const src = off.createBufferSource();
    src.buffer = buf; // multi-channel input is down-mixed to the 1 output channel
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return { samples: out.getChannelData(0), seconds: buf.duration };
  } finally {
    void ctx.close();
  }
}
