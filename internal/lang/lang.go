// Package lang holds Sprout's language packs: everything that differs between
// target languages (segmentation, romanization, script) behind one interface,
// so the reader, cards, alignment and scheduler never branch on a language.
//
// Segmentation is deterministic code, never the LLM (ADR 0001 §3): the same
// text always yields the same tokens, which is what cards, alignment indices
// and the journal point at.
package lang

import (
	"fmt"
	"sort"
	"unicode"
	"unicode/utf8"
)

// Kind classifies a token. Only Word tokens become cards or need alignment.
type Kind string

const (
	Word  Kind = "word"
	Punct Kind = "punct"
	Space Kind = "space"
)

// Token is one segment of a text. Start/End are byte offsets into the original
// string, so text[Start:End] == Text always holds.
type Token struct {
	Text  string `json:"text"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	Kind  Kind   `json:"kind"`
}

// Pack is one target language.
type Pack interface {
	Code() string         // BCP 47: "cmn-Hans", "yue-Hant", "es"
	Name() string         // display name
	Romanization() string // "pinyin", "jyutping", "" (Latin script)
	Tokenize(text string) []Token
}

var registry = map[string]Pack{}

// Register adds a pack; packs register themselves in init().
func Register(p Pack) {
	if _, dup := registry[p.Code()]; dup {
		panic(fmt.Sprintf("lang: duplicate pack %q", p.Code()))
	}
	registry[p.Code()] = p
}

// Get returns the pack for a code.
func Get(code string) (Pack, bool) {
	p, ok := registry[code]
	return p, ok
}

// All returns every registered pack, sorted by code (stable API output).
func All() []Pack {
	out := make([]Pack, 0, len(registry))
	for _, p := range registry {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code() < out[j].Code() })
	return out
}

// IsHan reports whether r is a CJK ideograph (shared by Mandarin + Cantonese).
func IsHan(r rune) bool { return unicode.Is(unicode.Han, r) }

// classify buckets a rune for run-splitting.
func classify(r rune) Kind {
	switch {
	case unicode.IsSpace(r):
		return Space
	case unicode.IsLetter(r), unicode.IsDigit(r), unicode.IsMark(r):
		return Word
	default:
		return Punct
	}
}

// splitRuns cuts text into maximal runs. A Word run is further cut at every
// boundary between Han and non-Han letters ("用Go写" → 用 | Go | 写), and each
// Han run is handed to han() for dictionary segmentation. Punctuation is one
// token per rune (「」 must not merge).
func splitRuns(text string, han func(run string, base int) []Token) []Token {
	var out []Token
	i := 0
	for i < len(text) {
		r, w := utf8.DecodeRuneInString(text[i:])
		k := classify(r)
		start := i
		i += w
		if k == Punct {
			out = append(out, Token{Text: text[start:i], Start: start, End: i, Kind: Punct})
			continue
		}
		isHan := k == Word && IsHan(r)
		for i < len(text) {
			r2, w2 := utf8.DecodeRuneInString(text[i:])
			if classify(r2) != k || (k == Word && IsHan(r2) != isHan) {
				break
			}
			i += w2
		}
		if isHan && han != nil {
			out = append(out, han(text[start:i], start)...)
			continue
		}
		out = append(out, Token{Text: text[start:i], Start: start, End: i, Kind: k})
	}
	return out
}

// MaxMatch segments a Han run by forward maximum matching against dict
// (longest dictionary word first, single character as the fallback). It is
// the deterministic baseline; a smarter segmenter can replace it per pack
// without changing the Token contract.
func MaxMatch(dict map[string]bool, maxRunes int) func(run string, base int) []Token {
	return func(run string, base int) []Token {
		runes := []rune(run)
		var out []Token
		off := base
		for p := 0; p < len(runes); {
			n := 1
			for l := min(maxRunes, len(runes)-p); l > 1; l-- {
				if dict[string(runes[p:p+l])] {
					n = l
					break
				}
			}
			s := string(runes[p : p+n])
			out = append(out, Token{Text: s, Start: off, End: off + len(s), Kind: Word})
			off += len(s)
			p += n
		}
		return out
	}
}
