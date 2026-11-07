package translate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Google calls Cloud Translation API v2 (Basic, neural MT) with an API key.
// It's plain REST, so there's no SDK dependency. Pricing: first 500k
// characters/month free, then $20 per million (ADR 0002).
type Google struct {
	Key      string
	Endpoint string // default https://translation.googleapis.com/language/translate/v2
	HTTP     *http.Client
}

// googleCode maps Sprout pack codes to Google's language codes.
var googleCode = map[string]string{
	"en":       "en",
	"es":       "es",
	"cmn-Hans": "zh-CN",
	"yue-Hant": "yue", // Cantonese; unverified for the Cloud API, so see fallback below
}

// errUnsupported marks a 400 from Google about a language it doesn't take.
var errUnsupported = errors.New("language not supported by Google")

// Translate implements Engine.
func (g *Google) Translate(ctx context.Context, text, from, to string) (string, string, error) {
	out, err := g.call(ctx, text, googleCode[from], googleCode[to])
	if errors.Is(err, errUnsupported) && (from == "yue-Hant" || to == "yue-Hant") {
		// Fall back to written Traditional Chinese for the Cantonese side.
		swap := func(c string) string {
			if c == "yue-Hant" {
				return "zh-TW"
			}
			return googleCode[c]
		}
		out, err = g.call(ctx, text, swap(from), swap(to))
		if err == nil {
			return out, "Google has no Cantonese here: translated as written Chinese (Traditional).", nil
		}
	}
	return out, "", err
}

func (g *Google) call(ctx context.Context, text, source, target string) (string, error) {
	endpoint := g.Endpoint
	if endpoint == "" {
		endpoint = "https://translation.googleapis.com/language/translate/v2"
	}
	client := g.HTTP
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	form := url.Values{"q": {text}, "source": {source}, "target": {target}, "format": {"text"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"?key="+url.QueryEscape(g.Key), strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("google translate: %w", err)
	}
	defer resp.Body.Close()
	var body struct {
		Data struct {
			Translations []struct {
				TranslatedText string `json:"translatedText"`
			} `json:"translations"`
		} `json:"data"`
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("google translate: HTTP %d, unreadable body", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK || len(body.Data.Translations) == 0 {
		msg := body.Error.Message
		if resp.StatusCode == http.StatusBadRequest && strings.Contains(strings.ToLower(msg), "language") {
			return "", fmt.Errorf("%w: %s", errUnsupported, msg)
		}
		// Never echo the request URL: it carries the key.
		return "", fmt.Errorf("google translate: HTTP %d: %s", resp.StatusCode, msg)
	}
	// format=text should return plain text; unescape defensively anyway.
	return html.UnescapeString(body.Data.Translations[0].TranslatedText), nil
}
