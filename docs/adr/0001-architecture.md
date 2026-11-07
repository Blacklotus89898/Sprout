# ADR 0001: Sprout is a reading-first language platform with a deterministic core

**Status:** Proposed (2026-11-07)
**Context repos:** [Homelab](https://github.com/Blacklotus89898/Homelab) (deploy), [Tulip](https://github.com/Blacklotus89898/Tulip) (sibling pattern)

## Context

A language-learning platform for the operator first and a few friends soon after.
It has three target languages from the start: **Mandarin, Cantonese and Spanish**.
The operator wants:

- reading real text;
- word-by-word translation with matching colors;
- speaking, pronunciation and conversation practice.

It is a sibling of Petal and Tulip, so the garden grows: Petal builds, Tulip trades,
Sprout grows. It deploys through the Homelab golden path (Backstage).

The other projects on the platform are infrastructure with one user. Sprout is
the first **product**, and it exists to practise product engineering: users,
UX, a frontend, retention. Infrastructure is the smaller part.

## Decision

1. **Stack: a Go API with a React/TS web app, shipped as one image.**
   - The web app is a Vite SPA in `web/`.
   - It is embedded into the Go binary (`embed.FS`), so there is one Deployment
     and one image, pinned by SHA like every other platform service.

2. **Language packs behind one interface (`internal/lang`).** Nothing outside the
   packs branches on a language. Each pack owns segmentation, romanization and
   script. The three launch packs differ, and their data must be CC BY-SA
   compatible:

   | Pack | Script | Romanization | Segmentation | Lexicon |
   |---|---|---|---|---|
   | `cmn-Hans` Mandarin | Simplified | pinyin | dictionary max-match, then a better segmenter if needed | CC-CEDICT (CC BY-SA 4.0) |
   | `yue-Hant` Cantonese | Traditional | jyutping | max-match over CC-Canto plus CC-CEDICT words | CC-Canto + CC-CEDICT Cantonese readings (CC BY-SA 3.0) |
   | `es` Spanish | Latin | none | Unicode word runs, then lemmatize | Wiktionary extract (kaikki.org, CC BY-SA). Lemma data: license to be verified. |

   - Mandarin and Cantonese share the Han layer.
   - Script conversion between Simplified and Traditional uses OpenCC data
     (Apache-2.0).
   - Cantonese is the hard one: Go has no Cantonese segmenter, and Mandarin
     segmenters (jieba) split colloquial Cantonese wrongly (我哋, 鍾意, 唔該).
     Max-match over a Cantonese lexicon is the baseline.
   - If accuracy isn't good enough, a PyCantonese sidecar is the escape hatch.
     That would be a new ADR, because it adds a second runtime.
   - Do not bundle words.hk data until its license has been read and allows it.

3. **Claude explains; the scheduler decides; the journal remembers.**
   - **Deterministic Go core.** It covers:
     - tokenization;
     - the FSRS spaced-repetition scheduler;
     - card state;
     - validation of every LLM output.

     The same input gives the same result, with tests.
   - **Claude works at the edges only.** It writes glosses and explanations,
     example sentences, alignment proposals (§4), conversation turns, and
     corrections of the learner's writing.
   - **The LLM never decides what the learner knows.** Review grades come from
     the learner, and FSRS schedules from them.
   - **Append-only journal.** Every lookup, review and correction is a journal
     event, so learning curves and retention come for free (Tulip's pattern).

4. **Color-matched translation is LLM-proposed and code-validated (`internal/align`).**
   1. Both sentences are tokenized deterministically.
   2. Claude receives the two token arrays and returns only **links between
      index groups**, for example `{src:[1], tgt:[0,2]}` for 天气 ↔ "The weather".
   3. `align.Validate` enforces:
      - indices are in range;
      - they point at words, never punctuation;
      - no token is in two links;
      - every source word is covered.
   4. An invalid proposal is retried once, with the errors quoted back. If it
      fails again, the sentence is shown without colors. A half-wrong coloring
      is never rendered.
   5. Valid alignments are stored with the sentence, so each sentence is paid
      for once.

5. **Speech goes behind a `speech.Provider`. A spike decides the provider before
   any lock-in.**
   - **Phase 1 is free and has no audio storage.** Browser Web Speech API for TTS
     and recognition. Quality and Cantonese voice availability depend on the
     device, so this is acceptable only for a prototype.
   - **Candidate for real pronunciation scoring:** Azure Speech. It has
     zh-CN/zh-HK/es TTS voices and pronunciation assessment. **Not yet verified:**
     whether pronunciation assessment accepts **zh-HK** (Cantonese). The spike
     must call it per locale before this ADR names Azure.
   - **Tones are our own feature.** Both Chinese languages are tonal. The web app
     extracts the learner's pitch contour (F0, YIN algorithm) and draws it over
     the reference contour. This is deterministic DSP with no vendor, and it
     works for all six Cantonese tones.
   - **Audio is not stored by default.** The Homelab Proxmox disk is nearly full,
     and friends' voice recordings are personal data. If storage is ever needed,
     it requires opt-in and object storage, never a PVC.

6. **Storage: SQLite (modernc, pure Go), multi-user from the first table.**
   - Every row carries a `user_id`.
   - There is a single writer, so the Deployment uses `Recreate`, the same as
     Tulip.
   - **Move to Postgres** when Sprout needs more than one replica, or when it is
     hosted off-cluster.

7. **Hosting: Homelab for dev/staging, a public host for friends (ADR 0002).**
   - `sprout.lab.home` is LAN-only, behind a private CA. That is the golden-path
     dev and staging environment, and it is how Sprout gets onboarded. Friends
     cannot reach it.
   - The public deployment (Fly.io or similar, plus auth) is deliberately a
     separate decision, made once phase 2 works.

## Phases

| Phase | Ships | Exit check |
|---|---|---|
| 0 | This skeleton: `/health`, `/metrics`, language packs, alignment validator, CI, image; onboarded via Backstage | `sprout.lab.home/health` returns 200 through the gateway |
| 1 | Reader: paste text, URL or `.srt` → tokens with readings → tap for a gloss → make a card. Real lexicons. `web/` app. | Read a real article in the first language |
| 2 | Reviews: FSRS scheduler, review UI, journal | 14 days of reviews, retention chart |
| 3 | Color-matched translation (§4) in the reader and on cards | Alignment validity rate ≥ 95% on a 100-sentence set |
| 4 | Speech: TTS playback, shadowing, tone contour; provider spike (§5) | Spike result recorded as an ADR |
| 5 | Conversation tutor: chat, corrections become cards | A 10-minute session produces cards |
| 6 | Public hosting + auth for friends (ADR 0002) | A friend signs up |

**Open question for the operator:** which language comes first in phase 1? The
proposal is **Mandarin**, which has the best data and tools; Cantonese and Spanish
follow as packs. The architecture doesn't change, only the order.

## Consequences

- One interface and three very different packs. Cantonese segmentation quality
  is the main technical risk and is tested from phase 1.
- LLM cost stays bounded: alignments and glosses are cached per sentence and per
  word, not per view.
- The Backstage onboarding of Sprout is also the acceptance test for the improved
  golden path in Homelab.
