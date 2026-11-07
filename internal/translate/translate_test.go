package translate

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Blacklotus89898/Sprout/internal/lang"
)

// fake returns a fixed translation and counts calls.
type fake struct {
	out   string
	calls int
}

func (f *fake) Translate(context.Context, string, string, string) (string, string, error) {
	f.calls++
	return f.out, "", nil
}

func pack(t *testing.T, code string) lang.Pack {
	p, ok := lang.Get(code)
	if !ok {
		t.Fatalf("no pack %s", code)
	}
	return p
}

// colorOf returns the color of the first token with this text.
func colorOf(toks []lang.Token, colors []int, text string) int {
	for i, tk := range toks {
		if tk.Text == text {
			return colors[i]
		}
	}
	return -2
}

func TestChineseToEnglishColors(t *testing.T) {
	f := &fake{out: "We study Chinese every day."}
	r, err := New(f).Translate(context.Background(), pack(t, "cmn-Hans"), "en", "我们每天学习中文。")
	if err != nil {
		t.Fatal(err)
	}
	// Each pair below is proven by CC-CEDICT: 我们 "we", 学习 "to study", 中文 "Chinese".
	for zh, en := range map[string]string{"我们": "We", "学习": "study", "中文": "Chinese"} {
		c := colorOf(r.SrcTokens, r.SrcColors, zh)
		if c < 0 || c != colorOf(r.TgtTokens, r.TgtColors, en) {
			t.Errorf("%s ↔ %s not matched (src=%v tgt=%v)", zh, en, r.SrcColors, r.TgtColors)
		}
	}
	if r.Matched < 3 || r.Words != 4 {
		t.Errorf("matched %d of %d", r.Matched, r.Words)
	}
}

func TestEnglishToChineseColors(t *testing.T) {
	f := &fake{out: "今天天气很好"}
	r, err := New(f).Translate(context.Background(), pack(t, "en"), "cmn-Hans", "The weather is good today")
	if err != nil {
		t.Fatal(err)
	}
	if c := colorOf(r.SrcTokens, r.SrcColors, "weather"); c < 0 || c != colorOf(r.TgtTokens, r.TgtColors, "天气") {
		t.Errorf("weather ↔ 天气: src=%v tgt=%v", r.SrcColors, r.TgtColors)
	}
	if c := colorOf(r.SrcTokens, r.SrcColors, "today"); c < 0 || c != colorOf(r.TgtTokens, r.TgtColors, "今天") {
		t.Errorf("today ↔ 今天")
	}
	if colorOf(r.SrcTokens, r.SrcColors, "The") != -1 {
		t.Errorf("an article got a color")
	}
}

func TestNoColorsWithoutDictionary(t *testing.T) {
	r, err := New(&fake{out: "I don't know"}).Translate(context.Background(), pack(t, "es"), "en", "No sé")
	if err != nil {
		t.Fatal(err)
	}
	if r.SrcColors != nil || r.Note == "" || r.Translation != "I don't know" {
		t.Errorf("%+v", r)
	}
}

func TestOneEnglishWordOneColor(t *testing.T) {
	// 非常 and 很 both gloss "very"; only one "very" exists, so only one gets it.
	r, err := New(&fake{out: "very good"}).Translate(context.Background(), pack(t, "cmn-Hans"), "en", "非常很好")
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for i, tk := range r.SrcTokens {
		if (tk.Text == "非常" || tk.Text == "很") && r.SrcColors[i] >= 0 {
			n++
		}
	}
	if n != 1 {
		t.Errorf("'very' claimed by %d source words", n)
	}
}

func TestStem(t *testing.T) {
	for in, want := range map[string]string{"studies": "study", "studying": "study", "walked": "walk", "parks": "park", "boxes": "box", "class": "class", "We": "we"} {
		if got := stem(in); got != want {
			t.Errorf("stem(%q)=%q want %q", in, got, want)
		}
	}
}

func TestCacheAndInputErrors(t *testing.T) {
	f := &fake{out: "hello"}
	tr := New(f)
	for i := 0; i < 3; i++ {
		if _, err := tr.Translate(context.Background(), pack(t, "cmn-Hans"), "en", "你好"); err != nil {
			t.Fatal(err)
		}
	}
	if f.calls != 1 {
		t.Errorf("cache miss: %d calls", f.calls)
	}
	for _, c := range []struct{ target, text string }{
		{"xx", "好"}, {"cmn-Hans", "好"}, {"en", "   "}, {"en", strings.Repeat("好", MaxRunes+1)},
	} {
		if _, err := tr.Translate(context.Background(), pack(t, "cmn-Hans"), c.target, c.text); !errors.Is(err, ErrInput) {
			t.Errorf("target %s: err %v, want ErrInput", c.target, err)
		}
	}
}

func TestGoogleClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		switch {
		case r.URL.Query().Get("key") != "k":
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"error":{"code":403,"message":"bad key"}}`))
		case r.Form.Get("target") == "yue":
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error":{"code":400,"message":"Bad language pair: zh-CN|yue"}}`))
		default:
			_, _ = w.Write([]byte(`{"data":{"translations":[{"translatedText":"` + r.Form.Get("source") + `>` + r.Form.Get("target") + ` &amp; ok"}]}}`))
		}
	}))
	defer srv.Close()
	g := &Google{Key: "k", Endpoint: srv.URL}
	out, note, err := g.Translate(context.Background(), "你好", "cmn-Hans", "en")
	if err != nil || out != "zh-CN>en & ok" || note != "" {
		t.Fatalf("got %q %q %v", out, note, err)
	}
	out, note, err = g.Translate(context.Background(), "你好", "cmn-Hans", "yue-Hant")
	if err != nil || out != "zh-CN>zh-TW & ok" || note == "" {
		t.Fatalf("Cantonese fallback: %q %q %v", out, note, err)
	}
	_, _, err = (&Google{Key: "wrong", Endpoint: srv.URL}).Translate(context.Background(), "x", "en", "es")
	if err == nil || strings.Contains(err.Error(), "wrong") {
		t.Fatalf("bad key: err %v (must not echo the key)", err)
	}
}

func TestPrepositionNotStolenByVerb(t *testing.T) {
	// 去's definitions mention "in" ("apart from in space or time"); a verb
	// must not claim a preposition through a longer definition. CC-CEDICT
	// glosses 在 as "at", so "in" here honestly stays uncolored.
	r, err := New(&fake{out: "went for a walk in the park"}).Translate(context.Background(), pack(t, "cmn-Hans"), "en", "去在公园散步")
	if err != nil {
		t.Fatal(err)
	}
	if colorOf(r.SrcTokens, r.SrcColors, "去") >= 0 && colorOf(r.SrcTokens, r.SrcColors, "去") == colorOf(r.TgtTokens, r.TgtColors, "in") {
		t.Errorf("去 claimed 'in'")
	}
	if colorOf(r.TgtTokens, r.TgtColors, "in") != -1 {
		t.Errorf("'in' got a color it can't prove")
	}
	if c := colorOf(r.SrcTokens, r.SrcColors, "散步"); c < 0 || c != colorOf(r.TgtTokens, r.TgtColors, "walk") {
		t.Errorf("散步 ↔ walk (light verb 'take'/'go' dropped) not matched")
	}
}

func TestUsageNotesEarnNoColor(t *testing.T) {
	// 本 is "classifier for books": the book is 书's.
	r, err := New(&fake{out: "a new book"}).Translate(context.Background(), pack(t, "cmn-Hans"), "en", "一本新书")
	if err != nil {
		t.Fatal(err)
	}
	if c := colorOf(r.SrcTokens, r.SrcColors, "本"); c >= 0 {
		t.Errorf("本 got a color")
	}
	if c := colorOf(r.SrcTokens, r.SrcColors, "书"); c < 0 || c != colorOf(r.TgtTokens, r.TgtColors, "book") {
		t.Errorf("书 ↔ book not matched")
	}
}

func TestAlignBrowserTranslation(t *testing.T) {
	r, err := Align(pack(t, "cmn-Hans"), "en", "今天天气很好", "The weather is very good today")
	if err != nil {
		t.Fatal(err)
	}
	if r.Matched < 3 || r.SrcColors == nil {
		t.Fatalf("want ≥3 colored words (今天/天气/好), got %d", r.Matched)
	}
	for _, c := range []struct{ target, text, tr string }{
		{"en", "你好", ""},
		{"cmn-Hans", "你好", "hi"},
		{"xx", "你好", "hi"},
	} {
		if _, err := Align(pack(t, "cmn-Hans"), c.target, c.text, c.tr); !errors.Is(err, ErrInput) {
			t.Errorf("%+v: want ErrInput, got %v", c, err)
		}
	}
}
