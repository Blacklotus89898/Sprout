# Sprout 🌱

[![CI](https://github.com/Blacklotus89898/Sprout/actions/workflows/ci.yaml/badge.svg)](https://github.com/Blacklotus89898/Sprout/actions/workflows/ci.yaml)

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

**Shipped** (full list in [docs/ROADMAP.md](docs/ROADMAP.md)):

- **Mandarin reader:** CC-CEDICT segmentation, tone-colored pinyin, tap a word for every reading and definition; 🔊 with the device's own voices.
- **Translation** between Mandarin, Cantonese, Spanish and English, with word colors from the dictionary and no LLM (ADR 0002). On-device in desktop Chrome, free and keyless (ADR 0003); `GOOGLE_TRANSLATE_API_KEY` is only the fallback.
- **Speaking:** record and replay a word next to Sprout's voice with a tone check, and phrase-by-phrase **shadowing** with pitch comparison.
- **Saved words + review** (Leitner, in the browser) and an **on-device conversation tutor** (Chrome's Gemini Nano; ADR 0005).

Nothing is recorded or stored server-side; history and saved words stay in your browser.

**Next — phase 1b, keeping what you learn:** accounts (ADR 0004), cards on the server,
known-word tracking, import. Then FSRS reviews (phase 2).

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
| `GET /api/features` | What this deployment can do (translation on/off, targets) |
| `POST /api/translate` | `{lang, target, text}` → translation, tokens on both sides, dictionary word colors (Google; 30/min, cached) |
| `GET /` | The reader (React app, embedded) |

## Layout

| Path | What it holds |
|---|---|
| `internal/lang` | Language packs: segmentation, romanization, script (deterministic) |
| `internal/align` | Checks a word mapping is well-formed (full or partial); maps tokens to colors |
| `internal/dict` | CC-CEDICT parser plus the embedded export (`data/`) |
| `internal/translate` | Google Translate client + dictionary word matching → `align` checks → colors |
| `internal/pinyin` | Numbered pinyin → tone marks and tone numbers |
| `web/` | React/TS reader (Vite); `npm run build` → `web/dist`, embedded by `web/embed.go` |
| `docs/adr` | Decisions |

## Deploy

On every push to `main`, CI pushes `ghcr.io/blacklotus89898/sprout:<sha>`.
The Homelab side (ArgoCD app, route `sprout.lab.home`, monitoring) comes from
**Backstage → Create → New Homelab Service**. To roll out a new version, bump the
SHA in Homelab `services/sprout/deployment.yaml`.

## Docs

- [docs/adr/](docs/adr/README.md) — decisions (read 0001 before changing the architecture)
- [docs/ROADMAP.md](docs/ROADMAP.md) — the living feature list

## Contributing

Read [AGENTS.md](AGENTS.md) first — it is the guide for humans and coding agents alike: commands, layout, the rules that must not break, how to add a feature and how changes ship.

## Data credits

- **[CC-CEDICT](https://cc-cedict.org)**, published by MDBG, licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Referenced work:
  CEDICT © 1997, 1998 Paul Andrew Denisowski. See `internal/dict/data/README.md`.
