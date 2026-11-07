package translate

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Blacklotus89898/Sprout/internal/lang"
	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// DefaultModel is Claude Opus 5.5 at low effort: translation of a sentence is
// a routine task, and low effort keeps cost and latency down.
const DefaultModel = "claude-opus-5-5"

// Claude asks the Claude API for segments with structured output, so the
// response is schema-valid JSON. Whether the mapping is *right* is still
// decided by align.Validate.
type Claude struct {
	client anthropic.Client
	model  string
}

// NewClaude builds the model from an API key (ANTHROPIC_API_KEY in the pod).
func NewClaude(apiKey, model string) *Claude {
	if model == "" {
		model = DefaultModel
	}
	return &Claude{client: anthropic.NewClient(option.WithAPIKey(apiKey)), model: model}
}

const system = `You are the translation engine of a language-learning app. The learner sees your translation with each piece colored like the source word(s) it translates, so the word mapping matters as much as the translation.

You get the source text as a numbered list of tokens. Only tokens marked "word" have numbers you may use; punctuation and spaces are shown for context.

Return the translation as "segments" in target-language order. Concatenating every segment's text must give the complete, natural, faithful translation, including spaces and punctuation.

For each segment, "src" lists the numbers of the source words it translates:
- Keep segments small: usually one target word or a short fixed phrase.
- Every numbered source word must appear in some segment's src. A source word may appear in several segments only if all of them have exactly the same src list (for example a word whose translation is split around other words).
- Two different src lists must never share a number. If several source words together become one target phrase, give that phrase all their numbers.
- Use [] for target pieces with no source counterpart: spaces, punctuation, articles or auxiliaries the target language needs.

Write natural target-language text, not a word-by-word gloss.`

var schema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"segments": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"text": map[string]any{"type": "string"},
					"src":  map[string]any{"type": "array", "items": map[string]any{"type": "integer"}},
				},
				"required":             []string{"text", "src"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"segments"},
	"additionalProperties": false,
}

// Segments implements Model.
func (c *Claude) Segments(ctx context.Context, req Request, feedback string) ([]Segment, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Translate from %s into %s.\n\nSource tokens:\n", req.SourceName, req.TargetName)
	for i, t := range req.Tokens {
		switch t.Kind {
		case lang.Word:
			fmt.Fprintf(&b, "%d: word %q\n", i, t.Text)
		case lang.Punct:
			fmt.Fprintf(&b, "-: punctuation %q\n", t.Text)
		}
	}
	if feedback != "" {
		fmt.Fprintf(&b, "\nYour previous answer broke the mapping rules:\n%s\nFix the mapping and answer again.", feedback)
	}

	resp, err := c.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     c.model,
		MaxTokens: 8000,
		System:    []anthropic.BetaTextBlockParam{{Text: system}},
		Messages:  []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(b.String()))},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortLow,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: schema},
		},
		// A rare safety decline is re-served by a fallback model in the same call.
		Fallbacks: anthropic.BetaFallbacksParamOfDefault(),
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
	})
	if err != nil {
		return nil, fmt.Errorf("claude: %w", err)
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal {
		return nil, fmt.Errorf("claude declined to translate this text")
	}
	if resp.StopReason == anthropic.BetaStopReasonMaxTokens {
		return nil, fmt.Errorf("claude: translation was cut off (max tokens)")
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			text.WriteString(t.Text)
		}
	}
	var out struct {
		Segments []Segment `json:"segments"`
	}
	if err := json.Unmarshal([]byte(text.String()), &out); err != nil {
		return nil, fmt.Errorf("claude: unreadable output: %w", err)
	}
	return out.Segments, nil
}
