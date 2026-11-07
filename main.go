// Sprout — a language-learning platform: read real text, mine words into
// cards, review on an FSRS schedule, then speak and converse (ADR 0001).
//
// Principle: Claude explains; the scheduler decides; the journal remembers.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/Blacklotus89898/Sprout/internal/lang"
)

var version = "dev" // stamped at build time (-ldflags -X main.version=<sha>)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	srv := &http.Server{
		Addr:              *addr,
		Handler:           routes(),
		ReadHeaderTimeout: 5 * time.Second,
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
		}
		var langs []out
		for _, p := range lang.All() {
			langs = append(langs, out{p.Code(), p.Name(), p.Romanization()})
		}
		writeJSON(w, http.StatusOK, langs)
	})

	// POST /api/tokenize {"lang":"cmn-Hans","text":"..."} → tokens with byte offsets.
	mux.HandleFunc("POST /api/tokenize", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Lang string `json:"lang"`
			Text string `json:"text"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		p, ok := lang.Get(in.Lang)
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown lang " + in.Lang})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"lang": p.Code(), "tokens": p.Tokenize(in.Text)})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
