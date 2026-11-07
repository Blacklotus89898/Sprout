package lang

import (
	"github.com/Blacklotus89898/Sprout/internal/dict"
	"github.com/Blacklotus89898/Sprout/internal/pinyin"
)

// The three launch packs (ADR 0001 §2). Mandarin segments and looks up words
// against the embedded CC-CEDICT. Cantonese keeps a seed dictionary until
// CC-Canto lands. Spanish needs no segmentation dictionary.

type hanPack struct {
	code, name, roman string
	has               func(string) bool
	maxRunes          func() int
}

func (p *hanPack) Code() string         { return p.code }
func (p *hanPack) Name() string         { return p.name }
func (p *hanPack) Romanization() string { return p.roman }
func (p *hanPack) Tokenize(text string) []Token {
	return splitRuns(text, MaxMatch(p.has, p.maxRunes()))
}

// mandarin adds CC-CEDICT lookups to the Han pack.
type mandarin struct{ hanPack }

func (m *mandarin) Lookup(word string) []Sense {
	entries := dict.Default().LookupSimp(word)
	out := make([]Sense, 0, len(entries))
	for _, e := range entries {
		s := Sense{Headword: e.Simp, Reading: pinyin.Marked(e.Pinyin), Defs: e.Defs}
		if e.Trad != e.Simp {
			s.Variant = e.Trad
		}
		for _, syl := range pinyin.Parse(e.Pinyin) {
			s.Syllables = append(s.Syllables, Syllable{Text: syl.Text, Tone: syl.Tone})
		}
		out = append(out, s)
	}
	return out
}

func (m *mandarin) DictVersion() string { return "CC-CEDICT " + dict.Default().Version }

type latinPack struct{ code, name string }

func (p *latinPack) Code() string                 { return p.code }
func (p *latinPack) Name() string                 { return p.name }
func (p *latinPack) Romanization() string         { return "" }
func (p *latinPack) Tokenize(text string) []Token { return splitRuns(text, nil) }

func set(words ...string) func(string) bool {
	m := make(map[string]bool, len(words))
	for _, w := range words {
		m[w] = true
	}
	return func(w string) bool { return m[w] }
}

func init() {
	Register(&mandarin{hanPack{
		code: "cmn-Hans", name: "Mandarin (Simplified)", roman: "pinyin",
		has:      func(w string) bool { return dict.Default().HasSimp(w) },
		maxRunes: func() int { return dict.Default().MaxRunes() },
	}})
	Register(&hanPack{
		code: "yue-Hant", name: "Cantonese (Traditional)", roman: "jyutping",
		has:      set("我哋", "鍾意", "廣東話", "今日", "天氣", "好熱", "朋友", "睇戲", "唔該"),
		maxRunes: func() int { return 4 },
	})
	Register(&latinPack{code: "es", name: "Spanish"})
	// English: the learner's side of a translation (source or target).
	Register(&latinPack{code: "en", name: "English"})
}
