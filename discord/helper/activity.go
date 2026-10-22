package main

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

// Only what AniRoll sends goes on to Discord, within Discord's limits: the helper is the one part that
// runs with the user's rights, so it trusts no message blindly, not even one from the extension.
type activity struct {
	Type int `json:"type"`
	// The heading Discord shows instead of the app's name ("AniRoll: Frieren")
	Name       string      `json:"name,omitempty"`
	Details    string      `json:"details,omitempty"`
	State      string      `json:"state,omitempty"`
	Timestamps *timestamps `json:"timestamps,omitempty"`
	Assets     *assets     `json:"assets,omitempty"`
	Buttons    []button    `json:"buttons,omitempty"`
	// What the member list shows after "Watching": 0 the app's name, 1 the state, 2 the details
	StatusDisplayType int `json:"status_display_type,omitempty"`
}

type timestamps struct {
	Start int64 `json:"start,omitempty"`
	End   int64 `json:"end,omitempty"`
}

type assets struct {
	LargeImage string `json:"large_image,omitempty"`
	LargeText  string `json:"large_text,omitempty"`
	SmallImage string `json:"small_image,omitempty"`
	SmallText  string `json:"small_text,omitempty"`
}

type button struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// sanitize returns the activity rebuilt from the known fields, or nil (no status) for anything unusable
func sanitize(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" || len(raw) > 8<<10 {
		return nil
	}
	var in activity
	if json.Unmarshal(raw, &in) != nil {
		return nil
	}
	out := activity{Type: in.Type, Details: text(in.Details), State: text(in.State)}
	if name := text(in.Name); strings.HasPrefix(name, "AniRoll") {
		out.Name = name
	}
	if out.Type != 0 && out.Type != 3 { // Playing or Watching
		out.Type = 3
	}
	if out.Details == "" {
		return nil
	}
	if in.StatusDisplayType == 1 || in.StatusDisplayType == 2 {
		out.StatusDisplayType = in.StatusDisplayType
	}
	if t := in.Timestamps; t != nil {
		// Milliseconds within a day of now, the end after the start
		now := time.Now().UnixMilli()
		ok := func(ms int64) bool { return ms > now-86_400_000 && ms < now+86_400_000 }
		if ok(t.Start) && (t.End == 0 || (ok(t.End) && t.End > t.Start)) {
			out.Timestamps = &timestamps{Start: t.Start, End: t.End}
		}
	}
	if a := in.Assets; a != nil {
		out.Assets = &assets{LargeImage: image(a.LargeImage), LargeText: text(a.LargeText), SmallImage: image(a.SmallImage), SmallText: text(a.SmallText)}
		if *out.Assets == (assets{}) {
			out.Assets = nil
		}
	}
	for _, b := range in.Buttons {
		if len(out.Buttons) == 2 {
			break
		}
		label := clip(strings.TrimSpace(b.Label), 32)
		if label != "" && strings.HasPrefix(b.URL, "https://") && len(b.URL) <= 512 {
			out.Buttons = append(out.Buttons, button{Label: label, URL: b.URL})
		}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil
	}
	return b
}

// Discord takes 2 to 128 characters per line
func text(s string) string {
	s = clip(strings.TrimSpace(s), 128)
	if s != "" && utf8.RuneCountInString(s) < 2 {
		s += " "
	}
	return s
}

// Pictures only from the web, never a file or data URL
func image(s string) string {
	if strings.HasPrefix(s, "https://") && len(s) <= 256 {
		return s
	}
	return ""
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
