# Sprout: notes for Claude

- **Design source of truth:** `docs/adr/`. Read ADR 0001 before changing the
  architecture. A change to a decision needs a new ADR; don't edit an accepted one.
- **The deterministic core stays deterministic.** Tokenization (`internal/lang`),
  scheduling (FSRS) and validation (`internal/align`) are plain Go with tests.
  LLM output is always validated before it is stored or rendered. The LLM never
  grades the learner.
- **Language-specific code lives only in packs.** No `if lang == ...` outside
  `internal/lang`.
- **Licensing:** lexicon data must be CC BY-SA compatible. Credit each source in
  the README when it's added. Don't bundle words.hk data until its license has
  been read.
- **No audio stored by default** (ADR 0001 §5). Never add a PVC for media.
- **Before writing Claude API code,** load the `claude-api` skill for current
  model IDs and SDK usage.
- **Checks before a commit:** `gofmt -l .` prints nothing, then `go vet ./...` and
  `go test ./...`.
- **Deploys:** CI builds `ghcr.io/blacklotus89898/sprout:<sha>`. The Homelab repo
  pins that SHA in `services/sprout/`. Never use `:latest`.
- **Pushing:** the GCM credential helper hangs when nobody is there to answer it.
  Push with `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.
