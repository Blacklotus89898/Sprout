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

Phase 0 is a skeleton. It has the platform endpoints, the three language packs
(seed dictionaries only), and the alignment validator behind color-matched
translation. The reader, reviews, speech and the tutor are phases 1 to 5.

## Run

```bash
go test ./...
go run . -addr :8080
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

## Layout

| Path | What it holds |
|---|---|
| `internal/lang` | Language packs: segmentation, romanization, script (deterministic) |
| `internal/align` | Validates Claude's word-alignment proposals; maps tokens to colors |
| `docs/adr` | Decisions |

## Deploy

On every push to `main`, CI pushes `ghcr.io/blacklotus89898/sprout:<sha>`.
The Homelab side (ArgoCD app, route `sprout.lab.home`, monitoring) comes from
**Backstage → Create → New Homelab Service**. To roll out a new version, bump the
SHA in Homelab `services/sprout/deployment.yaml`.
