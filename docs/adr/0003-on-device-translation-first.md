# ADR 0003: On-device translation first, the Google Cloud key as fallback

**Status:** Accepted (2026-11-07). Extends ADR 0002; the dictionary coloring is unchanged.

## Context

ADR 0002 sends every translation through the Google Cloud Translation API,
which needs a key, a Google Cloud project with billing, and a secret in the
cluster. Desktop Chrome (138+) ships a built-in **Translator API**: Google's
translation model, downloaded once per language pair and run on the device.
The operator asked whether Sprout could use that instead.

## Decision

1. **The browser translates when it can.** The web app calls Chrome's
   `Translator` (`web/src/browserTranslate.ts`). The first use of a pair
   downloads its model, and the button shows the progress.
2. **The server colors.** `POST /api/align {lang, target, text, translation}`
   runs the same tokenize-and-dictionary step as `/api/translate`
   (`translate.Align`), with no engine call. It has no rate limit, because
   no paid call is involved.
3. **The server key is the fallback.** When the browser has no Translator
   API (phones, Safari, Firefox) or can't do the pair, the app falls back to
   `/api/translate`, if the server has a key. The Translate section appears
   when either path exists.
4. **Cantonese:** Chrome's translator has no Cantonese. `yue-Hant` maps to
   written Traditional Chinese (`zh-Hant`), and the page says so.

## Consequences

- **On a desktop, translation is free, private (text stays on the device), and works without any key.** The Google
  Cloud key becomes optional.
- **The server can't see or cache on-device translations,** and a client could
  post any "translation" to `/api/align`. That's harmless: the endpoint only
  colors what it's given, with the same input caps.
- **Quality differs a little between the two engines** (the on-device model
  is smaller). The credit line says which one produced each result.
