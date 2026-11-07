package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestTranslateWithoutKey(t *testing.T) {
	translator = nil
	h := routes()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/translate", strings.NewReader(`{"lang":"cmn-Hans","target":"en","text":"你好"}`)))
	if rec.Code != 503 {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/features", nil))
	if !strings.Contains(rec.Body.String(), `"translate":false`) {
		t.Fatalf("features: %s", rec.Body)
	}
}

func TestRateLimit(t *testing.T) {
	l := newRateLimit(2, time.Hour)
	if !l.allow() || !l.allow() || l.allow() {
		t.Fatal("limit of 2 not enforced")
	}
}
