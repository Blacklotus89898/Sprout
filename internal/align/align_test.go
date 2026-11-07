package align

import (
	"reflect"
	"strings"
	"testing"

	"github.com/Blacklotus89898/Sprout/internal/lang"
)

func wordMask(toks []lang.Token) []bool {
	m := make([]bool, len(toks))
	for i, t := range toks {
		m[i] = t.Kind == lang.Word
	}
	return m
}

// 今天 天气 非常 好 ↔ The weather is very nice today
func fixture(t *testing.T) Alignment {
	t.Helper()
	zh, _ := lang.Get("cmn-Hans")
	en, _ := lang.Get("es")                              // Latin tokenizer; fine for the English gloss side
	src := zh.Tokenize("今天天气非常好")                        // 0 今天 1 天气 2 非常 3 好
	tgt := en.Tokenize("The weather is very nice today") // words at 0,2,4,6,8,10
	return Alignment{SrcWords: wordMask(src), TgtWords: wordMask(tgt)}
}

func TestValidAlignment(t *testing.T) {
	a := fixture(t)
	a.Links = []Link{
		{Src: []int{0}, Tgt: []int{10}},   // 今天 ↔ today
		{Src: []int{1}, Tgt: []int{0, 2}}, // 天气 ↔ The weather
		{Src: []int{2}, Tgt: []int{6}},    // 非常 ↔ very
		{Src: []int{3}, Tgt: []int{8}},    // 好 ↔ nice   ("is" stays uncolored)
	}
	if err := a.Validate(); err != nil {
		t.Fatalf("valid alignment rejected: %v", err)
	}
	src, tgt := a.Colors()
	if !reflect.DeepEqual(src, []int{0, 1, 2, 3}) {
		t.Errorf("src colors %v", src)
	}
	if tgt[0] != 1 || tgt[2] != 1 || tgt[4] != -1 || tgt[10] != 0 || tgt[1] != -1 {
		t.Errorf("tgt colors %v", tgt)
	}
}

func TestInvalidAlignments(t *testing.T) {
	cases := []struct {
		name  string
		links []Link
		want  string
	}{
		{"out of range", []Link{{Src: []int{0, 1, 2, 3}, Tgt: []int{99}}}, "out of range"},
		{"points at a space", []Link{{Src: []int{0, 1, 2, 3}, Tgt: []int{1}}}, "not a word"},
		{"token in two links", []Link{{Src: []int{0, 1}, Tgt: []int{10}}, {Src: []int{1, 2, 3}, Tgt: []int{0}}}, "already in link"},
		{"uncovered source word", []Link{{Src: []int{0, 1, 2}, Tgt: []int{10}}}, "src word 3 not covered"},
		{"target-only link", []Link{{Src: []int{0, 1, 2, 3}}, {Tgt: []int{4}}}, "no source tokens"},
	}
	for _, c := range cases {
		a := fixture(t)
		a.Links = c.links
		err := a.Validate()
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want error containing %q", c.name, err, c.want)
		}
	}
}
