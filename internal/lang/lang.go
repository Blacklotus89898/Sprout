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

// Sense is one dictionary reading of a word, in a language-neutral shape the
// reader renders directly. Syllables carry tones for tonal languages.
type Sense struct {
	Headword  string     `json:"headword"`
	Variant   string     `json:"variant,omitempty"` // the other script (traditional for cmn-Hans)
	Reading   string     `json:"reading,omitempty"` // "xué xí"
	Syllables []Syllable `json:"syllables,omitempty"`
	Defs      []string   `json:"defs"`
}

// Syllable is one romanized syllable with its tone (0 = untoned).
type Syllable struct {
	Text string `json:"text"`
	Tone int    `json:"tone"`
}

// Dictionary is implemented by packs that ship a lexicon.
type Dictionary interface {
	Lookup(word string) []Sense
	DictVersion() string // e.g. "CC-CEDICT 2026-11-07T03:55:59Z"
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

// MaxMatch segments a Han run by bidirectional maximum matching against the
// dictionary: forward (longest word from the left) and backward (longest
// word from the right), keeping the result with fewer words, then fewer
// single characters, then backward (the usual tie-break for Chinese).
// "他说明天" → forward 他|说明|天 ("he explains day"), backward 他|说|明天
// ("he says tomorrow"): same count, backward has fewer single characters.
// It is the deterministic baseline; a smarter segmenter can replace it per
// pack without changing the Token contract.
func MaxMatch(has func(string) bool, maxRunes int) func(run string, base int) []Token {
	return func(run string, base int) []Token {
		runes := []rune(run)
		fwd, bwd := forward(runes, has, maxRunes), backward(runes, has, maxRunes)
		pick := bwd
		if len(fwd) < len(bwd) || (len(fwd) == len(bwd) && singles(fwd) < singles(bwd)) {
			pick = fwd
		}
		out := make([]Token, 0, len(pick))
		off := base
		for _, w := range pick {
			out = append(out, Token{Text: w, Start: off, End: off + len(w), Kind: Word})
			off += len(w)
		}
		return out
	}
}

func forward(r []rune, has func(string) bool, maxRunes int) []string {
	var out []string
	for p := 0; p < len(r); {
		n := 1
		for l := min(maxRunes, len(r)-p); l > 1; l-- {
			if has(string(r[p : p+l])) {
				n = l
				break
			}
		}
		out = append(out, string(r[p:p+n]))
		p += n
	}
	return out
}

func backward(r []rune, has func(string) bool, maxRunes int) []string {
	var rev []string
	for e := len(r); e > 0; {
		n := 1
		for l := min(maxRunes, e); l > 1; l-- {
			if has(string(r[e-l : e])) {
				n = l
				break
			}
		}
		rev = append(rev, string(r[e-n:e]))
		e -= n
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev
}

func singles(ws []string) int {
	n := 0
	for _, w := range ws {
		if utf8.RuneCountInString(w) == 1 {
			n++
		}
	}
	return n
}
