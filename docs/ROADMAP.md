# Sprout roadmap

The living feature list. ADR 0001 holds the architecture and its phases; this file
holds **what** to build and in what order. Tick items off as they ship. Bigger
design choices get an ADR first; those items are marked *(ADR)*.

## Shipped

- [x] Mandarin reader: CC-CEDICT segmentation, tone-marked pinyin, tone colors, tap for every reading and definition (1a)
- [x] Pronunciation with the device's speech voices, per word and for the whole text; slow mode; **Stop**
- [x] History: last 100 texts and words, kept in the browser only
- [x] Translation between Mandarin, Cantonese, Spanish and English (Google). **Word colors from the dictionary, no LLM** (ADR 0002): about 70% of words colored, and every color correct
- [x] **On-device translation** in desktop Chrome (built-in Translator API): free, no key; the server key is only a fallback (ADR 0003)
- [x] **Shadowing:** step through the text phrase by phrase; hear it, record yourself, replay both, compare pitch with the phrase's tone shapes
- [x] **First-run UX:** opens on a ready sample, the text box folds away after Read, a tone-color legend, translation joined under the reader (auto-runs when the on-device model is ready)
- [x] Bidirectional segmentation (他说明天 → 他|说|明天)
- [x] **Record and replay** a word next to Sprout's voice, with a **tone check**: your pitch (YIN, in the browser) drawn over the textbook tone shapes, ✓/✗ per syllable, third-tone sandhi applied. Tones only; nothing uploaded

## Next: phase 1b, keeping what you learn

1. [ ] **Accounts** *(ADR 0004: hosting + auth)*. You and your friends; magic-link email or passkeys. Every row has a `user_id` from day one.
2. [ ] **Cards:** "＋ Card" on a word saves the word, its reading, your chosen sense and the **sentence it came from**. Needs SQLite on a 1Gi PVC (Recreate rollout).
3. [ ] **Known-word tracking:** words you mark known stop being highlighted; the reader shows "% of this text you know".
4. [ ] **Import:** paste a URL (article text extraction), upload `.srt`/`.vtt` subtitles, or an EPUB chapter.
5. [ ] **Server-side history:** replaces the browser-only list once accounts exist (opt-in).

## Phase 2: reviews

6. [ ] **FSRS scheduler** in Go (deterministic, tested); daily review queue; Again/Hard/Good/Easy.
7. [ ] **Card types:** hanzi → meaning, meaning → hanzi, audio → hanzi (listening), cloze on the source sentence.
8. [ ] **Stats:** retention curve, reviews per day, streak, forecast. The journal makes these free.
9. [ ] **HSK 1–6 levels** on words and texts (word lists are public); "this text is ~HSK 3".

## Phase 3: deeper reading and translation

10. [ ] **Character breakdown:** components/radicals and stroke order (Make Me a Hanzi, LGPL/Arphic: *check license*).
11. [ ] **Traditional ⇄ Simplified toggle** (OpenCC data, Apache-2.0).
12. [ ] **Sentence mode:** split long texts into sentences and translate each lazily, all color-matched.
13. [ ] **Example sentences** for a word (Tatoeba, CC BY 2.0) with audio.
14. [ ] **Grammar notes:** curated patterns (了, 把, 被, 的/得/地) matched by rules; an LLM explanation only as a later opt-in.
14b. [ ] **Better word colors:** extend glosses with lemma forms (went → go), match multi-word English phrases, add the Spanish dictionary.
15. [ ] **Measure-word and tone-sandhi hints** (不/一 sandhi, third-tone pairs): deterministic rules, shown on the pinyin.

## Phase 4: speaking and pronunciation

16. [ ] **Tone trainer, next steps:** per-syllable timing from energy dips instead of an even split; sentence-level practice; 不/一 sandhi; a history of your scores.
17. [ ] **Shadowing, next:** compare timing (your syllable rhythm vs. the reference), loop a phrase, a score history.
18. [ ] **Provider spike** *(ADR)*: Azure pronunciation assessment (verify zh-HK support) vs. a self-hosted model; cloud voices if device voices aren't good enough.
19. [ ] **Minimal pairs drills** (mā/má/mǎ/mà; Cantonese 6 tones).

## Phase 5: conversation tutor

20. [ ] **Chat tutor** at your level (uses your known words), with corrections inline; each correction can become a card.
21. [ ] **Voice conversation:** speech in, speech out, tone feedback after each turn.
22. [ ] **Scenarios:** ordering food, directions, small talk; graded by HSK level.

## More languages

23. [ ] **Cantonese pack:** CC-Canto + CC-CEDICT Cantonese readings (jyutping, CC BY-SA 3.0); colloquial characters (嘅, 咗, 冇). Segmentation quality is the risk (ADR 0001 §2).
24. [ ] **Spanish pack:** lemmatizer (conjugation → infinitive), Wiktionary definitions, gender and verb tables.

## Platform and operations

25. [ ] **Public hosting for friends** *(ADR 0004)*: `sprout.lab.home` is LAN-only.
26. [ ] **Mobile:** PWA install, offline cache of the dictionary and today's cards.
27. [ ] **Cost guardrails for Google Translate:** per-user daily quota, a characters-used metric in `/metrics`, an alert before the free 500k/month runs out.
28. [ ] **Persistent translation cache** in SQLite, so restarts don't pay twice.
29. [ ] **Metrics:** `sprout_translate_total`, the share of words colored, lookups and reviews per day.
30. [ ] **Backups** of the SQLite DB (Litestream or a nightly copy off the node).
