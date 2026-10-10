package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"
)

// Discord's local IPC: frames of opcode (uint32 LE), length (uint32 LE) and JSON.
// 0 handshake, 1 frame, 2 close, 3 ping, 4 pong.
type discord struct {
	conn  io.ReadWriteCloser
	nonce int
}

func connectDiscord(id string) (*discord, error) {
	conn, err := dialDiscord()
	if err != nil {
		return nil, err
	}
	d := &discord{conn: conn}
	if err := d.write(0, map[string]any{"v": 1, "client_id": id}); err != nil {
		conn.Close()
		return nil, err
	}
	// READY, or an error (unknown app id, …)
	var ready struct {
		Evt  string `json:"evt"`
		Data struct {
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := d.read(&ready); err != nil {
		conn.Close()
		return nil, err
	}
	if ready.Evt != "READY" {
		conn.Close()
		return nil, fmt.Errorf("discord said %q: %s", ready.Evt, ready.Data.Message)
	}
	return d, nil
}

func (d *discord) setActivity(activity json.RawMessage) error {
	d.nonce++
	args := map[string]any{"pid": os.Getpid()}
	if activity != nil {
		args["activity"] = activity
	}
	if err := d.write(1, map[string]any{"cmd": "SET_ACTIVITY", "args": args, "nonce": fmt.Sprint(d.nonce)}); err != nil {
		return err
	}
	var res struct {
		Evt  string `json:"evt"`
		Data struct {
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := d.read(&res); err != nil {
		return err
	}
	// A refused activity (a field too long, …) leaves the connection fine; it is just not shown
	if res.Evt == "ERROR" {
		fmt.Fprintln(os.Stderr, "discord refused the activity:", res.Data.Message)
	}
	return nil
}

func (d *discord) close() {
	d.write(2, map[string]any{})
	d.conn.Close()
}

func (d *discord) write(op uint32, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	frame := make([]byte, 8+len(b))
	binary.LittleEndian.PutUint32(frame[0:], op)
	binary.LittleEndian.PutUint32(frame[4:], uint32(len(b)))
	copy(frame[8:], b)
	_, err = d.conn.Write(frame)
	return err
}

// The next frame that is not a ping (answered) — a reply never takes longer than a few seconds
func (d *discord) read(v any) error {
	if dl, ok := d.conn.(interface{ SetReadDeadline(time.Time) error }); ok {
		dl.SetReadDeadline(time.Now().Add(10 * time.Second))
	}
	for {
		var head [8]byte
		if _, err := io.ReadFull(d.conn, head[:]); err != nil {
			return err
		}
		op := binary.LittleEndian.Uint32(head[0:])
		n := binary.LittleEndian.Uint32(head[4:])
		if n > 1<<20 {
			return errors.New("frame too large")
		}
		body := make([]byte, n)
		if _, err := io.ReadFull(d.conn, body); err != nil {
			return err
		}
		switch op {
		case 2:
			return errors.New("discord closed the connection")
		case 3:
			d.write(4, json.RawMessage(body))
			continue
		case 1:
			return json.Unmarshal(body, v)
		}
	}
}
