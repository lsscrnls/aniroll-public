// SPDX-License-Identifier: GPL-3.0-or-later (a port of SongRec, which is GPL-3.0+; the rest of AniRoll is not)
// A song's fingerprint the way Shazam's apps make it, from a few seconds of sound: ported from SongRec
// (github.com/marin-m/SongRec, src/core/fingerprinting/algorithm.rs and signature_format.rs, GPL-3.0).
// Only this signature leaves the browser, never the sound itself: peaks of a spectrogram, a few KB.
// Input: mono samples at 16 kHz in [-1, 1]. Output: { uri, samplems } as Shazam's tag request wants them.

export const SIG_RATE = 16000;
export const SIG_SECONDS = 12;

const N = 2048;
const BINS = 1025;
// SongRec's Hanning multipliers: numpy's hanning(2050) without its zero ends
const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / 2049));
const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / N));
const SIN = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / N));
const REV = Uint16Array.from({ length: N }, (_, i) => {
    let r = 0;
    for (let b = 0, x = i; b < 11; b++, x >>= 1) r = (r << 1) | (x & 1);
    return r;
});

// |X[k]|² for k = 0..1024 of a real 2048-point frame (iterative radix-2)
function powerSpectrum(frame, out) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[REV[i]] = frame[i];
    for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1;
        const step = N / size;
        for (let start = 0; start < N; start += size) {
            for (let k = 0; k < half; k++) {
                const a = start + k;
                const b = a + half;
                const wr = COS[k * step];
                const wi = SIN[k * step];
                const tr = re[b] * wr - im[b] * wi;
                const ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
            }
        }
    }
    for (let k = 0; k < BINS; k++) out[k] = Math.max(Math.fround((re[k] * re[k] + im[k] * im[k]) / (1 << 17)), 1e-10);
}

const NEIGHBOURS = [-10, -7, -4, -3, 1, 2, 5, 8];
const OTHER_FFTS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
const magnitude = (v) => Math.max(Math.log(v), 1 / 64) * 1477.3 + 6144;

// The peaks per frequency band: [[{ pass, magnitude, bin }], ×4]
function peaks(samples) {
    const ring = new Int16Array(N);
    let ringAt = 0;
    const frame = new Float32Array(N);
    const ffts = Array.from({ length: 256 }, () => new Float32Array(BINS));
    const spread = Array.from({ length: 256 }, () => new Float32Array(BINS));
    let fftAt = 0;
    let spreadAt = 0;
    let done = 0;
    const bands = [[], [], [], []];
    const s16 = Int16Array.from(samples, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32768))));

    for (let c = 0; c + 128 <= s16.length; c += 128) {
        // The newest 128 samples into the ring, which is read oldest first through the window
        ring.set(s16.subarray(c, c + 128), ringAt);
        ringAt = (ringAt + 128) & (N - 1);
        for (let i = 0; i < N; i++) frame[i] = ring[(i + ringAt) & (N - 1)] * HANN[i];
        powerSpectrum(frame, ffts[fftAt]);
        const fresh = ffts[fftAt];
        fftAt = (fftAt + 1) & 255;

        // Peaks spread over neighbouring bins, then over the frames before
        const sp = spread[spreadAt];
        sp.set(fresh);
        for (let p = 0; p <= 1022; p++) sp[p] = Math.max(sp[p], sp[p + 1], sp[p + 2]);
        for (const back of [1, 3, 6]) {
            const former = spread[(spreadAt - back) & 255];
            for (let p = 0; p < BINS; p++) if (sp[p] > former[p]) former[p] = sp[p];
        }
        spreadAt = (spreadAt + 1) & 255;
        done++;
        if (done < 46) continue;

        const f46 = ffts[(fftAt - 46) & 255];
        const s49 = spread[(spreadAt - 49) & 255];
        for (let bin = 10; bin <= 1014; bin++) {
            const v = f46[bin];
            if (v < 1 / 64 || v < s49[bin - 1]) continue;
            let most = 0;
            for (const o of NEIGHBOURS) most = Math.max(most, s49[bin + o]);
            if (v <= most) continue;
            for (const o of OTHER_FFTS) most = Math.max(most, spread[(spreadAt + o) & 255][bin - 1]);
            if (v <= most) continue;

            const m = Math.fround(magnitude(v));
            const before = Math.fround(magnitude(f46[bin - 1]));
            const after = Math.fround(magnitude(f46[bin + 1]));
            const var1 = m * 2 - before - after;
            const var2 = ((after - before) * 32) / var1;
            const corrected = (bin * 64 + Math.trunc(var2)) & 0xffff;
            const hz = Math.trunc(corrected * (16000 / 2 / 1024 / 64));
            const band = hz >= 250 && hz < 520 ? 0 : hz >= 520 && hz < 1450 ? 1 : hz >= 1450 && hz < 3500 ? 2 : hz >= 3500 && hz <= 5500 ? 3 : -1;
            if (band < 0) continue;
            bands[band].push({ pass: done - 46, magnitude: Math.trunc(m) & 0xffff, bin: corrected });
        }
    }
    return bands;
}

let crcTable = null;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

// Shazam's binary signature: a 48-byte header, then a block of peaks per band
function encode(bands, numberSamples) {
    const parts = [];
    for (let band = 0; band < 4; band++) {
        if (!bands[band].length) continue;
        const bytes = [];
        const u32 = (v) => bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
        const u16 = (v) => bytes.push(v & 0xff, (v >>> 8) & 0xff);
        let pass = 0;
        for (const p of bands[band]) {
            if (p.pass - pass >= 255) { bytes.push(0xff); u32(p.pass); pass = p.pass; }
            bytes.push(p.pass - pass);
            u16(p.magnitude);
            u16(p.bin);
            pass = p.pass;
        }
        parts.push({ band, bytes });
    }
    const size = 56 + parts.reduce((n, p) => n + 8 + p.bytes.length + ((4 - (p.bytes.length % 4)) % 4), 0);
    const buf = new Uint8Array(size);
    const view = new DataView(buf.buffer);
    let at = 0;
    const w = (v) => { view.setUint32(at, v >>> 0, true); at += 4; };
    w(0xcafe2580); w(0); w(size - 48); w(0x94119c00); w(0); w(0); w(0);
    w(3 << 27); // 16000 Hz
    w(0); w(0);
    w(numberSamples + Math.trunc(SIG_RATE * 0.24));
    w((15 << 19) + 0x40000);
    w(0x40000000); w(size - 48);
    for (const p of parts) {
        w(0x60030040 + p.band);
        w(p.bytes.length);
        buf.set(p.bytes, at);
        at += p.bytes.length + ((4 - (p.bytes.length % 4)) % 4);
    }
    view.setUint32(4, crc32(buf.subarray(8)), true);
    return buf;
}

function base64(bytes) {
    if (typeof btoa === 'function') {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    return Buffer.from(bytes).toString('base64');
}

// samples: Float32Array, mono, 16 kHz. Shorter than 12 s is padded with silence, as SongRec does
export function makeSignature(samples) {
    let input = samples;
    if (input.length < SIG_SECONDS * SIG_RATE) {
        input = new Float32Array(SIG_SECONDS * SIG_RATE);
        input.set(samples);
    }
    const bands = peaks(input);
    return {
        uri: 'data:audio/vnd.shazam.sig;base64,' + base64(encode(bands, input.length)),
        samplems: Math.trunc((input.length / SIG_RATE) * 1000),
        peaks: bands.reduce((n, b) => n + b.length, 0),
    };
}
