// Package pinyin turns CC-CEDICT's numbered pinyin ("xue2 xi2", "nu:3") into
// tone-marked pinyin ("xué xí", "nǚ") and per-syllable tone numbers (for the
// reader's tone colors). Pure functions, no data.
package pinyin

import (
	"strings"
	"unicode"
)

var marks = map[rune][5]rune{
	'a': {'ā', 'á', 'ǎ', 'à', 'a'},
	'e': {'ē', 'é', 'ě', 'è', 'e'},
	'i': {'ī', 'í', 'ǐ', 'ì', 'i'},
	'o': {'ō', 'ó', 'ǒ', 'ò', 'o'},
	'u': {'ū', 'ú', 'ǔ', 'ù', 'u'},
	'ü': {'ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'},
}

// Syllable is one converted syllable.
type Syllable struct {
	Text string `json:"text"` // tone-marked: "xué"
	Tone int    `json:"tone"` // 1–4, 5 = neutral, 0 = not a pinyin syllable ("A", "·", ",")
}

// Parse converts a space-separated numbered pinyin string.
func Parse(numbered string) []Syllable {
	fields := strings.Fields(numbered)
	out := make([]Syllable, 0, len(fields))
	for _, f := range fields {
		out = append(out, convert(f))
	}
	return out
}

// Marked returns the whole reading tone-marked: "xue2 xi2" → "xué xí".
func Marked(numbered string) string {
	syl := Parse(numbered)
	parts := make([]string, len(syl))
	for i, s := range syl {
		parts[i] = s.Text
	}
	return strings.Join(parts, " ")
}

func convert(s string) Syllable {
	s = strings.ReplaceAll(s, "u:", "ü")
	s = strings.ReplaceAll(s, "U:", "Ü")
	n := len(s)
	if n < 2 || s[n-1] < '1' || s[n-1] > '5' {
		return Syllable{Text: s} // "A", "·", ",", "xx" — pass through untoned
	}
	tone := int(s[n-1] - '0')
	body := s[:n-1]
	if body == "r" || body == "R" { // erhua: "r5"
		return Syllable{Text: body, Tone: 5}
	}
	runes := []rune(body)
	at := markIndex(runes)
	if at < 0 {
		return Syllable{Text: body}
	}
	lower := unicode.ToLower(runes[at])
	m := marks[lower][tone-1]
	if unicode.IsUpper(runes[at]) {
		m = unicode.ToUpper(m)
	}
	runes[at] = m
	return Syllable{Text: string(runes), Tone: tone}
}

// markIndex applies the standard placement rules: a or e takes the mark; in
// "ou" the o does; otherwise the last vowel.
func markIndex(r []rune) int {
	last := -1
	for i, c := range r {
		lc := unicode.ToLower(c)
		if lc == 'a' || lc == 'e' {
			return i
		}
		if lc == 'o' && i+1 < len(r) && unicode.ToLower(r[i+1]) == 'u' {
			return i
		}
		if _, ok := marks[lc]; ok {
			last = i
		}
	}
	return last
}
