// Sprout: a language-learning platform. Read real text, mine words into cards,
// review them on an FSRS schedule, then speak and converse (ADR 0001).
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
	"github.com/Blacklotus89898/Sprout/web"
)

var version = "dev" // stamped at build time (-ldflags -X main.version=<sha>)

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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
