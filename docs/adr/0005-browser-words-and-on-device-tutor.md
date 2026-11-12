# ADR 0005: Saved words in the browser, and a conversation tutor on Chrome's on-device model

**Status:** Accepted (2026-11-12). Changes ADR 0001 §3 and §6 for now, and
pulls phase 5 (tutor) ahead of phase 1b (accounts). ADR 0004 (hosting and
auth) is still open; this decision doesn't depend on it.

## Context

The operator wants two things now, without waiting for accounts and hosting:

1. **Save words while reading, and review them later.** ADR 0001 §6 puts
   cards in SQLite with a `user_id`, and that needs ADR 0004 (accounts) first.
   The operator chose to keep saved words in the browser instead: "no need to
   sync".
2. **A conversation tutor that costs nothing.** ADR 0001 §3 names Claude for
   conversation turns. The operator asked for free options and chose Chrome's
   built-in **Prompt API**: Gemini Nano, downloaded once and run on the
   device, with no key, no bill and no server call
   (https://developer.chrome.com/docs/ai/prompt-api).

Constraint found while deciding: Chrome documents the Prompt API's languages
as **en, ja, es, de, fr**. Chinese is not among them.

## Decision

1. **Saved words live in `localStorage`** (`sprout.cards.v1`, `web/src/cards.ts`).
   - A card holds the word, its reading, the first sense's definitions and
     the sentence it was saved from (roadmap #2), plus its review state.
   - Storage is untrusted: every read goes through `sanitize`, every access is
     wrapped in try/catch, and the reader works with storage blocked.
   - **Export/import as JSON** is the backup, because clearing site data
     deletes the words.
2. **Reviews use a Leitner schedule, not FSRS, for now.**
   - Boxes of 0 (10 minutes), 1, 3, 7, 16, 35 and 90 days. **Again** drops a
     card to box 0, **Good** moves it up one box, **Easy** moves it up two.
   - `schedule()` is a pure, tested function. The learner grades themself;
     no model is involved.
   - FSRS in Go (roadmap #6) replaces it when cards move to the server.
     Exported files carry the review history needed to migrate.
3. **The tutor runs on Chrome's `LanguageModel`** (`web/src/browserTutor.ts`, `Tutor.tsx`).
   - **Session.** `create()` is called from the Start click, because a model
     download needs a user gesture. Download progress is shown, the session is
     destroyed on unmount, and dropped context (`contextoverflow`) is reported.
   - **Language support.** The tutor first asks Chrome for the pack's own
     language. When Chrome says it's unavailable (Chinese today), it declares
     English instead and asks for replies in the target language. That mode is
     labelled **experimental** in the UI. Spanish is supported officially.
   - **Without the API,** the section says what is needed: the Chrome version,
     disk, GPU or RAM, and `chrome://on-device-internals`. It never disappears
     silently.
4. **Model output is validated before it is shown** (CLAUDE.md).
   - Decoding is constrained by `responseConstraint` (JSON schema
     `{reply, english, suggested, why}`).
   - `validate()` then parses the answer, caps each field's length, and
     rejects a reply that isn't in the target script. It drops a suggestion
     that is empty, identical to what the learner wrote, or not in the target
     language. A failed answer is retried once, then reported as an error.
   - Replies go through `/api/read`, so every word is tappable with its
     CC-CEDICT reading. A reply in which fewer than half the words are in the
     dictionary is flagged as possibly garbled.
   - Everything is rendered as text, never as HTML.
5. **The model never grades.** It may only suggest a better way to say a
   message ("Try saying…"), with one sentence of why. There are no scores and
   no verdicts. The tone check (`pitch.ts`) and the dictionary remain the
   reference.
6. **The tutor's context.** The learner's saved words in that language (up to
   40) go into the system prompt, so the conversation reuses them. A tutor
   word can be saved with **＋ Save** like a reader word.

## Consequences

- **Words and the tutor cost nothing and are private.** Neither the server
  nor any third party sees the words, the conversation or the reviews.
- **Saved words are tied to one browser profile.** They don't sync to a phone,
  and clearing site data loses them unless they were exported. Accounts
  (ADR 0004) remain the path to syncing; importing an export file migrates
  the words then.
- **Mandarin tutoring quality is unknown until it's tried on real hardware.**
  If Chrome's model won't answer in Chinese, or answers badly, the fallback is
  a later ADR: a self-hosted Qwen through Ollama on the desktop GPU, or a
  paid API. Both would sit behind the same `validate()`.
- **The tutor needs desktop Chrome 148+** with about 22 GB of free disk and a
  GPU with more than 4 GB of memory (or 16 GB of RAM). Phones, Safari and
  Firefox get the explanation instead.
- **The on-device model is small.** Its suggestions can be wrong, and the UI
  says so.
- **ADR 0001 is not edited.** §3 (Claude for turns) and §6 (cards in SQLite)
  still describe the server-side future; this ADR records the interim.
