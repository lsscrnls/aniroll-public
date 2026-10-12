package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSanitize(t *testing.T) {
	now := time.Now().UnixMilli()
	in := `{"type":3,"details":"Frieren","state":"x","evil":"field","timestamps":{"start":` + jsonInt(now) + `,"end":` + jsonInt(now+60000) + `},
		"assets":{"large_image":"file:///etc/passwd","small_image":"https://aniroll.app/icons/icon-512.png","large_text":"` + strings.Repeat("a", 300) + `"},
		"buttons":[{"label":"A","url":"javascript:alert(1)"},{"label":"View on AniRoll","url":"https://aniroll.app/a/1"},{"label":"B","url":"https://b"},{"label":"C","url":"https://c"}]}`
	var out map[string]any
	if err := json.Unmarshal(sanitize(json.RawMessage(in)), &out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out["evil"]; ok {
		t.Error("unknown field passed")
	}
	if out["state"] != "x " {
		t.Errorf("state %q not padded to 2", out["state"])
	}
	a := out["assets"].(map[string]any)
	if _, ok := a["large_image"]; ok {
		t.Error("file url passed")
	}
	if len([]rune(a["large_text"].(string))) != 128 {
		t.Error("text not clipped")
	}
	if b := out["buttons"].([]any); len(b) != 2 || b[0].(map[string]any)["url"] != "https://aniroll.app/a/1" {
		t.Errorf("buttons %v", b)
	}
	if out["timestamps"] == nil {
		t.Error("valid timestamps dropped")
	}
	if sanitize(json.RawMessage(`{"type":3,"details":"x","timestamps":{"start":-5}}`)) == nil {
		t.Error("activity with bad time dropped entirely")
	}
	if s := string(sanitize(json.RawMessage(`{"type":3,"details":"Ok","timestamps":{"start":-5}}`))); strings.Contains(s, "timestamps") {
		t.Error("bad timestamps passed")
	}
	if sanitize(json.RawMessage(`null`)) != nil || sanitize(json.RawMessage(`{"state":"no details"}`)) != nil || sanitize(json.RawMessage(`[1]`)) != nil {
		t.Error("unusable activity not cleared")
	}
}

func jsonInt(n int64) string { b, _ := json.Marshal(n); return string(b) }
