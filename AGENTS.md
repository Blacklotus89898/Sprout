# AGENTS.md — Sprout

Guide for any coding agent (Claude Code, Codex, Cursor, Copilot, Gemini…) and human contributor.

## What this is

Language-learning platform for Mandarin, Cantonese and Spanish: read real text, mine words
into cards, review on an FSRS schedule, then speak (pronunciation, tones, conversation).
**Claude explains; the scheduler decides; the journal remembers.** Go backend + Vite/TS
frontend embedded in the binary; deployed on the Homelab platform.

Read first: `docs/adr/` (0001 architecture before any structural change), `docs/ROADMAP.md`.

## Commands

```bash
gofmt -l .                     # must print nothing
go vet ./...
go test ./...
go run .                       # backend + embedded UI
cd web && npm ci && npm run dev    # UI hot reload on :5173, proxies /api
cd web && npm run build        # tsc --noEmit + vite build — CI runs this
```

## Layout

```
main.go, main_test.go   entrypoint, HTTP handlers, wiring
internal/lang           language packs + tokenization — the ONLY place for language-specific code
internal/align          validation of LLM/translation output before it is stored or shown
internal/translate      translation providers (on-device first, Google optional — ADRs 0002/0003)
internal/dict           dictionary lookups / word colors
internal/pinyin         pinyin handling
web/                    Vite + TypeScript UI (web/embed.go embeds web/dist); saved words and
                        review currently live in the browser (ADR 0005) — FSRS is on the roadmap
docs/adr/, docs/ROADMAP.md
catalog-info.yaml       Backstage entity
```

## Non-negotiables

- **The deterministic core stays deterministic:** tokenization, scheduling and validation are
  plain Go with tests. LLM output is validated before it is stored or rendered. The LLM never grades the learner.
- **Language-specific code lives only in packs** (`internal/lang`); no `if lang == …` elsewhere.
- **Licensing:** lexicon data must be CC BY-SA compatible and credited in the README when added.
  Don't bundle words.hk data until its license has been read.
- **No audio stored by default** (ADR 0001 §5). Never add a PVC for media.
- Changing a decision needs a new ADR; don't edit an accepted one.
- Public repo: no API keys; secrets live as SealedSecrets in Homelab.

## Adding a feature

1. Branch `feat/<topic>`. New language → a pack in `internal/lang` with tokenizer tests.
2. Anything LLM-backed: validate in `internal/align` (or equivalent) with tests for rejected output.
3. Prefer on-device/browser capabilities first (ADRs 0003, 0005); server-side LLM calls are optional.
4. gofmt/vet/test + `npm run build` green → PR with a conventional title.

## Shipping

CI builds `ghcr.io/blacklotus89898/sprout:<sha>`; Homelab pins that SHA in `services/sprout/`.
Never `:latest`.

**Pushing from an agent:** an interactive credential helper can hang with nobody to answer it.
Use `gh` credentials: `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.

## Knowledge base

If the `knowledge` MCP is connected, search it before debugging and write back non-obvious
fixes (rules: DaVinci `AGENTS.md`).
