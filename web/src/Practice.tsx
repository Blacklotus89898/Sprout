import { useEffect, useMemo, useRef, useState } from "react";
import type { Syllable } from "./api";
import { chaoToSt, check, contour, spokenTones, track, type Point } from "./pitch";
import { MAX_SECONDS, supported, useRecorder } from "./recorder";

// Record yourself, replay it next to Sprout's voice, and see your pitch drawn
// over the textbook tone shapes. The comparison is pitch only (see pitch.ts).

const W = 280, H = 120, ST = 8; // chart size; y axis spans ±8 semitones

export function Practice({
  word,
  syllables,
  onSpeak,
  verdicts = true,
}: {
  word: string;
  syllables: Syllable[];
  onSpeak?: () => void;
  verdicts?: boolean; // per-syllable ✓/✗; off for sentences, where an even split is too rough
}) {
  const { recording, take, error, live, start, stop } = useRecorder();
  const audio = useRef<HTMLAudioElement>(null);
  const [playhead, setPlayhead] = useState<number | null>(null); // seconds into "Mine" while it plays
  const raf = useRef<number>();
  useEffect(() => () => cancelAnimationFrame(raf.current ?? 0), []);

  function playMine() {
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    void a.play();
    const tick = () => {
      setPlayhead(a.currentTime);
      if (!a.paused && !a.ended) raf.current = requestAnimationFrame(tick);
      else setPlayhead(null);
    };
    raf.current = requestAnimationFrame(tick);
  }
  const tonal = syllables.length > 0 && syllables.every((s) => s.tone >= 1 && s.tone <= 5);

  const livePts = useMemo(() => (live ? contour(live.frames) : []), [live]);
  const analysis = useMemo(() => {
    if (!take || !tonal) return null;
    const pts = contour(track(take.samples, take.sr));
    return { pts, checks: check(pts, syllables) };
  }, [take, tonal, syllables]);

  if (!supported) return <p className="hint small">This browser can't record audio.</p>;

  return (
    <div className="practice">
      <div className="practice-buttons">
        {recording ? (
          <button className="rec on" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="rec" onClick={start} title={`Up to ${MAX_SECONDS} seconds`}>
            🎙 {take ? "Again" : "Record"}
          </button>
        )}
        {onSpeak && (
          <button className="speak" onClick={onSpeak}>
            🔊 Sprout
          </button>
        )}
        {take && (
          <button className="speak" onClick={playMine}>
            ▶ Mine
          </button>
        )}
        {take && <audio ref={audio} src={take.url} preload="auto" />}
      </div>
      {recording && (
        <>
          <p className="hint small">Say “{word}”, then press Stop.</p>
          <div className="rec-progress" role="progressbar" aria-label="Recording time" aria-valuemin={0} aria-valuemax={MAX_SECONDS} aria-valuenow={Math.round(live?.elapsed ?? 0)}>
            <span style={{ width: `${Math.min(100, ((live?.elapsed ?? 0) / MAX_SECONDS) * 100)}%` }} />
          </div>
          <Chart pts={livePts} tones={[]} domain={[0, Math.max(2, live?.elapsed ?? 0)]} />
        </>
      )}
      {error && <p className="error small">{error}</p>}

      {analysis && !recording && (
        analysis.pts.length === 0 ? (
          <p className="hint small">Couldn't hear a clear voice. Try again a bit louder, closer to the mic.</p>
        ) : (
          <>
            <Chart pts={analysis.pts} tones={syllables.map((s) => s.tone)} playhead={playhead} />
            {verdicts && (
            <ul className="tone-checks">
              {analysis.checks.map((c, i) => (
                <li key={i} className={c.ok === true ? "good" : c.ok === false ? "bad" : ""}>
                  <span className={`tone${syllables[i].tone}`}>{c.syllable}</span>{" "}
                  {c.ok === null ? (c.heard ? `heard ${c.heard}` : "not heard") : c.ok ? `✓ ${c.heard}` : `✗ heard ${c.heard}, want ${want(c.tone)}`}
                </li>
              ))}
            </ul>
            )}
            <p className="hint small">
              {verdicts
                ? "Dashed: the textbook tone shapes. Solid: your pitch. This checks tones only, not consonants or vowels, and splits your recording evenly between syllables, so treat it as a rough guide."
                : "Dashed: the tone shapes of the sentence, in order. Solid: your pitch. Compare the ups and downs, then replay both."}
            </p>
          </>
        )
      )}
    </div>
  );
}

const want = (tone: number) => ({ 1: "level", 2: "rising", 3: "low/dipping", 4: "falling" })[tone] ?? "any";

// Your pitch over the tone shapes. Live mode (while recording) passes a fixed
// time domain and no tones; after recording the x axis spans your voiced part
// and a playhead follows the replay.
function Chart({ pts, tones, domain, playhead }: { pts: Point[]; tones: number[]; domain?: [number, number]; playhead?: number | null }) {
  const [t0, t1] = domain ?? (pts.length ? [pts[0].t, pts[pts.length - 1].t] : [0, 1]);
  const span = Math.max(t1 - t0, 0.05);
  const x = (t: number) => ((t - t0) / span) * W;
  const y = (st: number) => H / 2 - (Math.max(-ST, Math.min(ST, st)) / ST) * (H / 2);

  // Your contour: break the line at gaps (> 60 ms unvoiced) instead of bridging them.
  const paths: string[] = [];
  let d = "";
  pts.forEach((p, i) => {
    const gap = i > 0 && p.t - pts[i - 1].t > 0.06;
    d += `${!d || gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.st).toFixed(1)} `;
  });
  paths.push(d);

  const slot = W / tones.length;
  const spoken = spokenTones(tones);
  return (
    <svg className="pitch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Your pitch compared with the tone shapes">
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="axis" />
      {spoken.map((s, i) => {
        const pts = s.shape.map((c, k) => `${(i * slot + (k / (s.shape.length - 1)) * slot * 0.9 + slot * 0.05).toFixed(1)},${y(chaoToSt(c)).toFixed(1)}`);
        return (
          <g key={i}>
            {i > 0 && <line x1={i * slot} x2={i * slot} y1={0} y2={H} className="axis" />}
            <polyline points={pts.join(" ")} className={`template tone${tones[i]}`} />
          </g>
        );
      })}
      {paths.map((p, i) => (
        <path key={i} d={p} className="mine" />
      ))}
      {playhead != null && playhead >= t0 && playhead <= t1 && <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={H} className="playhead" />}
    </svg>
  );
}
