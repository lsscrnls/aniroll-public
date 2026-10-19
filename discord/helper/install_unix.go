//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func exeName() string { return "aniroll-discord" }

func removeDir(dir string) error { return os.RemoveAll(dir) }

func homeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "AniRoll Discord"), nil
	}
	if d := os.Getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, "aniroll-discord"), nil
	}
	return filepath.Join(home, ".local", "share", "aniroll-discord"), nil
}

// Where each browser looks for host manifests. A Chromium browser only gets one when it is installed
// (its profile folder exists); the Firefox folders are always written, Zen and LibreWolf when present.
func hostDirs() (chromium, firefox []string) {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		support := filepath.Join(home, "Library", "Application Support")
		for _, b := range []string{"Google/Chrome", "Google/Chrome Beta", "Chromium", "Microsoft Edge", "Vivaldi", "Arc/User Data"} {
			if exists(filepath.Join(support, b)) {
				chromium = append(chromium, filepath.Join(support, b, "NativeMessagingHosts"))
			}
		}
		chromium = append(chromium, braveDirs(filepath.Join(support, "BraveSoftware"))...)
		firefox = []string{filepath.Join(support, "Mozilla", "NativeMessagingHosts")}
		if exists(filepath.Join(support, "zen")) {
			firefox = append(firefox, filepath.Join(support, "zen", "NativeMessagingHosts"))
		}
		return
	}
	config := os.Getenv("XDG_CONFIG_HOME")
	if config == "" {
		config = filepath.Join(home, ".config")
	}
	for _, b := range []string{"google-chrome", "google-chrome-beta", "google-chrome-unstable", "google-chrome-for-testing", "chromium", "microsoft-edge", "vivaldi", "opera", "thorium"} {
		if exists(filepath.Join(config, b)) {
			chromium = append(chromium, filepath.Join(config, b, "NativeMessagingHosts"))
		}
	}
	chromium = append(chromium, braveDirs(filepath.Join(config, "BraveSoftware"))...)
	firefox = []string{filepath.Join(home, ".mozilla", "native-messaging-hosts")}
	for _, b := range []string{".zen", ".librewolf", ".floorp", ".waterfox"} {
		if exists(filepath.Join(home, b)) {
			firefox = append(firefox, filepath.Join(home, b, "native-messaging-hosts"))
		}
	}
	// Newer Firefox and its forks keep everything under ~/.config instead
	for _, b := range []string{"mozilla", "zen", "librewolf", "floorp", "waterfox"} {
		if exists(filepath.Join(config, b)) {
			firefox = append(firefox, filepath.Join(config, b, "native-messaging-hosts"))
		}
	}
	return
}

func registerHosts(chromeManifest, firefoxManifest string) error {
	chromium, firefox := hostDirs()
	for _, d := range chromium {
		if err := copyInto(chromeManifest, d); err != nil {
			return err
		}
	}
	for _, d := range firefox {
		if err := copyInto(firefoxManifest, d); err != nil {
			return err
		}
	}
	return nil
}

func unregisterHosts() {
	chromium, firefox := hostDirs()
	for _, d := range append(chromium, firefox...) {
		os.Remove(filepath.Join(d, hostName+".json"))
	}
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// Every Brave there is (Brave-Browser, -Beta, -Nightly, Brave-Origin, …): each keeps its own folder
func braveDirs(base string) (dirs []string) {
	entries, _ := os.ReadDir(base)
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "Brave-") {
			dirs = append(dirs, filepath.Join(base, e.Name(), "NativeMessagingHosts"))
		}
	}
	return
}
