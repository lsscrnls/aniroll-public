//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func exeName() string { return "aniroll-discord.exe" }

func homeDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		var err error
		if base, err = os.UserConfigDir(); err != nil {
			return "", err
		}
	}
	return filepath.Join(base, "AniRoll Discord"), nil
}

// Each browser reads the manifest's path from its own registry key (per user, no admin rights needed)
var chromiumKeys = []string{
	`Software\Google\Chrome`,
	`Software\Chromium`,
	`Software\BraveSoftware\Brave-Browser`,
	`Software\Microsoft\Edge`,
	`Software\Vivaldi`,
}

var firefoxKeys = []string{
	`Software\Mozilla`,
	`Software\Zen`,
	`Software\LibreWolf`,
}

func reg(args ...string) error {
	cmd := exec.Command("reg", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func registerHosts(chromeManifest, firefoxManifest string) error {
	for _, k := range chromiumKeys {
		if err := reg("add", `HKCU\`+k+`\NativeMessagingHosts\`+hostName, "/ve", "/t", "REG_SZ", "/d", chromeManifest, "/f"); err != nil {
			return err
		}
	}
	for _, k := range firefoxKeys {
		if err := reg("add", `HKCU\`+k+`\NativeMessagingHosts\`+hostName, "/ve", "/t", "REG_SZ", "/d", firefoxManifest, "/f"); err != nil {
			return err
		}
	}
	return nil
}

func unregisterHosts() {
	for _, k := range append(append([]string{}, chromiumKeys...), firefoxKeys...) {
		reg("delete", `HKCU\`+k+`\NativeMessagingHosts\`+hostName, "/f")
	}
}
