"""Tests for the Windows helper, run anywhere: python3 discord/windows/test_helper.py
The activity cases are shared with the Go helper (discord/helper/testdata/sanitize.json); the rest talks to
the helper as a browser would, with a stand-in for Discord on a Unix socket."""
import json
import os
import re
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import helper  # noqa: E402


class Sanitize(unittest.TestCase):
    def test_shared_cases(self):
        with open(os.path.join(HERE, '..', 'helper', 'testdata', 'sanitize.json'), encoding='utf-8') as f:
            raw = f.read()
        now = int(time.time() * 1000)
        raw = re.sub(r'"@now([+-]\d+)?"', lambda m: str(now + int(m.group(1) or 0)), raw)
        for c in json.loads(raw)['cases']:
            with self.subTest(c['name']):
                out = helper.sanitize(json.dumps(c['in'], ensure_ascii=False))
                self.assertEqual(json.loads(out) if out else None, c['out'])


class FakeDiscord:
    """Answers the handshake with READY and each SET_ACTIVITY, and keeps what it was sent"""

    def __init__(self, folder):
        self.got = []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(os.path.join(folder, 'discord-ipc-0'))
        self.server.listen(1)
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        conn, _ = self.server.accept()
        f = conn.makefile('rwb', buffering=0)
        self.conn = conn
        while True:
            head = f.read(8)
            if len(head) < 8:
                return
            op, n = struct.unpack('<II', head)
            msg = json.loads(f.read(n))
            self.got.append((op, msg))
            if op == 4:  # the answer to the ping
                continue
            if op == 0:
                reply = {'evt': 'READY', 'data': {}}
            elif op == 1:
                reply = {'evt': None, 'cmd': msg['cmd'], 'nonce': msg['nonce']}
            else:
                return
            # A ping first: the helper has to answer it and still find the reply
            body = json.dumps({}).encode()
            f.write(struct.pack('<II', 3, len(body)) + body)
            body = json.dumps(reply).encode()
            f.write(struct.pack('<II', 1, len(body)) + body)


def frame(msg):
    body = json.dumps(msg).encode()
    return struct.pack('<I', len(body)) + body


def read_frame(stream):
    (n,) = struct.unpack('<I', stream.read(4))
    return json.loads(stream.read(n))


@unittest.skipIf(os.name == 'nt', 'the stand-in for Discord uses a Unix socket')
class Host(unittest.TestCase):
    def test_browser_to_discord(self):
        with tempfile.TemporaryDirectory() as folder:
            discord = FakeDiscord(folder)
            p = subprocess.Popen([sys.executable, '-I', '-u', os.path.join(HERE, 'helper.py'), 'chrome-extension://x/'],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, env={**os.environ, 'XDG_RUNTIME_DIR': folder})
            try:
                p.stdin.write(frame({'type': 'hello'}))
                p.stdin.flush()
                first = read_frame(p.stdout)
                self.assertEqual(first['type'], 'status')
                self.assertEqual(first['version'], helper.VERSION)
                # Discord is found on the first round, after the answer to hello
                if not first['discord']:
                    self.assertTrue(read_frame(p.stdout)['discord'])
                p.stdin.write(frame({'type': 'activity', 'activity': {'type': 3, 'details': 'Frieren', 'evil': 1}}))
                p.stdin.flush()
                deadline = time.time() + 8
                while time.time() < deadline and not any(op == 1 and m['args'].get('activity') for op, m in discord.got):
                    time.sleep(0.1)
                sent = [m for op, m in discord.got if op == 1 and m['args'].get('activity')]
                self.assertTrue(sent, discord.got)
                self.assertEqual(sent[-1]['args']['activity'], {'type': 3, 'details': 'Frieren'})
                self.assertEqual(discord.got[0], (0, {'v': 1, 'client_id': helper.CLIENT_ID}))
                p.stdin.close()  # the browser leaves: the helper closes Discord and ends
                self.assertEqual(p.wait(5), 0)
                time.sleep(0.2)
                self.assertEqual(discord.got[-1][0], 2)
            finally:
                if p.poll() is None:
                    p.kill()

    def test_not_from_a_browser(self):
        out = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'helper.py')], capture_output=True, text=True, timeout=5)
        self.assertIn('Settings', out.stdout)


if __name__ == '__main__':
    unittest.main()
