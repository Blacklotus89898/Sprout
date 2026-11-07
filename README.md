# Sprout 🌱

A language-learning platform for **Mandarin, Cantonese and Spanish**. You read real
text, mine its words into cards, review them on a spaced-repetition schedule, and
then speak: pronunciation, tones and conversation. Translations line up word by
word, with matching colors.

**Claude explains; the scheduler decides; the journal remembers.**

It is a sibling of [Petal](https://github.com/Blacklotus89898/Petal) and
[Tulip](https://github.com/Blacklotus89898/Tulip): Petal builds, Tulip trades,
Sprout grows. It deploys on the [Homelab](https://github.com/Blacklotus89898/Homelab)
platform through the Backstage golden path.

Design: [ADR 0001](docs/adr/0001-architecture.md).

## Status

**Phase 1a: the Mandarin reader is live.** Paste Chinese text and it is split
into words using the embedded CC-CEDICT. Each word shows tone-colored pinyin;
tap one to see its readings and definitions. 🔊 plays a word or the whole text
through the device's own speech voices (nothing is recorded). History keeps the
last 100 texts and words in your browser only. Next is phase 1b: tap to make a
card, which needs storage. After that come reviews (FSRS), color-matched
translation, speech, and the tutor (ADR 0001 phases).

## Run

```bash
go test ./...
(cd web && npm ci && npm run build)   # optional: without it, / shows a hint
go run . -addr :8080                  # http://localhost:8080
# UI development: run `go run .` plus `cd web && npm run dev` (http://localhost:5173, proxies /api)
curl localhost:8080/health
curl localhost:8080/api/languages
curl -X POST localhost:8080/api/tokenize -d '{"lang":"yue-Hant","text":"我哋鍾意講廣東話！"}'
```

| Endpoint | What it does |
|---|---|
| `GET /health` | 200 `ok` (probes, no auth) |
| `GET /metrics` | Prometheus text: `sprout_build_info`, `sprout_language_packs` |
| `GET /api/languages` | The registered language packs |
| `POST /api/tokenize` | `{lang, text}` → tokens with byte offsets and kinds |
| `POST /api/read` | `{lang, text}` → tokens, each word with dictionary senses (reading, tones, definitions) |
| `GET /` | The reader (React app, embedded) |

## Layout

| Path | What it holds |
|---|---|
| `internal/lang` | Language packs: segmentation, romanization, script (deterministic) |
| `internal/align` | Validates Claude's word-alignment proposals; maps tokens to colors |
| `internal/dict` | CC-CEDICT parser plus the embedded export (`data/`) |
| `internal/pinyin` | Numbered pinyin → tone marks and tone numbers |
| `web/` | React/TS reader (Vite); `npm run build` → `web/dist`, embedded by `web/embed.go` |
| `docs/adr` | Decisions |

## Deploy

On every push to `main`, CI pushes `ghcr.io/blacklotus89898/sprout:<sha>`.
The Homelab side (ArgoCD app, route `sprout.lab.home`, monitoring) comes from
**Backstage → Create → New Homelab Service**. To roll out a new version, bump the
SHA in Homelab `services/sprout/deployment.yaml`.

## Data credits

- **[CC-CEDICT](https://cc-cedict.org)**, published by MDBG, licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Referenced work:
  CEDICT © 1997, 1998 Paul Andrew Denisowski. See `internal/dict/data/README.md`.
