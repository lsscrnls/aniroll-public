// @ts-check
import { getConfig, normalizeUrl, jfAuth } from '../jellyfin.js';
import { noteStatus } from './animemap.js';
import { accountState, saveAccountState } from '../accountstate.js';

// Is the user's Jellyfin reachable from this browser right now? AniRoll has to work the same
// with the whole stack switched off, so this never blocks anything: a short timeout, the answer
// kept for five minutes, and "no" simply means no Play button — no error, no waiting.
//
// A local address (e.g. http://localhost:8096 on the PC that runs Jellyfin) is tried first:
// it skips the detour through the internet and its bandwidth limit.
const LOCAL_KEY = 'aniroll_jf_local';
const TTL = 5 * 60 * 1000;
let cached = null; // { at, value: { base, local } | null }
let running = null;

export function getLocalUrl() {
    try { return localStorage.getItem(LOCAL_KEY) || ''; } catch { return ''; }
}

export function setLocalUrl(raw) {
    const url = normalizeUrl(raw);
    try {
        if (url) localStorage.setItem(LOCAL_KEY, url);
        else localStorage.removeItem(LOCAL_KEY);
    } catch { /* storage blocked: public address only */ }
    cached = null;
    return url;
}

// What the user's server can send over the internet (its home line's upload), in bits per second, for the
// server address it was set for; 0 when not set. Kept with the account, so the phone knows it too.
const UPLOAD_KEY = 'aniroll_jf_upload';
const cleanUpload = (v) => (v && typeof v.url === 'string' && Number.isFinite(v.bps) && v.bps > 0 ? { url: v.url, bps: v.bps } : null);

export function getUpload() {
    const url = getConfig()?.url;
    try {
        const v = cleanUpload(JSON.parse(localStorage.getItem(UPLOAD_KEY) || 'null'));
        return v && v.url === url ? v.bps : 0;
    } catch { return 0; }
}

/** @param {number} mbps 0 removes it */
export function setUpload(mbps) {
    const url = getConfig()?.url || '';
    const value = mbps > 0 ? { url, bps: Math.round(mbps * 1e6) } : null;
    try { value ? localStorage.setItem(UPLOAD_KEY, JSON.stringify(value)) : localStorage.removeItem(UPLOAD_KEY); } catch { /* this page only */ }
    saveAccountState('upload', value);
    return value?.bps || 0;
}

// The account's value replaces this browser's (set on another device); once per page
let uploadSynced = null;
export function syncUpload() {
    uploadSynced ??= accountState().then(state => {
        if (!Object.hasOwn(state, 'upload')) return;
        const v = cleanUpload(state.upload);
        try { v ? localStorage.setItem(UPLOAD_KEY, JSON.stringify(v)) : localStorage.removeItem(UPLOAD_KEY); } catch { /* this page only */ }
    });
    return uploadSynced.then(getUpload);
}

async function ping(base, ms) {
    try {
        const res = await fetch(`${base}/System/Info/Public`, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
        if (!res.ok) return false;
        const info = await res.json();
        return !!info?.Id;
    } catch {
        return false;
    }
}

// { base, local } or null. `force` skips the cache (the player page after a failure).
export function availability(force = false) {
    const cfg = getConfig();
    if (!cfg) return Promise.resolve(null);
    if (!force && cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.value);
    if (running) return running;
    running = (async () => {
        const local = getLocalUrl();
        let value = null;
        if (local && local !== cfg.url && await ping(local, 1000)) value = { base: local, local: true };
        else if (await ping(cfg.url, 3000)) value = { base: cfg.url, local: false };
        cached = { at: Date.now(), value };
        running = null;
        // Reachable again after being off: the library check runs (js/player/animemap.js)
        // Started before anyone waits on this answer, so a lookup right after it finds the check running
        noteStatus(!!value);
        return value;
    })();
    return running;
}

export function forgetAvailability() {
    cached = null;
}

// What the way from the server to this browser carries, in bits per second: one download of `size`
// bytes from /Playback/BitrateTest, as Jellyfin's own player measures it
export async function bitrateTest(base, apiKey, size) {
    const t = performance.now();
    const res = await fetch(`${base}/Playback/BitrateTest?Size=${size}`, { headers: jfAuth(apiKey), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`bitrate test ${res.status}`);
    const bytes = (await res.arrayBuffer()).byteLength;
    return (bytes * 8) / Math.max(0.05, (performance.now() - t) / 1000);
}
