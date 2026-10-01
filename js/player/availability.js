import { getConfig, normalizeUrl } from '../jellyfin.js?v=127';

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
        return value;
    })();
    return running;
}

export function forgetAvailability() {
    cached = null;
}
