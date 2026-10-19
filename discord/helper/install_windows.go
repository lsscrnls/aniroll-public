//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func exeName() string { return "aniroll-discord.exe" }

// Windows will not delete a program that is running, and the browser keeps the helper running while
// AniRoll is open: stop it first (any copy but this one), then give Windows a moment to let go of the file
func removeDir(dir string) error {
	kill := exec.Command("taskkill", "/F", "/IM", exeName(), "/FI", "PID ne "+strconv.Itoa(os.Getpid()))
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	kill.Run()
	var err error
	for i := 0; i < 20; i++ {
		if err = os.RemoveAll(dir); err == nil {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	if inside(dir) {
		// Run from inside the folder itself: a hidden cmd removes it once this has ended
		// (the line as cmd reads it: Go's own quoting of arguments is not cmd's)
		cmd := exec.Command("cmd")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CmdLine: `cmd /S /C "ping -n 3 127.0.0.1 >NUL & rmdir /S /Q "` + dir + `""`}
		return cmd.Start()
	}
	return err
}

// Whether this program itself runs from dir
func inside(dir string) bool {
	self, err := os.Executable()
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(dir, self)
	return err == nil && !strings.HasPrefix(rel, "..")
}

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
	`Software\BraveSoftware\Brave-Origin`,
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
