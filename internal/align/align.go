// Package align validates word-by-word translation alignments, the data
// behind the color-matched sentence view (ADR 0001 §4).
//
// The split of work: tokenization of BOTH sides is deterministic
// (internal/lang); Claude only proposes Links between token indices; this
// package decides whether a proposal is acceptable. An invalid proposal is
// rejected (and retried or shown without colors) — never rendered half-wrong.
package align

import (
	"errors"
	"fmt"
)

// Link joins a group of source word tokens to a group of target word tokens
// that mean the same thing ("天气" ↔ "the weather", "hace calor" ↔ "it's hot").
// Indices point into the full token slices (punctuation and spaces included),
// so the UI can color tokens in place.
type Link struct {
	Src []int `json:"src"`
	Tgt []int `json:"tgt"`
}

// Alignment is one sentence pair plus its links. Link i gets color i.
type Alignment struct {
	SrcWords []bool `json:"-"` // which source tokens are words (from lang.Token.Kind)
	TgtWords []bool `json:"-"`
	Links    []Link `json:"links"`
}

// Validate enforces the invariants the renderer relies on:
//   - every index is in range and points at a word (never punctuation/space);
//   - no token belongs to two links (one token = one color);
//   - every link has at least one source token (target-only links are
//     allowed to be absent: "do", articles... may stay uncolored);
//   - every source word is covered — the learner's sentence is fully explained.
//
// It returns all problems joined, so a retry prompt can quote them back.
func (a Alignment) Validate() error {
	var errs []error
	srcSeen := make(map[int]int)
	tgtSeen := make(map[int]int)
	for li, l := range a.Links {
		if len(l.Src) == 0 {
			errs = append(errs, fmt.Errorf("link %d: no source tokens", li))
		}
		check := func(side string, idx []int, words []bool, seen map[int]int) {
			for _, i := range idx {
				switch {
				case i < 0 || i >= len(words):
					errs = append(errs, fmt.Errorf("link %d: %s index %d out of range [0,%d)", li, side, i, len(words)))
				case !words[i]:
					errs = append(errs, fmt.Errorf("link %d: %s index %d is not a word", li, side, i))
				default:
					if prev, dup := seen[i]; dup {
						errs = append(errs, fmt.Errorf("link %d: %s index %d already in link %d", li, side, i, prev))
					} else {
						seen[i] = li
					}
				}
			}
		}
		check("src", l.Src, a.SrcWords, srcSeen)
		check("tgt", l.Tgt, a.TgtWords, tgtSeen)
	}
	for i, isWord := range a.SrcWords {
		if _, ok := srcSeen[i]; isWord && !ok {
			errs = append(errs, fmt.Errorf("src word %d not covered by any link", i))
		}
	}
	return errors.Join(errs...)
}

// Colors returns, for each source and target token, the link (color) index it
// belongs to, or -1 for uncolored. Call only on a valid alignment.
func (a Alignment) Colors() (src, tgt []int) {
	src = fill(len(a.SrcWords))
	tgt = fill(len(a.TgtWords))
	for li, l := range a.Links {
		for _, i := range l.Src {
			src[i] = li
		}
		for _, i := range l.Tgt {
			tgt[i] = li
		}
	}
	return src, tgt
}

func fill(n int) []int {
	s := make([]int, n)
	for i := range s {
		s[i] = -1
	}
	return s
}
