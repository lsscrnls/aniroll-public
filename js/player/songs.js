// Songs in the player: the episode's opening and ending (AnimeThemes, through api/songs.js), and
// "What's this song?" for one in the middle of it — 12 s of the video's own sound, made into a signature
// here (js/player/songsig.js) and recognized through our server, so Shazam never sees who asked.
import { getToken } from '../auth.js';
import { makeSignature, SIG_RATE, SIG_SECONDS } from './songsig.js';

const themesAsked = new Map(); // AniList id -> Promise<[{ type, n, title, artist, episodes }]>

export function loadThemes(mediaId) {
    if (!mediaId) return Promise.resolve([]);
    if (!themesAsked.has(mediaId)) {
        themesAsked.set(mediaId, fetch(`/api/songs/themes/${encodeURIComponent(mediaId)}`, { signal: AbortSignal.timeout(8000) })
            .then(r => (r.ok ? r.json() : { themes: [] }))
            .then(d => (Array.isArray(d?.themes) ? d.themes : []))
            .catch(() => { themesAsked.delete(mediaId); return []; }));
    }
    return themesAsked.get(mediaId);
}

// "1-13", "1, 3, 5-7", "13-" (from 13 on); none: every episode
export function playsIn(episodes, episode) {
    if (!episodes) return true;
    return String(episodes).split(',').some(part => {
        const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d*))?$/);
        if (!m) return false;
        const from = Number(m[1]);
        const to = m[2] === undefined ? from : m[2] === '' ? Infinity : Number(m[2]);
        return episode >= from && episode <= to;
    });
}

// The openings and endings of this episode. One kind found more than once (the list has no episode
// numbers, or they overlap): all are listed, but none is named as playing by itself
export function themesFor(themes, episode) {
    const here = themes.filter(t => playsIn(t.episodes, episode));
    const only = (type) => {
        const list = here.filter(t => t.type === type);
        return list.length === 1 ? list[0] : null;
    };
    return { list: here, op: only('OP'), ed: only('ED') };
}

// ----- Listening -----
// The video's sound goes through Web Audio from the first listen on (and stays so, on to the speakers as
// before): an element can be tapped only once. Needs the CORS the player asks for (crossorigin="anonymous").
const taps = new WeakMap();
// Safari playing HLS itself (iPhone) hands Web Audio nothing but silence, and the video would stay
// silent after: not tapped at all
const nativeHls = (video) => /\.m3u8(\?|$)/i.test(video.currentSrc || '');
function tapFor(video) {
    let tap = taps.get(video);
    if (tap) return tap;
    if (nativeHls(video)) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(video);
    source.connect(ctx.destination);
    // A context stopped by the browser (tab in the background, a phone call) would leave the video silent
    video.addEventListener('play', () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); });
    tap = { ctx, source };
    taps.set(video, tap);
    return tap;
}

// 12 s of what plays, at 16 kHz mono. onProgress(0..1) while it listens
async function record(video, { onProgress, signal } = {}) {
    const tap = tapFor(video);
    if (!tap) throw Object.assign(new Error('cannot tap'), { cannotTap: true });
    const { ctx, source } = tap;
    if (ctx.state !== 'running') await ctx.resume();
    const want = Math.ceil(SIG_SECONDS * ctx.sampleRate);
    const got = new Float32Array(want);
    let at = 0;
    // ScriptProcessor, not an AudioWorklet: the worklet would be a module of its own outside the
    // fingerprinted imports, for 12 s of copying
    const node = ctx.createScriptProcessor(4096, 2, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    await new Promise((resolve, reject) => {
        const stop = () => { node.disconnect(); source.disconnect(node); mute.disconnect(); };
        signal?.addEventListener('abort', () => { stop(); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
        node.onaudioprocess = (ev) => {
            if (video.paused) return; // only what plays counts
            const a = ev.inputBuffer.getChannelData(0);
            const b = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : a;
            const n = Math.min(a.length, want - at);
            for (let i = 0; i < n; i++) got[at + i] = (a[i] + b[i]) / 2;
            at += n;
            onProgress?.(at / want);
            if (at >= want) { stop(); resolve(); }
        };
        source.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
    });
    // Down to 16 kHz the way the browser resamples
    const length = Math.ceil(SIG_SECONDS * SIG_RATE);
    const off = new OfflineAudioContext(1, length, SIG_RATE);
    const buf = off.createBuffer(1, got.length, ctx.sampleRate);
    buf.copyToChannel(got, 0);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
}

const loud = (samples) => {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 4) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (samples.length / 4)) > 0.002;
};

// -> { song: { title, artist, cover, shazam, apple, youtube, spotify } | null }
//  | { busy: true, retryIn } | { error } ; fresh: skip what others found at this spot
export async function identify(video, { media, episode, onProgress, signal, fresh = false }) {
    if (!getToken()) return { error: 'Log in to recognize songs' };
    if (video.muted || video.volume === 0) return { error: 'Turn the sound on to recognize the song' };
    const at = video.currentTime;
    let samples;
    try {
        samples = await record(video, { onProgress, signal });
    } catch (e) {
        if (e?.name === 'AbortError') throw e;
        return { error: e?.cannotTap ? 'This browser cannot listen to the video' : 'Could not listen to the video' };
    }
    if (!loud(samples)) return { error: 'Too quiet to recognize anything' };
    const sig = makeSignature(samples);
    let res;
    try {
        res = await fetch('/api/songs/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify({ uri: sig.uri, samplems: sig.samplems, media, episode, at: Math.round(at), fresh }),
            signal: signal && AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : signal || AbortSignal.timeout(20000),
        });
    } catch (e) {
        if (e?.name === 'AbortError' && signal?.aborted) throw e;
        return { error: 'No answer, try again' };
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { song: data.song || null };
    if (data.busy) return { busy: true, retryIn: Number(data.retryIn) || 600 };
    return { error: data.error || 'Something went wrong, try again' };
}
