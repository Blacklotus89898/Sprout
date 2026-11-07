package pinyin

import "testing"

func TestMarked(t *testing.T) {
	for in, want := range map[string]string{
		"xue2 xi2":    "xué xí",
		"nu:3":        "nǚ",
		"lu:4":        "lǜ",
		"Zhong1 wen2": "Zhōng wén",
		"gou3":        "gǒu", // ou: o takes the mark
		"liu2":        "liú", // last vowel
		"gui4":        "guì",
		"hao3":        "hǎo", // a wins
		"xie4":        "xiè", // e wins
		"de5":         "de",
		"wan2 r5":     "wán r",
		"A A zhi4":    "A A zhì",
		"Lu:3":        "Lǚ",
		"·":           "·",
	} {
		if got := Marked(in); got != want {
			t.Errorf("Marked(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTones(t *testing.T) {
	syl := Parse("ni3 hao3 ma5 A")
	want := []int{3, 3, 5, 0}
	for i, s := range syl {
		if s.Tone != want[i] {
			t.Errorf("syllable %d %q tone %d, want %d", i, s.Text, s.Tone, want[i])
		}
	}
}
