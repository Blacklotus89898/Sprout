// Package dict loads CC-CEDICT (CC BY-SA 4.0, https://cc-cedict.org; see
// data/README.md) into memory. The gzipped export is embedded in the binary,
// so the image stays self-contained and the Mandarin pack works offline.
package dict

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"fmt"
	"io"
	"strings"
	"sync"
	"unicode/utf8"
)

//go:embed data/cedict_ts.u8.gz
var cedictGz []byte

// Entry is one CC-CEDICT line: 學習 学习 [xue2 xi2] /to learn; to study/
type Entry struct {
	Trad   string   `json:"trad"`
	Simp   string   `json:"simp"`
	Pinyin string   `json:"pinyin"` // numbered, as in the source ("xue2 xi2")
	Defs   []string `json:"defs"`
}

// CEDICT indexes entries by simplified and by traditional headword.
type CEDICT struct {
	bySimp   map[string][]Entry
	byTrad   map[string][]Entry
	maxRunes int
	Version  string // the export's #! date= line
}

// Parse reads a CC-CEDICT export (plain text).
func Parse(r io.Reader) (*CEDICT, error) {
	d := &CEDICT{bySimp: map[string][]Entry{}, byTrad: map[string][]Entry{}}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	line := 0
	for sc.Scan() {
		line++
		s := sc.Text()
		if strings.HasPrefix(s, "#") {
			if v, ok := strings.CutPrefix(s, "#! date="); ok {
				d.Version = v
			}
			continue
		}
		if s == "" {
			continue
		}
		e, err := parseLine(s)
		if err != nil {
			return nil, fmt.Errorf("cedict line %d: %w", line, err)
		}
		d.bySimp[e.Simp] = append(d.bySimp[e.Simp], e)
		if e.Trad != e.Simp {
			d.byTrad[e.Trad] = append(d.byTrad[e.Trad], e)
		}
		if n := utf8.RuneCountInString(e.Simp); n > d.maxRunes {
			d.maxRunes = n
		}
	}
	return d, sc.Err()
}

func parseLine(s string) (Entry, error) {
	trad, rest, ok1 := strings.Cut(s, " ")
	simp, rest, ok2 := strings.Cut(rest, " [")
	pin, defs, ok3 := strings.Cut(rest, "] /")
	if !ok1 || !ok2 || !ok3 {
		return Entry{}, fmt.Errorf("malformed: %q", s)
	}
	defs = strings.TrimSuffix(strings.TrimSpace(defs), "/")
	return Entry{Trad: trad, Simp: simp, Pinyin: pin, Defs: strings.Split(defs, "/")}, nil
}

// LookupSimp returns entries whose simplified headword is word.
func (d *CEDICT) LookupSimp(word string) []Entry { return d.bySimp[word] }

// LookupTrad returns entries whose traditional headword is word.
func (d *CEDICT) LookupTrad(word string) []Entry {
	if e, ok := d.byTrad[word]; ok {
		return e
	}
	// Characters identical in both scripts are only indexed once, under simp.
	var out []Entry
	for _, e := range d.bySimp[word] {
		if e.Trad == word {
			out = append(out, e)
		}
	}
	return out
}

// HasSimp reports whether word is a simplified headword (the segmenter's dictionary).
func (d *CEDICT) HasSimp(word string) bool { _, ok := d.bySimp[word]; return ok }

// MaxRunes is the longest headword, the segmenter's lookahead bound.
func (d *CEDICT) MaxRunes() int { return d.maxRunes }

// Len is the number of distinct simplified headwords.
func (d *CEDICT) Len() int { return len(d.bySimp) }

var (
	defaultOnce sync.Once
	defaultDict *CEDICT
)

// Default returns the embedded CC-CEDICT, parsed once (~125k entries).
// A corrupt embed is a build bug, so it panics rather than limping on.
func Default() *CEDICT {
	defaultOnce.Do(func() {
		zr, err := gzip.NewReader(bytes.NewReader(cedictGz))
		if err != nil {
			panic("dict: embedded CC-CEDICT: " + err.Error())
		}
		d, err := Parse(zr)
		if err != nil {
			panic("dict: embedded CC-CEDICT: " + err.Error())
		}
		defaultDict = d
	})
	return defaultDict
}
