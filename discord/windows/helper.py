"""AniRoll for Discord, Windows: the small helper between the browser extension (discord/extension) and Discord.

The same as the Go helper (discord/helper) on Linux and macOS, as a Python script: Windows' Smart App Control
blocks an unsigned program, but not the signed Python from python.org that runs this. install.ps1 puts both
in place and tells the browsers about aniroll-discord.bat, which starts this. Only the standard library.
Started by a browser (native messaging) it reads what AniRoll is doing and passes it to the Discord app.
"""
import json
import os
import queue
import struct
import sys
import threading
import time

VERSION = '1.1.0'
CLIENT_ID = '1558496660953501827'
# Discord takes five updates in twenty seconds; one every five keeps clear of that, and in between
# only the newest one counts
MIN_GAP = 5.0


# ===== What goes to Discord (as discord/helper/activity.go; the cases in discord/helper/testdata are shared) =====

class Unusable(Exception):
    pass


def _get(obj, key, kind):
    """A field of the given kind, its zero value when missing or null; any other kind makes the whole activity unusable"""
    v = obj.get(key)
    if v is None:
        return kind()
    if kind is int:
        if isinstance(v, bool) or not isinstance(v, int) or not -(1 << 63) <= v < (1 << 63):
            raise Unusable(key)
    elif kind is dict:
        if not isinstance(v, dict):
            raise Unusable(key)
    elif kind is list:
        if not isinstance(v, list):
            raise Unusable(key)
    elif not isinstance(v, kind):
        raise Unusable(key)
    return v


def _reject_constant(name):
    raise ValueError(name)


def sanitize(raw):
    """The activity (JSON text) rebuilt from the known fields, or None (no status) for anything unusable.
    The helper is the one part that runs with the user's rights, so it trusts no message blindly."""
    if not raw or raw == 'null' or len(raw.encode('utf-8')) > 8 << 10:
        return None
    try:
        a = json.loads(raw, parse_constant=_reject_constant)
        if not isinstance(a, dict):
            return None
        kind = _get(a, 'type', int)
        details, state = _get(a, 'details', str), _get(a, 'state', str)
        display = _get(a, 'status_display_type', int)
        ts = _get(a, 'timestamps', dict)
        start, end = _get(ts, 'start', int), _get(ts, 'end', int)
        assets = _get(a, 'assets', dict)
        pics = {k: _get(assets, k, str) for k in ('large_image', 'large_text', 'small_image', 'small_text')}
        buttons = []
        for b in _get(a, 'buttons', list):
            if b is None:
                b = {}
            if not isinstance(b, dict):
                return None
            buttons.append((_get(b, 'label', str), _get(b, 'url', str)))
    except (ValueError, Unusable):
        return None

    out = {'type': kind if kind in (0, 3) else 3}  # Playing or Watching
    if text(details):
        out['details'] = text(details)
    else:
        return None
    if text(state):
        out['state'] = text(state)
    if ts and start:
        # Milliseconds within a day of now, the end after the start
        now = int(time.time() * 1000)
        ok = lambda ms: now - 86_400_000 < ms < now + 86_400_000
        if ok(start) and (end == 0 or (ok(end) and end > start)):
            out['timestamps'] = {'start': start, **({'end': end} if end else {})}
    if assets:
        clean = {
            'large_image': image(pics['large_image']), 'large_text': text(pics['large_text']),
            'small_image': image(pics['small_image']), 'small_text': text(pics['small_text']),
        }
        clean = {k: v for k, v in clean.items() if v}
        if clean:
            out['assets'] = clean
    kept = []
    for label, url in buttons:
        if len(kept) == 2:
            break
        label = label.strip()[:32]
        if label and url.startswith('https://') and len(url.encode('utf-8')) <= 512:
            kept.append({'label': label, 'url': url})
    if kept:
        out['buttons'] = kept
    # What the member list shows after "Watching": 0 the app's name, 1 the state, 2 the details
    if display in (1, 2):
        out['status_display_type'] = display
    return json.dumps(out, ensure_ascii=False, separators=(',', ':'))


def text(s):
    """Discord takes 2 to 128 characters per line"""
    s = s.strip()[:128]
    if len(s) == 1:
        s += ' '
    return s


def image(s):
    """Pictures only from the web, never a file or data URL"""
    return s if s.startswith('https://') and len(s.encode('utf-8')) <= 256 else ''


# ===== Discord's local IPC: frames of opcode (uint32 LE), length (uint32 LE) and JSON =====
# 0 handshake, 1 frame, 2 close, 3 ping, 4 pong

def _dial():
    if os.name == 'nt':
        for i in range(10):
            try:
                return open(r'\\.\pipe\discord-ipc-%d' % i, 'r+b', buffering=0)
            except OSError:
                pass
    else:
        # Not used on Linux and macOS (the Go helper is), but handy to try this one there
        import socket
        base = os.environ.get('XDG_RUNTIME_DIR') or os.environ.get('TMPDIR') or '/tmp'
        for i in range(10):
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                s.connect(os.path.join(base, 'discord-ipc-%d' % i))
                return s.makefile('rwb', buffering=0)
            except OSError:
                s.close()
    raise OSError('discord is not running')


