//go:build !windows

package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
)

// discord-ipc-0…9 in the runtime or temp folder; Flatpak and Snap builds of Discord, and Vesktop,
// keep theirs one folder further down
func dialDiscord() (io.ReadWriteCloser, error) {
	var bases []string
	for _, env := range []string{"XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"} {
		if v := os.Getenv(env); v != "" {
			bases = append(bases, v)
		}
	}
	bases = append(bases, "/tmp")
	subs := []string{"", "app/com.discordapp.Discord", "app/com.discordapp.DiscordCanary", "snap.discord", ".flatpak/dev.vencord.Vesktop/xdg-run"}
	for _, base := range bases {
		for _, sub := range subs {
			for i := 0; i < 10; i++ {
				path := filepath.Join(base, sub, fmt.Sprintf("discord-ipc-%d", i))
				if conn, err := net.Dial("unix", path); err == nil {
					return conn, nil
				}
			}
		}
	}
	return nil, errors.New("discord is not running")
}
