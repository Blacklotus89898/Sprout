# ADR 0002: Translation by Google, word colors by the dictionary, no LLM

**Status:** Accepted (2026-11-07). Supersedes ADR 0001 §4, where Claude proposed the word mapping.

## Context

ADR 0001 §4 had Claude produce both the translation and the word-by-word
mapping behind the colors, with `align.Validate` checking only that the
mapping was well-formed. That check can't tell whether Claude matched the
right words, and every sentence cost LLM tokens. The operator asked for no
LLM tokens in translation.

## Decision

1. **Google Cloud Translation API v2 (Basic, neural MT)** produces the
   translated text, called over plain REST with an API key (no SDK).
   - Pricing: the first 500,000 characters a month are free, then $20 per
     million.
   - Sprout caps requests at 1,000 characters, 30 per minute across all users,
     and keeps a 500-entry cache.
   - Cantonese (`yue`) isn't confirmed for the Cloud API. If Google rejects it,
     Sprout falls back to written Traditional Chinese (`zh-TW`) and says so.
2. **The CC-CEDICT dictionary decides the colors** (`internal/translate/dictalign.go`).
   A Chinese word and an English word share a color only when the Chinese
   word's own definitions contain that English word (after simple stemming).
   - **Ignored:** stop words, plus definitions that describe usage rather
     than meaning: "classifier for books", "noun suffix…", "(used …)".
   - **Light words** (light verbs, prepositions, connectives) count only when
     a definition consists of nothing else. "to take a walk" → walk;
     "to go" → go; 和 "and" → and.
   - **One color per word.** Each English word is claimed by at most one
     Chinese word, and words with the fewest candidates choose first.
   - **Works in both directions:** Chinese → English and English → Chinese.
3. **Partial by design.** Words the dictionary can't prove stay plain. The UI
   says "N of M words matched" and that plain words weren't proven.
   `align.Validate` runs in `Partial` mode: structure is checked, coverage
   isn't required.
4. **Segmentation became bidirectional maximum matching** (`lang.MaxMatch`),
   because a wrong word boundary also means a wrong color: 他说明天 is now
   他|说|明天, not 他|说明|天.
5. **Pairs without a dictionary on both sides** (anything with Spanish) get the
   translation without colors, with a note. The Spanish pack (ROADMAP #24)
   brings a dictionary.

## Consequences

- **No model is involved, so the same input always gives the same colors.**
  Colors are always correct, but coverage is partial. On a 4-sentence
  Mandarin → English probe with realistic translations, 38 of 54 words (70%)
  were colored and every pair was correct. The uncolored ones are grammar
  particles (了, 的, 会), measure words, and loosely translated words
  (菜 → "food").
- **Cost is roughly zero at personal scale.** The key is a Google Cloud API
  key, which should be restricted to the Translation API. The operator seals
  it as `sprout-google-translate`.
- **Claude can still be added later**, as an opt-in that fills only the
  words the dictionary left plain, shown as unconfirmed. That would need its
  own ADR.
