package translate

import (
	"sort"
	"strings"
	"unicode"

	"github.com/Blacklotus89898/Sprout/internal/dict"
	"github.com/Blacklotus89898/Sprout/internal/lang"
)

// Dictionary alignment (ADR 0002): a Chinese word and an English word get
// the same color only when the Chinese word's own CC-CEDICT definitions
// contain that English word. No model, no tokens, the same answer every
// time. Words it can't prove stay uncolored.

// stop words carry no meaning in a gloss ("to learn", "the weather").
var stop = set("a", "an", "the", "to", "of", "be", "is", "are", "sb", "sth", "sb's", "one", "one's", "oneself",
	"etc", "esp", "lit", "fig", "used", "see", "also", "variant", "abbr", "cl", "kind", "sort", "something", "somebody")

// light words (light verbs, prepositions, connectives) are dropped from a definition that
// has another content word ("to take a walk" → walk; "to go in" → go), kept
// when they're all there is ("to go" → go; 在 "at; in" → at, in).
var light = set("take", "make", "do", "have", "get", "give", "go", "come", "put", "be",
	"in", "on", "at", "for", "with", "by", "from", "into", "about", "as", "up", "out", "off", "over",
	"and", "or", "but", "nor", "yet", "so", "if", "than")

func set(ws ...string) map[string]bool {
	m := make(map[string]bool, len(ws))
	for _, w := range ws {
		m[w] = true
	}
	return m
}

// stem folds simple English inflections so "studies"/"studying" meet "study".
func stem(w string) string {
	w = strings.ToLower(strings.TrimSuffix(w, "'s"))
	switch {
	case len(w) > 4 && strings.HasSuffix(w, "ies"):
		return w[:len(w)-3] + "y"
	case len(w) > 5 && strings.HasSuffix(w, "ing"):
		return w[:len(w)-3]
	case len(w) > 4 && strings.HasSuffix(w, "ed"):
		return w[:len(w)-2]
	case len(w) > 3 && strings.HasSuffix(w, "es") && strings.ContainsAny(w[len(w)-3:len(w)-2], "sxz"):
		return w[:len(w)-2]
	case len(w) > 3 && strings.HasSuffix(w, "s") && !strings.HasSuffix(w, "ss"):
		return w[:len(w)-1]
	}
	return w
}

// glossWords returns the stemmed content words of a Chinese word's
// definitions, in definition order (first sense first).
func glossWords(senses []dict.Entry) []string {
	var out []string
	seen := map[string]bool{}
	for _, e := range senses {
		for _, def := range e.Defs {
			if describesUsage(def) {
				continue
			}
			def = dropParens(def)
			def = strings.ReplaceAll(def, "in order to", " ") // a fixed phrase, not the preposition "in"
			for _, part := range strings.Split(def, ";") {
				words := strings.FieldsFunc(part, func(r rune) bool { return !unicode.IsLetter(r) && r != '\'' })
				var content []string
				for _, w := range words {
					if lw := strings.ToLower(w); !stop[lw] {
						content = append(content, lw)
					}
				}
				hasHeavy := false
				for _, w := range content {
					if !light[w] {
						hasHeavy = true
					}
				}
				for _, w := range content {
					if hasHeavy && light[w] {
						continue
					}
					if s := stem(w); !seen[s] {
						seen[s] = true
						out = append(out, s)
					}
				}
			}
		}
	}
	return out
}

// describesUsage spots definitions that explain how a word is used rather
// than what it means ("classifier for books", "noun suffix for …"). Their
// English words aren't translations, so they must not earn colors (本 would
// otherwise take "book" from 书).
func describesUsage(def string) bool {
	d := strings.ToLower(strings.TrimSpace(dropParens(def)))
	for _, p := range []string{"cl:", "classifier", "measure word", "surname", "noun suffix", "suffix", "prefix",
		"refers to", "used ", "particle", "variant of", "abbr", "old variant", "see ", "interjection", "onomatopoeia"} {
		if strings.HasPrefix(d, p) {
			return true
		}
	}
	return strings.Contains(d, "variant of")
}

func dropParens(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch {
		case r == '(':
			depth++
		case r == ')' && depth > 0:
			depth--
		case depth == 0:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// lookup finds a Chinese word's entries in the right script.
func lookup(d *dict.CEDICT, code, word string) []dict.Entry {
	if code == "yue-Hant" {
		return d.LookupTrad(word)
	}
	return d.LookupSimp(word)
}

// isChinese reports whether a pack is one the dictionary can gloss.
func isChinese(code string) bool { return code == "cmn-Hans" || code == "yue-Hant" }

// dictLinks maps Chinese words to English words. zh/en are the token slices
// of the Chinese and English sides, whichever was the source. It returns
// pairs (zhIndex, enIndex); each English token is used at most once.
func dictLinks(d *dict.CEDICT, zhCode string, zh, en []lang.Token) [][2]int {
	enStem := make([]string, len(en))
	for j, t := range en {
		if t.Kind == lang.Word {
			enStem[j] = stem(t.Text)
		}
	}
	type cand struct {
		zh   int
		opts []int // English token indices, best first (gloss order)
	}
	var cands []cand
	for i, t := range zh {
		if t.Kind != lang.Word || !lang.IsHan([]rune(t.Text)[0]) {
			continue
		}
		var opts []int
		for _, g := range glossWords(lookup(d, zhCode, t.Text)) {
			for j, s := range enStem {
				if s != "" && s == g {
					opts = append(opts, j)
				}
			}
		}
		if len(opts) > 0 {
			cands = append(cands, cand{i, opts})
		}
	}
	// Most specific first: a word with one possible match claims it before a
	// word with many (很 "very" shouldn't steal from 非常 "very").
	sort.SliceStable(cands, func(a, b int) bool { return len(cands[a].opts) < len(cands[b].opts) })
	used := map[int]bool{}
	var pairs [][2]int
	for _, c := range cands {
		for _, j := range c.opts {
			if !used[j] {
				used[j] = true
				pairs = append(pairs, [2]int{c.zh, j})
				break
			}
		}
	}
	return pairs
}
