// Tone checking without any server or model (ROADMAP #16, phase 4 seed).
// Everything here is plain math on the learner's own recording, in the
// browser: YIN pitch detection → a pitch contour in semitones → compared with
// the textbook shape of each syllable's tone. Deterministic; nothing uploaded.
//
// What it can judge: the *shape* of each tone (level, rising, dipping,
// falling). What it can't: consonants and vowels (zh vs. j, ü vs. u). That
// needs a pronunciation-assessment model (ROADMAP #18).

export const ANALYSIS_RATE = 16000; // recordings are resampled to this before YIN

/** One analysis frame: time in seconds, pitch in Hz (null = unvoiced/silent). */
export type Frame = { t: number; f0: number | null };

/**
 * YIN fundamental-frequency estimate for one window (de Cheveigné & Kawahara
 * 2002): difference function, cumulative-mean normalization, absolute
 * threshold, parabolic interpolation. Returns null when no clear period.
 */
export function yin(buf: Float32Array, sr: number, minF = 70, maxF = 450, threshold = 0.15): number | null {
  const maxTau = Math.floor(sr / minF);
  const minTau = Math.max(2, Math.floor(sr / maxF));
  const w = buf.length - maxTau;
  if (w <= 0) return null;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const x = buf[j] - buf[j + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // Cumulative mean normalized difference.
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau];
    d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation around the minimum for sub-sample precision.
  let better = tau;
  if (tau > 1 && tau < maxTau) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return sr / better;
}

/** Pitch track for a mono signal: 10 ms hop, 32 ms window, silence gated by energy. */
export function track(samples: Float32Array, sr: number): Frame[] {
  const hop = Math.round(sr * 0.01);
  const win = Math.round(sr * 0.032) + Math.floor(sr / 70); // window + max lag
  const frames: Frame[] = [];
  let peak = 0;
  const rms: number[] = [];
  for (let i = 0; i + win <= samples.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    const r = Math.sqrt(s / win);
    rms.push(r);
    peak = Math.max(peak, r);
  }
  const gate = peak * 0.08; // quieter than ~-22 dB below the loudest frame = silence
  for (let k = 0, i = 0; i + win <= samples.length; k++, i += hop) {
    const f0 = rms[k] >= gate ? yin(samples.subarray(i, i + win), sr) : null;
    frames.push({ t: i / sr, f0 });
  }
  return frames;
}

/** A contour point in semitones relative to the speaker's own median pitch. */
export type Point = { t: number; st: number };

/**
 * Turns a raw pitch track into a clean contour: semitones around the median
 * (so men, women and children compare alike), octave jumps and isolated
 * blips dropped, then a 5-point median filter.
 */
export function contour(frames: Frame[]): Point[] {
  const voiced = frames.filter((f): f is { t: number; f0: number } => f.f0 !== null);
  if (voiced.length < 5) return [];
  const med = median(voiced.map((f) => f.f0));
  let pts = voiced.map((f) => ({ t: f.t, st: 12 * Math.log2(f.f0 / med) }));
  pts = pts.filter((p) => Math.abs(p.st) < 12); // octave errors
  // Drop points that jump >4 st from both neighbours (single-frame errors).
  pts = pts.filter((p, i) => {
    const a = pts[i - 1], b = pts[i + 1];
    if (!a || !b) return true;
    return !(Math.abs(p.st - a.st) > 4 && Math.abs(p.st - b.st) > 4);
  });
  return pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - 2), i + 3).map((q) => q.st);
    return { t: p.t, st: median(win) };
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Textbook tone shapes in Chao tone letters (1 low … 5 high). */
const CHAO: Record<number, number[]> = {
  1: [5, 5], // high level
  2: [3, 5], // rising
  3: [2, 1, 4], // dipping (said alone)
  4: [5, 1], // falling
  5: [3, 3], // neutral: short, takes its pitch from the syllable before
};

/**
 * The tone each syllable is actually said with, after the third-tone rules:
 * 3+3 → 2+3, and a third tone that isn't last is a "half third" (low, no
 * rise). 不/一 sandhi needs the characters and isn't applied yet (ROADMAP #15).
 */
export function spokenTones(tones: number[]): { tone: number; shape: number[] }[] {
  return tones.map((t, i) => {
    const next = tones[i + 1];
    if (t === 3 && next === 3) return { tone: 2, shape: CHAO[2] };
    if (t === 3 && next !== undefined) return { tone: 3, shape: [2, 1] };
    return { tone: t, shape: CHAO[t] ?? CHAO[5] };
  });
}

/** Chao letter → semitones around a speaker's median (≈2 st per step, 3 ≈ median). */
export const chaoToSt = (c: number) => (c - 3) * 2;

export type Shape = "level" | "rising" | "falling" | "dipping";

export type SyllableCheck = {
  syllable: string;
  tone: number; // tone as spoken (after sandhi)
  heard: Shape | null; // null = not enough voiced audio in that slice
  ok: boolean | null; // null = not judged (neutral tone, or nothing heard)
  start: number; // seconds, slice of the voiced region given to this syllable
  end: number;
};

/** Shapes a learner's tone may take and still count as right. */
const ACCEPT: Record<number, Shape[]> = {
  1: ["level"],
  2: ["rising", "dipping"], // a slight dip before the rise is normal
  3: ["dipping", "falling", "level"], // half third is low-falling or low-level
  4: ["falling"],
};

/** Classify a slice of contour by its start, middle and end pitch. */
export function classify(pts: Point[]): Shape | null {
  if (pts.length < 4) return null;
  const third = Math.max(1, Math.floor(pts.length / 3));
  const avg = (xs: Point[]) => xs.reduce((s, p) => s + p.st, 0) / xs.length;
  const start = avg(pts.slice(0, third));
  const end = avg(pts.slice(-third));
  const low = Math.min(...pts.slice(third, -third || undefined).map((p) => p.st));
  if (low < Math.min(start, end) - 1.5 && end - low > 1.5) return "dipping";
  if (end - start > 1.5) return "rising";
  if (start - end > 1.5) return "falling";
  return "level";
}

/**
 * Rough per-syllable check: the voiced part of the recording is split evenly
 * among the syllables (no forced alignment, so long pauses mid-word throw
 * it off), and each slice's shape is compared with the tone's.
 */
export function check(pts: Point[], syllables: { text: string; tone: number }[]): SyllableCheck[] {
  const spoken = spokenTones(syllables.map((s) => s.tone));
  if (!pts.length) {
    return syllables.map((s, i) => ({ syllable: s.text, tone: spoken[i].tone, heard: null, ok: null, start: 0, end: 0 }));
  }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const step = (t1 - t0) / syllables.length;
  return syllables.map((s, i) => {
    const start = t0 + i * step, end = start + step;
    const slice = pts.filter((p) => p.t >= start && p.t <= end);
    const heard = classify(slice);
    const tone = spoken[i].tone;
    const ok = heard === null || !ACCEPT[tone] ? null : ACCEPT[tone].includes(heard);
    return { syllable: s.text, tone, heard, ok, start, end };
  });
}
