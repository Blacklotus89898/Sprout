package translate

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Blacklotus89898/Sprout/internal/lang"
)

// fake returns canned answers in order and records the feedback it got.
type fake struct {
	answers  [][]Segment
	calls    int
	feedback []string
}

func (f *fake) Segments(_ context.Context, _ Request, feedback string) ([]Segment, error) {
	f.feedback = append(f.feedback, feedback)
	a := f.answers[min(f.calls, len(f.answers)-1)]
	f.calls++
	return a, nil
}

func zh(t *testing.T) lang.Pack {
	p, ok := lang.Get("cmn-Hans")
	if !ok {
		t.Fatal("no cmn-Hans")
	}
	return p
}

// 今天 天气 非常 好 (tokens 0..3, all words) → "The weather is very nice today"
var good = []Segment{
	{"The weather", []int{1}}, {" is ", nil}, {"very", []int{2}}, {" ", nil}, {"nice", []int{3}}, {" ", nil}, {"today", []int{0}}, {".", nil},
}

func TestAlignedFirstTry(t *testing.T) {
	f := &fake{answers: [][]Segment{good}}
	r, err := New(f).Translate(context.Background(), zh(t), "en", "今天天气非常好")
	if err != nil {
		t.Fatal(err)
	}
	if !r.Aligned || r.Translation != "The weather is very nice today." || f.calls != 1 {
		t.Fatalf("got %+v after %d calls", r, f.calls)
	}
	// 今天 (src 0) and "today" (segment 6) share a color; " is " is uncolored.
	if r.SrcColors[0] != r.SegColors[6] || r.SegColors[1] != -1 {
		t.Errorf("colors src=%v seg=%v", r.SrcColors, r.SegColors)
	}
}

func TestRetryWithFeedbackThenAligned(t *testing.T) {
	bad := []Segment{{"The weather is very nice", []int{1, 2, 3}}, {" today", []int{3}}} // 3 in two different sets, 0 uncovered
	f := &fake{answers: [][]Segment{bad, good}}
	r, err := New(f).Translate(context.Background(), zh(t), "en", "今天天气非常好")
	if err != nil {
		t.Fatal(err)
	}
	if !r.Aligned || f.calls != 2 {
		t.Fatalf("aligned=%v calls=%d", r.Aligned, f.calls)
	}
	if f.feedback[0] != "" || !strings.Contains(f.feedback[1], "not covered") {
		t.Errorf("feedback %q", f.feedback)
	}
}

func TestTwiceInvalidStillTranslates(t *testing.T) {
	bad := []Segment{{"The weather is very nice today.", []int{99}}}
	f := &fake{answers: [][]Segment{bad}}
	r, err := New(f).Translate(context.Background(), zh(t), "en", "今天天气非常好")
	if err != nil {
		t.Fatal(err)
	}
	if r.Aligned || r.SrcColors != nil || r.Translation != "The weather is very nice today." || r.Note == "" || f.calls != 2 {
		t.Fatalf("got %+v after %d calls", r, f.calls)
	}
}

func TestSplitPieceSharesOneColor(t *testing.T) {
	// One source word rendered as two separated target pieces with the same src set.
	es, _ := lang.Get("es")
	// "No sé" tokenizes as 0 No, 1 space, 2 sé.
	f := &fake{answers: [][]Segment{{{"I", []int{2}}, {" don't", []int{0}}, {" know", []int{2}}}}}
	r, err := New(f).Translate(context.Background(), es, "en", "No sé")
	if err != nil || !r.Aligned {
		t.Fatalf("err=%v %+v", err, r)
	}
	if r.SegColors[0] != r.SegColors[2] || r.SegColors[0] == r.SegColors[1] {
		t.Errorf("seg colors %v", r.SegColors)
	}
}

func TestCacheAndInputErrors(t *testing.T) {
	f := &fake{answers: [][]Segment{good}}
	tr := New(f)
	for i := 0; i < 3; i++ {
		if _, err := tr.Translate(context.Background(), zh(t), "en", "今天天气非常好"); err != nil {
			t.Fatal(err)
		}
	}
	if f.calls != 1 {
		t.Errorf("cache miss: %d calls", f.calls)
	}
	for _, c := range []struct{ target, text string }{
		{"xx", "好"}, {"cmn-Hans", "好"}, {"en", "   "}, {"en", strings.Repeat("好", MaxRunes+1)},
	} {
		if _, err := tr.Translate(context.Background(), zh(t), c.target, c.text); !errors.Is(err, ErrInput) {
			t.Errorf("%q→%s: err %v, want ErrInput", c.text[:min(len(c.text), 6)], c.target, err)
		}
	}
}
