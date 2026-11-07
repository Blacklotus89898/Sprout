package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlatformEndpoints(t *testing.T) {
	h := routes()
	for _, c := range []struct {
		method, path, body, want string
		code                     int
	}{
		{"GET", "/health", "", "ok", 200},
		{"GET", "/metrics", "", "sprout_build_info", 200},
		{"GET", "/api/languages", "", `"yue-Hant"`, 200},
		{"POST", "/api/tokenize", `{"lang":"cmn-Hans","text":"我们学习中文"}`, `"text":"学习"`, 200},
		{"POST", "/api/tokenize", `{"lang":"xx","text":"a"}`, "unknown lang", 400},
		{"POST", "/api/tokenize", `not json`, "invalid JSON", 400},
		{"POST", "/api/read", `{"lang":"cmn-Hans","text":"我们学习中文。"}`, `"reading":"xué xí"`, 200},
		{"POST", "/api/read", `{"lang":"es","text":"hola"}`, `"known":0`, 200},
		{"GET", "/api/languages", "", `"dictionary":"CC-CEDICT `, 200},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, strings.NewReader(c.body)))
		if rec.Code != c.code || !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s %s: %d %q, want %d containing %q", c.method, c.path, rec.Code, rec.Body.String(), c.code, c.want)
		}
	}
}
