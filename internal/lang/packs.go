package lang

// The three launch packs (ADR 0001 §2). The Chinese packs ship a tiny seed
// dictionary so segmentation is exercised end to end; the real lexicons
// (CC-CEDICT for Mandarin, CC-Canto + CC-CEDICT Cantonese readings for
// Cantonese, both CC BY-SA) load from data files in a later increment.

type hanPack struct {
	code, name, roman string
	dict              map[string]bool
	maxRunes          int
}

func (p *hanPack) Code() string         { return p.code }
func (p *hanPack) Name() string         { return p.name }
func (p *hanPack) Romanization() string { return p.roman }
func (p *hanPack) Tokenize(text string) []Token {
	return splitRuns(text, MaxMatch(p.dict, p.maxRunes))
}

type latinPack struct{ code, name string }

func (p *latinPack) Code() string                 { return p.code }
func (p *latinPack) Name() string                 { return p.name }
func (p *latinPack) Romanization() string         { return "" }
func (p *latinPack) Tokenize(text string) []Token { return splitRuns(text, nil) }

func set(words ...string) map[string]bool {
	m := make(map[string]bool, len(words))
	for _, w := range words {
		m[w] = true
	}
	return m
}

func init() {
	Register(&hanPack{
		code: "cmn-Hans", name: "Mandarin (Simplified)", roman: "pinyin", maxRunes: 4,
		dict: set("我们", "学习", "中文", "喜欢", "今天", "天气", "非常", "朋友", "电影"),
	})
	Register(&hanPack{
		code: "yue-Hant", name: "Cantonese (Traditional)", roman: "jyutping", maxRunes: 4,
		dict: set("我哋", "鍾意", "廣東話", "今日", "天氣", "好熱", "朋友", "睇戲", "唔該"),
	})
	Register(&latinPack{code: "es", name: "Spanish"})
}
