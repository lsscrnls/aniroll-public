package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
)

// The extension's ids: Chrome & co. know it by the key in its manifest, Firefox by its gecko id.
var chromeOrigins = []string{
	"chrome-extension://gjeghhdlclombagkmgbghopehhooefal/", // loaded by hand (the key in discord/extension/manifest.json)
	"chrome-extension://hmhmljkgppjpmmoodiboockbboniipcj/", // Chrome Web Store
}

const firefoxID = "discord@aniroll.app"

type hostManifest struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Path              string   `json:"path"`
	Type              string   `json:"type"`
	AllowedOrigins    []string `json:"allowed_origins,omitempty"`
	AllowedExtensions []string `json:"allowed_extensions,omitempty"`
}

// install copies this program to its own folder (the downloaded file can go), writes one host manifest
// for the Chromium family and one for the Firefox family there, and registers them (registerHosts:
// a folder per browser on Linux and macOS, the registry on Windows)
func install() error {
	dir, err := homeDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	exe := filepath.Join(dir, exeName())
	if err := copySelf(exe); err != nil {
		return err
	}
	chrome := filepath.Join(dir, "chrome.json")
	firefox := filepath.Join(dir, "firefox.json")
	base := hostManifest{Name: hostName, Description: "AniRoll for Discord", Path: exe, Type: "stdio"}
	c, f := base, base
	c.AllowedOrigins = chromeOrigins
	f.AllowedExtensions = []string{firefoxID}
	if err := writeJSON(chrome, c); err != nil {
		return err
	}
	if err := writeJSON(firefox, f); err != nil {
		return err
	}
	return registerHosts(chrome, firefox)
}

func uninstall() error {
	dir, err := homeDir()
	if err != nil {
		return err
	}
	unregisterHosts()
	return os.RemoveAll(dir)
}

func copySelf(to string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if same(self, to) {
		return nil
	}
	in, err := os.Open(self)
	if err != nil {
		return err
	}
	defer in.Close()
	// A new file next to the old one, then swapped in: a running helper keeps its old copy
	tmp := to + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	os.Remove(to)
	return os.Rename(tmp, to)
}

func same(a, b string) bool {
	x, err1 := os.Stat(a)
	y, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(x, y)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// copyInto writes the manifest as <dir>/app.aniroll.discord.json, creating dir
func copyInto(manifest, dir string) error {
	b, err := os.ReadFile(manifest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, hostName+".json"), b, 0o644)
}
