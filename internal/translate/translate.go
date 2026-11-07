// Package translate translates text and colors the words that match
// (ADR 0002, superseding the LLM mapping in ADR 0001 §4).
//
// The split of work, with no LLM anywhere: an Engine (Google Cloud
// Translation) produces the translated text; both sides are tokenized by
// Sprout's own language packs; the CC-CEDICT dictionary decides which
// Chinese word matches which English word; internal/align checks the result
// is well-formed before any color is shown. Words the dictionary can't prove
// stay uncolored. A wrong color is never shown.
package translate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/Blacklotus89898/Sprout/internal/align"
	"github.com/Blacklotus89898/Sprout/internal/dict"
	"github.com/Blacklotus89898/Sprout/internal/lang"
)

// MaxRunes caps one request (Google bills per character).
const MaxRunes = 1000

// Engine turns text into a translation. note is optional and user-visible
// (e.g. a language fallback).
type Engine interface {
	Translate(ctx context.Context, text, from, to string) (translation, note string, err error)
}

// Result is what the API returns to the web app.
type Result struct {
	Source      string       `json:"source"`
	Target      string       `json:"target"`
	SrcTokens   []lang.Token `json:"srcTokens"`
	Translation string       `json:"translation"`
	TgtTokens   []lang.Token `json:"tgtTokens"`
	// Per token: the color (link) index, or -1 for uncolored. Nil when no
	// dictionary covers this language pair.
	SrcColors []int `json:"srcColors,omitempty"`
	TgtColors []int `json:"tgtColors,omitempty"`
	// Matched / Words: how many source words got a color.
	Matched int    `json:"matched"`
	Words   int    `json:"words"`
	Note    string `json:"note,omitempty"`
}

// Targets are the languages a translation can go to.
var Targets = map[string]string{"en": "English", "cmn-Hans": "Mandarin (Simplified)", "yue-Hant": "Cantonese (Traditional)", "es": "Spanish"}

// ErrInput is a bad request (unknown language, empty or oversized text).
var ErrInput = errors.New("bad translation request")

// Translator runs translate → tokenize → dictionary colors, with a cache so
// a repeated sentence costs nothing.
type Translator struct {
	Engine Engine
	Dict   func() *dict.CEDICT
	cache  *lru
}

// New returns a Translator using the embedded CC-CEDICT.
func New(e Engine) *Translator {
	return &Translator{Engine: e, Dict: dict.Default, cache: newLRU(500)}
}

// Translate translates text from the src pack into the target pack.
func (t *Translator) Translate(ctx context.Context, src lang.Pack, target, text string) (*Result, error) {
	text = strings.TrimSpace(text)
	tgt, err := check(src, target, text)
	if err != nil {
		return nil, err
	}
	key := src.Code() + "\x00" + target + "\x00" + text
	if r, ok := t.cache.get(key); ok {
		return r, nil
	}
	out, note, err := t.Engine.Translate(ctx, text, src.Code(), target)
	if err != nil {
		return nil, err
	}
	res := build(t.Dict(), src, tgt, text, out, note)
	t.cache.put(key, res)
	return res, nil
}

// Align colors a translation made elsewhere: by the browser's built-in
// translator (Chrome's on-device Translator API), so no key and no paid call
// are needed. The coloring is the same dictionary-only step as Translate.
func Align(src lang.Pack, target, text, translation string) (*Result, error) {
	text, translation = strings.TrimSpace(text), strings.TrimSpace(translation)
	tgt, err := check(src, target, text)
	if err != nil {
		return nil, err
	}
	switch {
	case translation == "":
		return nil, fmt.Errorf("%w: empty translation", ErrInput)
	case utf8.RuneCountInString(translation) > 4*MaxRunes:
		return nil, fmt.Errorf("%w: translation too long", ErrInput)
	}
	return build(dict.Default(), src, tgt, text, translation, ""), nil
}

// check validates a request and returns the target pack.
func check(src lang.Pack, target, text string) (lang.Pack, error) {
	tgt, ok := lang.Get(target)
	switch {
	case !ok || Targets[target] == "":
		return nil, fmt.Errorf("%w: unknown target %q", ErrInput, target)
	case target == src.Code():
		return nil, fmt.Errorf("%w: source and target are the same", ErrInput)
	case text == "":
		return nil, fmt.Errorf("%w: empty text", ErrInput)
	case utf8.RuneCountInString(text) > MaxRunes:
		return nil, fmt.Errorf("%w: text longer than %d characters", ErrInput, MaxRunes)
	}
	return tgt, nil
}

// build tokenizes both sides and colors them.
func build(d *dict.CEDICT, src, tgt lang.Pack, text, out, note string) *Result {
	res := &Result{Source: src.Code(), Target: tgt.Code(), SrcTokens: src.Tokenize(text), Translation: out, TgtTokens: tgt.Tokenize(out), Note: note}
	for _, tk := range res.SrcTokens {
		if tk.Kind == lang.Word {
			res.Words++
		}
	}
	color(d, res)
	return res
}

// color fills SrcColors/TgtColors for Chinese ↔ English pairs.
func color(d *dict.CEDICT, res *Result) {
	var pairs [][2]int // (srcIndex, tgtIndex)
	switch {
	case isChinese(res.Source) && res.Target == "en":
		pairs = dictLinks(d, res.Source, res.SrcTokens, res.TgtTokens)
	case res.Source == "en" && isChinese(res.Target):
		for _, p := range dictLinks(d, res.Target, res.TgtTokens, res.SrcTokens) {
			pairs = append(pairs, [2]int{p[1], p[0]})
		}
	default:
		res.Note = joinNote(res.Note, "Word colors work between Chinese and English for now (they need a dictionary for both sides).")
		return
	}
	a := align.Alignment{SrcWords: words(res.SrcTokens), TgtWords: words(res.TgtTokens), Partial: true}
	for _, p := range pairs {
		a.Links = append(a.Links, align.Link{Src: []int{p[0]}, Tgt: []int{p[1]}})
	}
	if err := a.Validate(); err != nil {
		// Can't happen with dictLinks' one-to-one pairs; if it does, show no
		// colors rather than wrong ones.
		res.Note = joinNote(res.Note, "word colors unavailable")
		return
	}
	res.SrcColors, res.TgtColors = a.Colors()
	res.Matched = len(pairs)
}

func words(toks []lang.Token) []bool {
	m := make([]bool, len(toks))
	for i, tk := range toks {
		m[i] = tk.Kind == lang.Word
	}
	return m
}

func joinNote(a, b string) string {
	if a == "" {
		return b
	}
	return a + " " + b
}
