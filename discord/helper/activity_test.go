package main

import (
	"encoding/json"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"testing"
	"time"
)

// The cases are shared with the Windows helper (discord/windows/test_helper.py): both have to agree
func TestSanitize(t *testing.T) {
	raw, err := os.ReadFile("testdata/sanitize.json")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	raw = regexp.MustCompile(`"@now([+-]\d+)?"`).ReplaceAllFunc(raw, func(m []byte) []byte {
		n := now
		if s := regexp.MustCompile(`[+-]\d+`).Find(m); s != nil {
			d, _ := strconv.ParseInt(string(s), 10, 64)
			n += d
		}
		return []byte(strconv.FormatInt(n, 10))
	})
	var file struct {
		Cases []struct {
			Name string          `json:"name"`
			In   json.RawMessage `json:"in"`
			Out  json.RawMessage `json:"out"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	for _, c := range file.Cases {
		var got, want any
		if out := sanitize(c.In); out != nil {
			json.Unmarshal(out, &got)
		}
		json.Unmarshal(c.Out, &want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s:\n got %v\nwant %v", c.Name, got, want)
		}
	}
}
