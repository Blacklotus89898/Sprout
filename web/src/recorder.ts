// Microphone recording for pronunciation practice. The audio stays in this
// tab: a blob URL for replay and a decoded buffer for pitch analysis. Nothing
// is uploaded or stored (ADR 0001 §5); a new take replaces the old one.

import { useEffect, useRef, useState } from "react";
import { ANALYSIS_RATE } from "./pitch";

export const supported =
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export const MAX_SECONDS = 8;

export type Take = { url: string; samples: Float32Array; sr: number; seconds: number };

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>();

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
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); // release the mic (indicator off)
      window.clearTimeout(timer.current);
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

  return { recording, take, error, start, stop };
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
