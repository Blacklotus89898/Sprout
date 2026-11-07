// Package translate turns a sentence into a translation whose pieces are
// linked back to the source words: the data behind the color-matched view
// (ADR 0001 §4).
//
// The split of work: the source is tokenized deterministically (internal/lang);
// Claude returns the translation as ordered segments, each listing the source
// word indices it translates; internal/align decides whether that mapping is
// acceptable. An invalid mapping is retried once with the errors quoted back.
// If it fails again, the translation is still returned, without colors.
// A half-wrong coloring is never shown.
package translate

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/Blacklotus89898/Sprout/internal/align"
	"github.com/Blacklotus89898/Sprout/internal/lang"
)

// MaxRunes caps one request: translation is billed per token, and the reader
// is about sentences and short paragraphs, not documents.
const MaxRunes = 1000

// Segment is one piece of the translation, in target order.
type Segment struct {
	Text string `json:"text"`
	Src  []int  `json:"src"` // source token indices; empty = no source counterpart
}

// Result is what the API returns to the web app.
type Result struct {
	Source      string       `json:"source"`
	Target      string       `json:"target"`
	SrcTokens   []lang.Token `json:"srcTokens"`
	Translation string       `json:"translation"`
	Segments    []Segment    `json:"segments"`
	// Colors: per source token and per segment, the link (color) index or -1.
	// Nil when the alignment didn't validate (the translation is still good).
	SrcColors []int  `json:"srcColors,omitempty"`
	SegColors []int  `json:"segColors,omitempty"`
	Aligned   bool   `json:"aligned"`
	Note      string `json:"note,omitempty"` // why it isn't aligned, if it isn't
}

// Model proposes segments. The Claude implementation is in claude.go; tests
// use a fake. feedback is empty on the first attempt and carries the
// validator's errors on the retry.
type Model interface {
	Segments(ctx context.Context, req Request, feedback string) ([]Segment, error)
}

// Request is what the model sees.
type Request struct {
	SourceName, TargetName string
	Tokens                 []lang.Token
}

// Translator runs the propose → validate → (retry) → color pipeline.
type Translator struct {
	Model Model
	cache *lru
}

// New returns a Translator with a small in-memory cache, so the same
// sentence is paid for once per process (ADR 0001 §4: cached per sentence).
func New(m Model) *Translator { return &Translator{Model: m, cache: newLRU(500)} }

// Targets are the languages a translation can go to: the learning packs plus English.
var Targets = map[string]string{"en": "English", "cmn-Hans": "Mandarin Chinese (Simplified)", "yue-Hant": "Cantonese (Traditional Chinese, colloquial written Cantonese)", "es": "Spanish"}

// ErrInput is a bad request (unknown language, empty or oversized text).
var ErrInput = errors.New("bad translation request")

// Translate translates text from the src pack into the target language.
func (t *Translator) Translate(ctx context.Context, src lang.Pack, target, text string) (*Result, error) {
	text = strings.TrimSpace(text)
	tgtName, ok := Targets[target]
	switch {
	case !ok:
		return nil, fmt.Errorf("%w: unknown target %q", ErrInput, target)
	case target == src.Code():
		return nil, fmt.Errorf("%w: source and target are the same", ErrInput)
	case text == "":
		return nil, fmt.Errorf("%w: empty text", ErrInput)
	case utf8.RuneCountInString(text) > MaxRunes:
		return nil, fmt.Errorf("%w: text longer than %d characters", ErrInput, MaxRunes)
	}
	key := src.Code() + "\x00" + target + "\x00" + text
	if r, ok := t.cache.get(key); ok {
		return r, nil
	}

	toks := src.Tokenize(text)
	req := Request{SourceName: Targets[src.Code()], TargetName: tgtName, Tokens: toks}
	if req.SourceName == "" {
		req.SourceName = src.Name()
	}
	res := &Result{Source: src.Code(), Target: target, SrcTokens: toks}

	feedback := ""
	for attempt := 0; attempt < 2; attempt++ {
		segs, err := t.Model.Segments(ctx, req, feedback)
		if err != nil {
			return nil, err
		}
		res.Segments = segs
		res.Translation = join(segs)
		srcColors, segColors, err := colors(toks, segs)
		if err == nil {
			res.SrcColors, res.SegColors, res.Aligned, res.Note = srcColors, segColors, true, ""
			break
		}
		res.Note = "word colors unavailable: the model's word mapping didn't validate"
		feedback = err.Error()
	}
	t.cache.put(key, res)
	return res, nil
}

func join(segs []Segment) string {
	var b strings.Builder
	for _, s := range segs {
		b.WriteString(s.Text)
	}
	return b.String()
}

// colors converts segments into align.Links (segments with the same source
// set share one link, so "ne … pas" is one color), validates them, and maps
// tokens and segments to color indices.
func colors(toks []lang.Token, segs []Segment) (src, seg []int, err error) {
	a := align.Alignment{SrcWords: make([]bool, len(toks)), TgtWords: make([]bool, len(segs))}
	for i, tk := range toks {
		a.SrcWords[i] = tk.Kind == lang.Word
	}
	linkOf := map[string]int{}
	for j, s := range segs {
		if len(s.Src) == 0 {
			continue
		}
		a.TgtWords[j] = true
		set := append([]int(nil), s.Src...)
		sort.Ints(set)
		k := fmt.Sprint(set)
		li, ok := linkOf[k]
		if !ok {
			li = len(a.Links)
			linkOf[k] = li
			a.Links = append(a.Links, align.Link{Src: set})
		}
		a.Links[li].Tgt = append(a.Links[li].Tgt, j)
	}
	if err := a.Validate(); err != nil {
		return nil, nil, err
	}
	src, seg = a.Colors()
	return src, seg, nil
}