class Discord:
    def __init__(self, client_id):
        self.conn = _dial()
        self.nonce = 0
        try:
            self.write(0, {'v': 1, 'client_id': client_id})
            ready = self.read()  # READY, or an error (unknown app id, …)
        except Exception:
            self._shut()
            raise
        if ready.get('evt') != 'READY':
            self._shut()
            raise OSError('discord said %r: %s' % (ready.get('evt'), (ready.get('data') or {}).get('message')))

    def set_activity(self, activity):
        self.nonce += 1
        args = {'pid': os.getpid()}
        if activity is not None:
            args['activity'] = json.loads(activity)
        self.write(1, {'cmd': 'SET_ACTIVITY', 'args': args, 'nonce': str(self.nonce)})
        res = self.read()
        # A refused activity (a field too long, …) leaves the connection fine; it is just not shown
        if res.get('evt') == 'ERROR':
            print('discord refused the activity:', (res.get('data') or {}).get('message'), file=sys.stderr)

    def close(self):
        try:
            self.write(2, {})
        except OSError:
            pass
        self._shut()

    def _shut(self):
        try:
            self.conn.close()
        except OSError:
            pass

    def write(self, op, value):
        body = json.dumps(value, separators=(',', ':')).encode('utf-8')
        self.conn.write(struct.pack('<II', op, len(body)) + body)

    def read(self):
        """The next frame that is not a ping (answered). A Discord that hangs for ten seconds counts as gone:
        the read runs on its own thread, since a Windows pipe opened like this has no timeout."""
        result = {}

        def run():
            try:
                result['value'] = self._read()
            except Exception as e:  # noqa: BLE001 — handed over to the caller
                result['error'] = e

        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(10)
        if t.is_alive():
            threading.Thread(target=self._shut, daemon=True).start()
            raise OSError('discord does not answer')
        if 'error' in result:
            raise result['error']
        return result['value']

    def _read(self):
        while True:
            op, n = struct.unpack('<II', self._exactly(8))
            if n > 1 << 20:
                raise OSError('frame too large')
            body = self._exactly(n)
            if op == 2:
                raise OSError('discord closed the connection')
            if op == 3:
                self.write(4, json.loads(body))
                continue
            if op == 1:
                return json.loads(body)

    def _exactly(self, n):
        buf = b''
        while len(buf) < n:
            chunk = self.conn.read(n - len(buf))
            if not chunk:
                raise OSError('discord closed the connection')
            buf += chunk
        return buf


# ===== Native messaging: 4-byte length (little endian), then JSON =====

_out = threading.Lock()


def send(value):
    body = json.dumps(value, separators=(',', ':')).encode('utf-8')
    with _out:
        sys.stdout.buffer.write(struct.pack('<I', len(body)) + body)
        sys.stdout.buffer.flush()


def read_messages(inbox, stdin):
    """Puts each message from the browser into inbox, then None once the browser closes the connection"""
    try:
        while True:
            head = stdin.read(4)
            if len(head) < 4:
                return
            (n,) = struct.unpack('<I', head)
            if n > 1 << 20:
                return
            body = stdin.read(n)
            if len(body) < n:
                return
            try:
                m = json.loads(body)
            except ValueError:
                continue
            if isinstance(m, dict):
                inbox.put(m)
    finally:
        inbox.put(None)


def run_host(stdin=None, connect=Discord):
    """The newest activity goes to Discord, at most one update per MIN_GAP; Discord is tried again
    every few seconds while it is closed. Leaving closes the connection, which clears the status."""
    inbox = queue.Queue()
    threading.Thread(target=read_messages, args=(inbox, stdin or sys.stdin.buffer), daemon=True).start()
    dc = None
    want = None  # None: no status
    dirty = False
    last_sent = 0.0
    last_try = 0.0
    up = False

    def report():
        send({'type': 'status', 'discord': dc is not None, 'version': VERSION})

    while True:
        try:
            m = inbox.get(timeout=1)
        except queue.Empty:
            m = {}
        if m is None:
            if dc is not None:
                dc.close()
            return
        if m.get('type') == 'hello':
            report()
        elif m.get('type') == 'activity':
            a = m.get('activity')
            want = sanitize(None if a is None else json.dumps(a, ensure_ascii=False, separators=(',', ':')))
            dirty = True

        now = time.monotonic()
        if dc is None and now - last_try > 5:
            last_try = now
            try:
                dc = connect(CLIENT_ID)
                dirty = True
            except Exception:  # noqa: BLE001 — Discord not running (yet)
                dc = None
        if (dc is not None) != up:
            up = dc is not None
            report()
        if dc is not None and dirty and (last_sent == 0 or now - last_sent >= MIN_GAP):
            try:
                dc.set_activity(want)
            except Exception:  # noqa: BLE001 — gone: tried again in a few seconds
                dc.close()
                dc = None
                continue
            dirty = False
            last_sent = now


if __name__ == '__main__':
    # Chrome & co. pass the extension's origin (chrome-extension://…/), Firefox the path of the host manifest
    # and the extension id. Started any other way there is nothing to do: install.ps1 sets it up.
    if any(a.startswith('chrome-extension://') or a.endswith('.json') for a in sys.argv[1:]):
        run_host()
    else:
        print('AniRoll for Discord %s. Set it up with the line from AniRoll → Settings → Discord.' % VERSION)
