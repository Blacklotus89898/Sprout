// Sprout: a language-learning platform. Read real text, mine words into cards,
// review them on an FSRS schedule, then speak and converse (ADR 0001).
//
// Principle: Claude explains; the scheduler decides; the journal remembers.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/Blacklotus89898/Sprout/internal/lang"
	"github.com/Blacklotus89898/Sprout/internal/translate"
	"github.com/Blacklotus89898/Sprout/web"
)

var version = "dev" // stamped at build time (-ldflags -X main.version=<sha>)

// translator is nil when no API key is configured.
var translator *translate.Translator

// translateLimit caps paid Google calls across all users: a cheap brake on a
// runaway client or a shared link (cached repeats don't count against it).
var translateLimit = newRateLimit(30, time.Minute)

const maxTextBytes = 64 << 10

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	// Load dictionaries before serving, so the first reader request isn't the
	// slow one and a broken embed fails the pod's start, not a user's request.
	t0 := time.Now()
	for _, p := range lang.All() {
		if d, ok := p.(lang.Dictionary); ok {
			log.Info("dictionary loaded", "lang", p.Code(), "version", d.DictVersion(), "took", time.Since(t0).String())
		}
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	// Translation needs a Google Cloud Translation API key (a SealedSecret in Homelab). Without
	// one, the rest of Sprout works and /api/translate answers 503.
	if key := os.Getenv("GOOGLE_TRANSLATE_API_KEY"); key != "" {
		translator = translate.New(&translate.Google{Key: key})
		log.Info("translation enabled")
	} else {
		log.Info("translation disabled: GOOGLE_TRANSLATE_API_KEY not set")
	}
	log.Info("sprout starting", "addr", *addr, "version", version)
	if err := srv.ListenAndServe(); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func routes() http.Handler {
	mux := http.NewServeMux()

	// Platform contract (Homelab onboarding guide §1): /health 200 without auth.
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})

	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprintf(w, "# HELP sprout_build_info Build version.\n# TYPE sprout_build_info gauge\nsprout_build_info{version=%q} 1\n", version)
		fmt.Fprintf(w, "# HELP sprout_language_packs Registered language packs.\n# TYPE sprout_language_packs gauge\nsprout_language_packs %d\n", len(lang.All()))
	})

	mux.HandleFunc("GET /api/languages", func(w http.ResponseWriter, _ *http.Request) {
		type out struct {
			Code         string `json:"code"`
			Name         string `json:"name"`
			Romanization string `json:"romanization,omitempty"`
			Dictionary   string `json:"dictionary,omitempty"`
		}
		var langs []out
		for _, p := range lang.All() {
			o := out{Code: p.Code(), Name: p.Name(), Romanization: p.Romanization()}
			if d, ok := p.(lang.Dictionary); ok {
				o.Dictionary = d.DictVersion()
			}
			langs = append(langs, o)
		}
		writeJSON(w, http.StatusOK, langs)
	})

	// POST /api/tokenize {"lang","text"} → tokens with byte offsets.
	mux.HandleFunc("POST /api/tokenize", func(w http.ResponseWriter, r *http.Request) {
		p, text, ok := readRequest(w, r)
		if !ok {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"lang": p.Code(), "tokens": p.Tokenize(text)})
	})

	// POST /api/read {"lang","text"} → tokens; each word carries its dictionary
	// senses (reading, tones, definitions) when the pack has a dictionary.
	// The reader renders this as-is: one request per pasted text.
	mux.HandleFunc("POST /api/read", func(w http.ResponseWriter, r *http.Request) {
		p, text, ok := readRequest(w, r)
		if !ok {
			return
		}
		type token struct {
			lang.Token
			Senses []lang.Sense `json:"senses,omitempty"`
		}
		d, hasDict := p.(lang.Dictionary)
		toks := p.Tokenize(text)
		out := make([]token, len(toks))
		known := 0
		for i, t := range toks {
			out[i] = token{Token: t}
			if hasDict && t.Kind == lang.Word {
				out[i].Senses = d.Lookup(t.Text)
				if len(out[i].Senses) > 0 {
					known++
				}
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"lang": p.Code(), "tokens": out, "known": known})
	})

	// GET /api/features → what this deployment can do (the UI hides the rest).
	mux.HandleFunc("GET /api/features", func(w http.ResponseWriter, _ *http.Request) {
		targets := make([]map[string]string, 0, len(translate.Targets))
		for _, code := range []string{"en", "cmn-Hans", "yue-Hant", "es"} {
			targets = append(targets, map[string]string{"code": code, "name": translate.Targets[code]})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"translate": translator != nil, "translateTargets": targets, "translateMaxChars": translate.MaxRunes,
		})
	})

	// POST /api/translate {"lang","target","text"} → translation segments with
	// dictionary word colors (ADR 0002). 503 when no API key is configured.
	mux.HandleFunc("POST /api/translate", func(w http.ResponseWriter, r *http.Request) {
		if translator == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "translation is not configured on this server (no Google Translate API key)"})
			return
		}
		var in struct {
			Lang   string `json:"lang"`
			Target string `json:"target"`
			Text   string `json:"text"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxTextBytes)
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		p, ok := lang.Get(in.Lang)
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown lang " + in.Lang})
			return
		}
		if !translateLimit.allow() {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many translations right now, try again in a minute"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		res, err := translator.Translate(ctx, p, in.Target, in.Text)
		switch {
		case errors.Is(err, translate.ErrInput):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		case err != nil:
			slog.Error("translate failed", "err", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "translation failed, try again"})
		default:
			writeJSON(w, http.StatusOK, res)
		}
	})

	// POST /api/align {"lang","target","text","translation"} → dictionary word
	// colors for a translation the browser made itself (Chrome's on-device
	// Translator API). No key, no paid call, so no rate limit: it's local CPU.
	mux.HandleFunc("POST /api/align", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Lang        string `json:"lang"`
			Target      string `json:"target"`
			Text        string `json:"text"`
			Translation string `json:"translation"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxTextBytes)
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		p, ok := lang.Get(in.Lang)
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown lang " + in.Lang})
			return
		}
		res, err := translate.Align(p, in.Target, in.Text, in.Translation)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	// The React reader (web/). Without a build, a hint instead of a 404.
	if files, ok := web.Dist(); ok {
		mux.Handle("GET /", http.FileServerFS(files))
	} else {
		mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprintln(w, "Sprout API is up. The web app isn't built into this binary: cd web && npm ci && npm run build, then go build.")
		})
	}

	return mux
}

// readRequest decodes {"lang","text"}, enforcing the size cap and a known pack.
func readRequest(w http.ResponseWriter, r *http.Request) (lang.Pack, string, bool) {
	var in struct {
		Lang string `json:"lang"`
		Text string `json:"text"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTextBytes)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body (max 64 KiB)"})
		return nil, "", false
	}
	p, ok := lang.Get(in.Lang)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown lang " + in.Lang})
		return nil, "", false
	}
	return p, in.Text, true
}

// rateLimit is a fixed-window counter: at most n calls per window.
type rateLimit struct {
	mu     sync.Mutex
	n      int
	window time.Duration
	start  time.Time
	used   int
}

func newRateLimit(n int, window time.Duration) *rateLimit {
	return &rateLimit{n: n, window: window}
}

func (l *rateLimit) allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now := time.Now(); now.Sub(l.start) >= l.window {
		l.start, l.used = now, 0
	}
	if l.used >= l.n {
		return false
	}
	l.used++
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
