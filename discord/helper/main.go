// AniRoll for Discord: the small helper between the browser extension (discord/extension) and Discord.
//
// Started by hand (double-click, or the install line from Settings → Discord) it sets itself up: it copies
// itself to a fixed place and tells the browsers where to find it. Started by a browser (native messaging)
// it reads what AniRoll is doing and passes it to the Discord app on this computer.
//
//	aniroll-discord             set up (again)
//	aniroll-discord uninstall   remove everything it set up
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	version  = "1.0.0"
	hostName = "app.aniroll.discord"
	clientID = "1558496660953501827"
	// Discord takes about five updates in twenty seconds; in between, only the newest one counts
	minGap = 4 * time.Second
)

func main() {
	if startedByBrowser(os.Args[1:]) {
		runHost()
		return
	}
	var err error
	if len(os.Args) > 1 && os.Args[1] == "uninstall" {
		err = uninstall()
		if err == nil {
			fmt.Println("AniRoll for Discord is removed.")
		}
	} else {
		err = install()
		if err == nil {
			fmt.Println("AniRoll for Discord is set up. Reload AniRoll in your browser; Settings → Discord shows it as ready.")
		}
	}
	if err != nil {
		fmt.Println("Something went wrong:", err)
	}
	waitForEnter()
	if err != nil {
		os.Exit(1)
	}
}

// Chrome & co. pass the extension's origin (chrome-extension://…/), Firefox the path of the host manifest
// and the extension id
func startedByBrowser(args []string) bool {
	for _, a := range args {
		if strings.HasPrefix(a, "chrome-extension://") || strings.HasSuffix(a, ".json") {
			return true
		}
	}
	return false
}

// A double-clicked window (Windows) would close before anyone could read it; a terminal stays
func waitForEnter() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Print("Press Enter to close.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

// ===== Native messaging: 4-byte length (native byte order, little endian everywhere we run), then JSON =====

type message struct {
	Type     string          `json:"type"`
	Activity json.RawMessage `json:"activity,omitempty"`
}

var outMu sync.Mutex

func send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	outMu.Lock()
	defer outMu.Unlock()
	binary.Write(os.Stdout, binary.LittleEndian, uint32(len(b)))
	os.Stdout.Write(b)
}

func readMessages(out chan<- message) {
	defer close(out)
	for {
		var n uint32
		if err := binary.Read(os.Stdin, binary.LittleEndian, &n); err != nil {
			return // the browser closed the connection: time to go
		}
		if n > 1<<20 {
			return
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(os.Stdin, buf); err != nil {
			return
		}
		var m message
		if json.Unmarshal(buf, &m) == nil {
			out <- m
		}
	}
}

// The newest activity goes to Discord, at most one update per minGap; Discord is tried again
// every few seconds while it is closed. Leaving closes the connection, which clears the status.
func runHost() {
	msgs := make(chan message)
	go readMessages(msgs)

	var (
		dc       *discord
		want     json.RawMessage // null: no status
		dirty    bool
		lastSent time.Time
		up       = false
	)
	report := func() { send(map[string]any{"type": "status", "discord": dc != nil, "version": version}) }
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	lastTry := time.Time{}

	for {
		select {
		case m, ok := <-msgs:
			if !ok {
				if dc != nil {
					dc.close()
				}
				return
			}
			switch m.Type {
			case "hello":
				report()
			case "activity":
				want = m.Activity
				if len(want) == 0 || string(want) == "null" {
					want = nil
				}
				dirty = true
			}
		case <-tick.C:
		}

		if dc == nil && time.Since(lastTry) > 5*time.Second {
			lastTry = time.Now()
			if c, err := connectDiscord(clientID); err == nil {
				dc = c
				dirty = true
			}
		}
		if (dc != nil) != up {
			up = dc != nil
			report()
		}
		if dc != nil && dirty && time.Since(lastSent) >= minGap {
			if err := dc.setActivity(want); err != nil {
				dc.close()
				dc = nil
				continue
			}
			dirty = false
			lastSent = time.Now()
		}
	}
}
