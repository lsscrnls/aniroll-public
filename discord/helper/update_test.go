package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSelfUpdate(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	bin := []byte("new helper")
	sum := sha256.Sum256(bin)
	manifest := []byte(fmt.Sprintf(`{"helpers":{%q:{"version":"9.0.0","sha256":%q}}}`, platform(), hex.EncodeToString(sum[:])))
	sig := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, manifest)))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/update.json":
			w.Write(manifest)
		case "/update.sig":
			w.Write(sig)
		case "/aniroll-discord-" + platform():
			w.Write(bin)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	updateBase, updateKey = srv.URL, base64.StdEncoding.EncodeToString(pub)
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	exe := installedExe()
	os.MkdirAll(filepath.Dir(exe), 0o755)
	os.WriteFile(exe, []byte("old helper"), 0o755)
	got := func() string { b, _ := os.ReadFile(exe); return string(b) }

	if err := selfUpdate(); err != nil || got() != "old helper" {
		t.Fatalf("off: %v, %q", err, got())
	}
	saveSettings(settings{AutoUpdate: true})
	// Signed by someone else: nothing happens
	updateKey = base64.StdEncoding.EncodeToString(make([]byte, 32))
	if err := selfUpdate(); err == nil || got() != "old helper" {
		t.Fatalf("bad signature: %v, %q", err, got())
	}
	updateKey = base64.StdEncoding.EncodeToString(pub)
	if err := selfUpdate(); err != nil || got() != "new helper" {
		t.Fatalf("update: %v, %q", err, got())
	}
	if !newer("1.0.10", "1.0.9") || newer("1.0.3", "1.0.3") || newer("1.0.2", "1.0.3") {
		t.Fatal("newer")
	}
}
