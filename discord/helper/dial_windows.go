//go:build windows

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
)

func dialDiscord() (io.ReadWriteCloser, error) {
	for i := 0; i < 10; i++ {
		if f, err := os.OpenFile(fmt.Sprintf(`\\.\pipe\discord-ipc-%d`, i), os.O_RDWR, 0); err == nil {
			return f, nil
		}
	}
	return nil, errors.New("discord is not running")
}
