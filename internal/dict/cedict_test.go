package dict

import (
	"strings"
	"testing"
)

const sample = `# CC-CEDICT
#! date=2026-11-07T03:55:59Z
學習 学习 [xue2 xi2] /to learn; to study/
綠 绿 [lu4] /used in names/
綠 绿 [lu:4] /green/
中文 中文 [Zhong1 wen2] /Chinese language/
`

func TestParse(t *testing.T) {
	d, err := Parse(strings.NewReader(sample))
	if err != nil {
		t.Fatal(err)
	}
	if d.Version != "2026-11-07T03:55:59Z" {
		t.Errorf("version %q", d.Version)
	}
	e := d.LookupSimp("学习")
	if len(e) != 1 || e[0].Trad != "學習" || e[0].Pinyin != "xue2 xi2" || e[0].Defs[0] != "to learn; to study" {
		t.Fatalf("学习: %+v", e)
	}
	if got := d.LookupSimp("绿"); len(got) != 2 || got[1].Defs[0] != "green" {
		t.Errorf("绿 readings: %+v", got)
	}
	if got := d.LookupTrad("綠"); len(got) != 2 {
		t.Errorf("trad 綠: %+v", got)
	}
	if got := d.LookupTrad("中文"); len(got) != 1 {
		t.Errorf("trad == simp headword: %+v", got)
	}
	if d.MaxRunes() != 2 {
		t.Errorf("maxRunes %d", d.MaxRunes())
	}
}

func TestParseRejectsMalformed(t *testing.T) {
	if _, err := Parse(strings.NewReader("學習 学习 xue2 xi2 /oops/\n")); err == nil {
		t.Fatal("malformed line accepted")
	}
}

func TestDefaultEmbedded(t *testing.T) {
	d := Default()
	if d.Len() < 100000 {
		t.Fatalf("embedded dictionary has only %d headwords", d.Len())
	}
	if !d.HasSimp("学习") || !d.HasSimp("中文") {
		t.Fatal("common words missing")
	}
}
