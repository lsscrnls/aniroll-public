# Writes sub.sup: a tiny PGS subtitle for the player checks — a white bar with a dark border,
# shown from 0.5 s to 15 s on a 1920x1080 picture. Run: python3 tools/e2e/media/make-sup.py
import os, struct

def seg(kind, pts, body):
    t = int(pts * 90000)
    return b'PG' + struct.pack('>IIBH', t, t, kind, len(body)) + body

def rle(w, h, pixel):
    out = bytearray()
    for y in range(h):
        x = 0
        while x < w:
            c = pixel(x, y)
            n = 1
            while x + n < w and pixel(x + n, y) == c and n < 16383:
                n += 1
            if c == 0:
                out += bytes([0, n]) if n < 64 else bytes([0, 0x40 | n >> 8, n & 0xff])
            elif n < 3:
                out += bytes([c]) * n
            else:
                out += bytes([0, 0x80 | n, c]) if n < 64 else bytes([0, 0xC0 | n >> 8, n & 0xff, c])
            x += n
        out += b'\0\0'
    return bytes(out)

W, H, X, Y = 600, 60, 660, 960
data = rle(W, H, lambda x, y: 2 if x < 4 or y < 4 or x >= W - 4 or y >= H - 4 else 1)
pcs = lambda state, objs: struct.pack('>HHBHBBBB', 1920, 1080, 0x10, state[0], state[1], 0, 0, len(objs)) \
    + b''.join(struct.pack('>HBBHH', 0, 0, 0, X, Y) for _ in objs)
wds = struct.pack('>BBHHHH', 1, 0, X, Y, W, H)
pds = struct.pack('>BB', 0, 0) + struct.pack('>5B', 1, 235, 128, 128, 255) + struct.pack('>5B', 2, 16, 128, 128, 255)
ods = struct.pack('>HBB', 0, 0, 0xC0) + (len(data) + 4).to_bytes(3, 'big') + struct.pack('>HH', W, H) + data

sup = (seg(0x16, 0.5, pcs((0, 0x80), [0])) + seg(0x17, 0.5, wds) + seg(0x14, 0.5, pds) + seg(0x15, 0.5, ods) + seg(0x80, 0.5, b'')
       + seg(0x16, 15, pcs((1, 0x00), [])) + seg(0x17, 15, wds) + seg(0x80, 15, b''))
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sub.sup'), 'wb').write(sup)
print(len(sup), 'bytes')
