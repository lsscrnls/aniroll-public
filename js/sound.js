// UI sounds (2.0): three marimba tones, real recordings (University of Iowa Musical Instrument Samples,
// free to use without restrictions), cut and voiced by tools/sound/make.py. On by default, off in
// Settings → Appearance. Synthesized tones were tried first and sounded cheap; recordings carry the quality.
// Silent while any video plays, while the tab is hidden, before the first click (browsers keep audio locked
// until then) and for toasts that don't answer a recent click or key (a background save failing).

// A look can bring a set of its own (setSoundSet): a folder under media/sounds/ and which file each name plays. A name
// the set leaves out stays silent, so callers may ask for sounds only some sets have ('step', 'tick').

const KEY = 'aniroll_sounds';
const MARIMBA = { dir: '', files: { success: 'success', error: 'error', land: 'land' } };
const VOLUME = 0.5;
const ANSWER_MS = 5000;

let ctx = null, out = null, loading = false, lastGesture = 0, pending = null, set = MARIMBA, generation = 0;
let buffers = {};

/** @param {string | null} dir @param {Record<string, string>} [files] name → file (without .mp3) */
export function setSoundSet(dir, files) {
    const next = dir && files ? { dir: `${dir}/`, files } : MARIMBA;
    if (next.dir === set.dir) return;
    set = next; buffers = {}; loading = false; pending = null; generation++;
    if (soundsOn()) load();
}

export const soundsOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setSounds(on) {
    try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, 'off'); } catch {}
    if (!on) return;
    load();
    if (buffers.success) play('success'); else pending = 'success';   // let the switch be heard once
}

// Fetched on the first click, not at start: ~80 KB nobody needs before then, and none at all with sounds off
function load() {
    if (loading || !ctx) return;
    loading = true;
    const { dir, files } = set, gen = generation, names = Object.keys(files);
    for (const file of new Set(Object.values(files))) {
        fetch(`media/sounds/${dir}${file}.mp3`)
            .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
            .then(b => ctx.decodeAudioData(b))
            .then(buf => {
                if (gen !== generation) return;               // the set changed while this loaded
                for (const name of names) if (files[name] === file) buffers[name] = buf;
                if (pending && files[pending] === file) { const p = pending; pending = null; play(p); }
            })
            .catch(() => {});                                 // no sound is fine, a broken page is not
    }
}

const unlock = () => {
    lastGesture = performance.now();
    try {
        if (!ctx) {
            ctx = new AudioContext();
            out = ctx.createGain();
            out.gain.value = VOLUME;
            out.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        if (soundsOn()) load();
    } catch {}
};
// globalThis?.: the unit tests load store.js (and so this) in Node, where there is no window
globalThis.addEventListener?.('pointerdown', unlock, { capture: true, passive: true });
globalThis.addEventListener?.('keydown', unlock, { capture: true, passive: true });

const videoPlaying = () => [...document.querySelectorAll('video')].some(v => !v.paused && !v.ended);

// late: the tone ends something the user started earlier (the roll lands seconds after the click). gain: 0-1, for
// sounds that repeat and swell or fade (the needle's ticks)
export function play(name, { late = false, gain = 1 } = {}) {
    const buf = buffers[name];
    if (!buf || ctx?.state !== 'running' || !soundsOn() || document.hidden || videoPlaying()) return;
    if (!late && performance.now() - lastGesture > ANSWER_MS) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (gain === 1) src.connect(out);
    else { const g = ctx.createGain(); g.gain.value = gain; src.connect(g).connect(out); }
    src.start();
}
