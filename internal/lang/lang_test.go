package lang

import (
	"reflect"
	"testing"
)

func words(toks []Token) []string {
	var out []string
	for _, t := range toks {
		if t.Kind == Word {
			out = append(out, t.Text)
		}
	}
	return out
}

func mustPack(t *testing.T, code string) Pack {
	t.Helper()
	p, ok := Get(code)
	if !ok {
		t.Fatalf("pack %q not registered", code)
	}
	return p
}

func TestTokenize(t *testing.T) {
	cases := []struct {
		code, text string
		want       []string
	}{
		{"cmn-Hans", "我们喜欢学习中文。", []string{"我们", "喜欢", "学习", "中文"}},
		{"cmn-Hans", "今天天气非常好", []string{"今天", "天气", "非常", "好"}},
		{"cmn-Hans", "用Go写代码", []string{"用", "Go", "写", "代码"}}, // Han/Latin boundary
		{"yue-Hant", "我哋食飯", []string{"我哋", "食", "飯"}},         // not in the seed dict: 1 rune each
		{"yue-Hant", "我哋鍾意講廣東話！", []string{"我哋", "鍾意", "講", "廣東話"}},
		{"es", "¿Dónde está la biblioteca?", []string{"Dónde", "está", "la", "biblioteca"}},
		{"es", "Hace 3 días, ¡qué calor!", []string{"Hace", "3", "días", "qué", "calor"}},
	}
	for _, c := range cases {
		got := words(mustPack(t, c.code).Tokenize(c.text))
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s %q: got %q, want %q", c.code, c.text, got, c.want)
		}
	}
}

// Offsets are the contract cards and alignment rely on: text[Start:End] ==
// Text, tokens are contiguous and cover the whole input.
func TestOffsetsCoverInput(t *testing.T) {
	for _, p := range All() {
		for _, text := range []string{"我们喜欢学习中文。", "我哋鍾意講廣東話！", "¿Dónde está?  Aquí.", "", "「好」"} {
			end := 0
			for _, tok := range p.Tokenize(text) {
				if tok.Start != end || text[tok.Start:tok.End] != tok.Text {
					t.Fatalf("%s %q: bad token %+v at %d", p.Code(), text, tok, end)
				}
				end = tok.End
			}
			if end != len(text) {
				t.Fatalf("%s %q: covered %d of %d bytes", p.Code(), text, end, len(text))
			}
		}
	}
}

func TestPunctuationIsOneTokenPerRune(t *testing.T) {
	toks := mustPack(t, "cmn-Hans").Tokenize("「好」")
	if len(toks) != 3 || toks[0].Kind != Punct || toks[2].Kind != Punct {
		t.Fatalf("got %+v", toks)
	}
}

func TestDeterministic(t *testing.T) {
	p := mustPack(t, "yue-Hant")
	a, b := p.Tokenize("今日天氣好熱"), p.Tokenize("今日天氣好熱")
	if !reflect.DeepEqual(a, b) {
		t.Fatal("tokenize is not deterministic")
	}
}

func TestMandarinLookup(t *testing.T) {
	d, ok := mustPack(t, "cmn-Hans").(Dictionary)
	if !ok {
		t.Fatal("cmn-Hans has no dictionary")
	}
	s := d.Lookup("学习")
	if len(s) == 0 || s[0].Reading != "xué xí" || s[0].Variant != "學習" || len(s[0].Syllables) != 2 || s[0].Syllables[0].Tone != 2 {
		t.Fatalf("学习: %+v", s)
	}
	if got := d.Lookup("绿"); len(got) < 2 {
		t.Errorf("绿 should have several readings (lǜ, lù): %+v", got)
	}
	if len(d.Lookup("Go")) != 0 {
		t.Errorf("Latin word has a Mandarin entry")
	}
	if _, ok := mustPack(t, "es").(Dictionary); ok {
		t.Error("es has no dictionary yet")
	}
}
