# Builds media/sounds/{success,error,land}.mp3 from real marimba recordings.
#   python3 -I tools/sound/make.py            (needs ffmpeg with libmp3lame, numpy, curl; ~45 MB download)
# Source: University of Iowa Musical Instrument Samples, marimba with yarn mallets, mf
# (https://theremin.music.uiowa.edu/Mismarimba.html), "may be used for any projects, without restrictions".
# Synthesized tones were tried first (2026-11-04) and sounded cheap; vibraphone, glockenspiel and crotales
# from the same collection lost to the marimba by ear.
import subprocess, sys, tempfile, numpy as np
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'media' / 'sounds'
BASE = 'https://theremin.music.uiowa.edu/sound%20files/MIS/Percussion/Marimba/'
FILES = {'Marimba.yarn.mf.C4B4.aif': {62, 66, 69}, 'Marimba.yarn.mf.C5B5.aif': {74}}   # D4 F#4 A4 | D5
SR = 48000
LENGTH, WET = 1.0, 0.25                  # seconds of each note, share of the generated room

# D major pentatonic: success goes up a fourth and settles, error steps down a third, the roll lands on an arpeggio.
# (midi, start s, velocity)
TONES = {
    'success': [(69, 0, 0.8), (74, 0.08, 1)],
    'error': [(66, 0, 0.9), (62, 0.12, 0.8)],
    'land': [(62, 0, 0.6), (66, 0.07, 0.7), (69, 0.14, 0.8), (74, 0.23, 1)],
}

def load(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()

def onsets(x, count):
    # The files hold gaps with rattles, so "louder than before" finds too many. Take the strongest attacks
    # (5 ms envelope against the 100 ms before it), at least 1.5 s apart, and walk back to where each starts.
    m = x.mean(1); n = len(m) // 240
    e = np.sqrt((m[:n * 240].reshape(n, 240) ** 2).mean(1) + 1e-12)
    base = np.convolve(e, np.ones(20) / 20, 'full')[:len(e)]
    base = np.concatenate([np.full(4, base[0]), base[:-4]])
    picked = []
    for i in np.argsort(e * np.minimum(e / (base + 1e-9), 50))[::-1]:
        if all(abs(i - j) > 300 for j in picked): picked.append(i)
        if len(picked) == count: break
    out = []
    for i in sorted(picked):
        k = i
        while k > 0 and e[k - 1] > e[i] * 0.1 and i - k < 20: k -= 1
        out.append(k * 240)
    return out

def pitch(seg):
    # The lowest partial at least a fifth as strong as the strongest one; the strongest is often an overtone
    a = seg[int(0.03 * SR):int(0.33 * SR)].mean(1); a = a * np.hanning(len(a))
    f = np.abs(np.fft.rfft(a, 1 << 17)); fr = np.fft.rfftfreq(1 << 17, 1 / SR)
    band = (fr > 150) & (fr < 9000); fb, ff = fr[band], f[band]
    peaks = [i for i in range(1, len(ff) - 1) if ff[i] >= ff[i - 1] and ff[i] >= ff[i + 1] and ff[i] > ff.max() * 0.2]
    return 69 + 12 * np.log2(fb[peaks[0]] / 440)

def find(path, wanted):
    # The order in the file can't be trusted (a rattle counts, a note is missed, everything after shifts by one),
    # so measure every attack and keep, per wanted note, the loudest one that measures as that note.
    x = load(path); best = {}
    for s0 in onsets(x, 40):
        seg = x[max(0, s0 - int(0.004 * SR)):s0 + int(3 * SR)]
        if len(seg) < int(0.4 * SR): continue
        got = pitch(seg); midi = round(got); level = np.abs(seg[:int(0.2 * SR)]).max()
        if midi in wanted and abs(got - midi) < 0.4 and level > best.get(midi, (0,))[0]: best[midi] = (level, seg, got)
    missing = wanted - best.keys()
    if missing: sys.exit(f'{path.name}: notes {sorted(missing)} not found')
    for m in sorted(wanted): print(f'  midi {m}: measured {best[m][2]:.2f}')
    return {m: v[1] for m, v in best.items()}

def room(seconds=1.3):
    # Recorded in an anechoic chamber, so very dry: a small warm room (noise whose highs fade, 12 ms pre-delay)
    rng = np.random.default_rng(7); n = int(SR * seconds); t = np.arange(n) / n
    ir = np.zeros((n, 2))
    for ch in range(2):
        w = rng.standard_normal(n); y = 0.0; k = 0.55 - 0.45 * t
        for i in range(n): y += k[i] * (w[i] - y); ir[i, ch] = y
        ir[:, ch] *= (1 - t) ** 3.5
    ir = np.vstack([np.zeros((int(0.012 * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(0))

def convolve(x, ir):
    n = len(x) + len(ir) - 1; N = 1 << int(np.ceil(np.log2(n)))
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c], N) * np.fft.rfft(ir[:, c], N), N)[:n] for c in range(2)], 1)

def build(notes, seq, ir):
    out = np.zeros((int(SR * (LENGTH + 0.4)), 2))
    for midi, at, vel in seq:
        s = notes[midi][:int(SR * LENGTH)].astype(np.float64)
        fade = int(len(s) * 0.45); s[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
        i = int(at * SR); out[i:i + len(s)] += s * vel
    y = out + WET * convolve(out, ir)[:len(out)]
    # every tone equally loud (RMS of the sounding part at -24 dBFS), peaks kept under -3 dBFS
    e = np.sqrt((y ** 2).mean(1)); act = y[e > e.max() * 0.01]
    y *= 10 ** (-24 / 20) / np.sqrt((act ** 2).mean())
    y *= min(1, 10 ** (-3 / 20) / np.abs(y).max())
    y = y[:np.nonzero(np.abs(y).max(1) > 1e-3)[0][-1] + 1]
    f = int(0.03 * SR); y[-f:] *= np.linspace(1, 0, f)[:, None]
    return y.astype(np.float32)

with tempfile.TemporaryDirectory() as tmp:
    notes = {}
    for name, wanted in FILES.items():
        p = Path(tmp) / name
        subprocess.run(['curl', '-sfL', '-o', str(p), BASE + name], check=True)
        notes.update(find(p, wanted))
OUT.mkdir(parents=True, exist_ok=True)
ir = room()
for name, seq in TONES.items():
    y = build(notes, seq, ir)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', '160k', str(OUT / f'{name}.mp3')], input=y.tobytes(), check=True)
    print(f'{name}.mp3: peak {20 * np.log10(np.abs(y).max()):.1f} dBFS, {len(y) / SR:.2f} s')
