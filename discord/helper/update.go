package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Updating itself (when turned on): each time a browser starts the helper, it asks aniroll.app for the
// newest version and, when that is newer, puts it in place in the background; the next start runs it.
// update.json only counts with a valid signature from discord/build.sh (the key stays on the build
// computer), so a changed file on the server cannot slip anything onto this computer.
var (
	updateBase = "https://aniroll.app/downloads/discord"
	updateKey  = "KQq/4EjU2jq2ZFoMGDUq/906uoMOCJEMQnBJsfesTC0="
)

type settings struct {
	AutoUpdate bool `json:"auto_update"`
}

func settingsPath() (string, error) {
	dir, err := homeDir()
	return filepath.Join(dir, "settings.json"), err
}

func loadSettings() settings {
	var s settings
	if p, err := settingsPath(); err == nil {
		if b, err := os.ReadFile(p); err == nil {
			json.Unmarshal(b, &s)
		}
	}
	return s
}

func saveSettings(s settings) error {
	p, err := settingsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return writeJSON(p, s)
}

// setAutoUpdate is "aniroll-discord auto-update on|off"
func setAutoUpdate(arg string) error {
	s := loadSettings()
	switch arg {
	case "on":
		s.AutoUpdate = true
	case "off":
		s.AutoUpdate = false
	case "":
		state := "off"
		if s.AutoUpdate {
			state = "on"
		}
		fmt.Println("Updating by itself is " + state + ". Turn it on or off with: aniroll-discord auto-update on|off")
		return nil
	default:
		return errors.New(`say "on" or "off"`)
	}
	if err := saveSettings(s); err != nil {
		return err
	}
	if s.AutoUpdate {
		fmt.Println("AniRoll for Discord now updates by itself.")
	} else {
		fmt.Println("AniRoll for Discord no longer updates by itself.")
	}
	return nil
}

// update.json: per system ("linux-amd64", …, "windows") the newest version and the SHA-256 of its file
type release struct {
	Helpers map[string]struct {
		Version string `json:"version"`
		SHA256  string `json:"sha256"`
	} `json:"helpers"`
}

func platform() string {
	sys := runtime.GOOS
	if sys == "darwin" {
		sys = "macos"
	}
	return sys + "-" + runtime.GOARCH
}

// newer tells whether version a is above b ("1.0.10" > "1.0.9")
func newer(a, b string) bool {
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(x) || i < len(y); i++ {
		var p, q int
		if i < len(x) {
			p, _ = strconv.Atoi(x[i])
		}
		if i < len(y) {
			q, _ = strconv.Atoi(y[i])
		}
		if p != q {
			return p > q
		}
	}
	return false
}

func fetch(client *http.Client, url string, max int64) ([]byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err == nil && int64(len(b)) > max {
		err = fmt.Errorf("%s is too big", url)
	}
	return b, err
}

// selfUpdate puts the newest helper in place when updating by itself is on; quiet on any failure,
// the next start tries again
func selfUpdate() error {
	if !loadSettings().AutoUpdate {
		return nil
	}
	client := &http.Client{Timeout: 60 * time.Second}
	body, err := fetch(client, updateBase+"/update.json", 64<<10)
	if err != nil {
		return err
	}
	sig, err := fetch(client, updateBase+"/update.sig", 1<<10)
	if err != nil {
		return err
	}
	key, _ := base64.StdEncoding.DecodeString(updateKey)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || !ed25519.Verify(ed25519.PublicKey(key), body, raw) {
		return errors.New("update.json is not signed")
	}
	var r release
	if err := json.Unmarshal(body, &r); err != nil {
		return err
	}
	h := r.Helpers[platform()]
	want := h.SHA256
	if !newer(h.Version, version) || want == "" {
		return nil
	}
	bin, err := fetch(client, updateBase+"/aniroll-discord-"+platform(), 64<<20)
	if err != nil {
		return err
	}
	if sum := sha256.Sum256(bin); hex.EncodeToString(sum[:]) != want {
		return errors.New("the download is not the one it should be")
	}
	dir, err := homeDir()
	if err != nil {
		return err
	}
	// Swapped in whole: this helper keeps running from its old copy
	exe := filepath.Join(dir, exeName())
	tmp := exe + ".new"
	if err := os.WriteFile(tmp, bin, 0o755); err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}
