// @ts-check
import { getConfig, getHookSecret, normTitle, splitYear } from '../jellyfin.js?v=161';
import { getToken } from '../auth.js?v=161';
import { availability } from './availability.js?v=161';
import { jfGet, refreshMatches } from './library.js?v=161';

// The library check: which Jellyfin show is which AniList entry, by TVDB/TMDB id instead of title.
// Jellyfin names a show after TVDB ("X"), AniList often adds a subtitle ("X: Y"), and a later part can
// share a TVDB season (episodes 13-24 of season 1). One list of the library from Jellyfin, one
// request to our server (api/animemap.js) with its TVDB/TMDB ids, 0 AniList requests.
// It runs when Jellyfin shows as connected again after being off (the PC was shut down), when the
// last check is a day old, and when a show is missing and the last check is a while back (a fresh
// import). Kept per Jellyfin user in this browser.

const KEY = 'aniroll_jf_animemap';
const STALE_MS = 24 * 60 * 60 * 1000;
const MISS_MS = 15 * 60 * 1000;

/** @typedef {{ kind: 'series', id: string, season: number, offset: number } | { kind: 'movie', id: string }} Mapped */
/** @typedef {{ user: string, at?: number, tried?: number, online?: boolean, map?: Record<string, Mapped>, sent?: string }} Stored */

/** @returns {Stored} */
function read(userId) {
    try {
        const s = JSON.parse(localStorage.getItem(KEY) || '{}');
        return s.user === userId ? s : { user: userId };
    } catch {
        return { user: userId };
    }
}

/** @param {Stored} s */
function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full or blocked: titles only */ }
}

/** @returns {Mapped | null} the Jellyfin show the last check found for this AniList entry */
export function mappedShow(mediaId) {
    const cfg = getConfig();
    return cfg ? read(cfg.userId).map?.[mediaId] || null : null;
}

// From getStatus (js/jellyfin.js): what the profile menu shows. Back online -> check.
export function noteStatus(connected) {
    const cfg = getConfig();
    if (!cfg) return;
    const s = read(cfg.userId);
    if (!connected) {
        if (s.online !== false) write({ ...s, online: false });
        return;
    }
    if (s.online === false || !s.at || Date.now() - s.at > STALE_MS) checkLibrary().catch(() => {});
}

// A show was not found: check again if the last check is a while back (it may have just been imported).
// True when there is a newer map to look in: a check still running, or one finished since `since`.
export async function checkAfterMiss(since) {
    const cfg = getConfig();
    if (!cfg) return false;
    if (running) return running.catch(() => false);
    const s = read(cfg.userId);
    if ((s.at || 0) > since) return true;
    const last = Math.max(s.at || 0, s.tried || 0);
    if (Date.now() - last < MISS_MS) return false;
    write({ ...s, tried: Date.now() });
    return checkLibrary();
}

const providerId = (item, name) => {
    const hit = Object.entries(item?.ProviderIds || {}).find(([k]) => k.toLowerCase() === name);
    const n = Number(hit?.[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
};

let running = null;

// -> true when the check ran (Jellyfin and our server both answered)
export function checkLibrary() {
    if (running) return running;
    running = (async () => {
        const cfg = getConfig();
        const avail = cfg && await availability(true);
        if (!cfg || !avail) return false;
        const data = await jfGet(avail.base, `/Users/${encodeURIComponent(cfg.userId)}/Items?IncludeItemTypes=Series,Movie&Recursive=true`
            + '&fields=ProviderIds&EnableImages=false&EnableUserData=false', cfg.apiKey, 20000);
        const items = (data?.Items || []).map(i => ({ id: i.Id, name: i.Name || '', movie: i.Type === 'Movie', tvdb: providerId(i, 'tvdb'), tmdb: providerId(i, 'tmdb') }));
        const series = items.filter(i => !i.movie);
        const movies = items.filter(i => i.movie);
        const res = await fetch('/api/animemap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tvdb: [...new Set(series.map(i => i.tvdb).filter(Boolean))],
                tmdb: [...new Set(series.map(i => i.tmdb).filter(Boolean))],
                movie: [...new Set(movies.map(i => i.tmdb).filter(Boolean))],
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return false;
        const { entries = [] } = await res.json();

        /** @type {Record<string, Mapped>} */
        const map = {};
        for (const e of entries) {
            // TVDB first: Sonarr names the files after it, so its seasons are the folders. Specials (season 0) are left out.
            const byTvdb = e.tvdb && e.ts > 0 && series.find(i => i.tvdb === e.tvdb);
            const byTmdb = !byTvdb && e.tmdb && e.ms > 0 && series.find(i => i.tmdb === e.tmdb);
            const movie = movies.find(i => i.tmdb && (e.movie || []).includes(i.tmdb));
            if (byTvdb) map[e.a] = { kind: 'series', id: byTvdb.id, season: e.ts, offset: e.to || 0 };
            else if (byTmdb) map[e.a] = { kind: 'series', id: byTmdb.id, season: e.ms, offset: e.mo || 0 };
            else if (movie) map[e.a] = { kind: 'movie', id: movie.id };
        }
        const sent = await sendLibrary(map, items, read(cfg.userId).sent);
        write({ user: cfg.userId, at: Date.now(), online: true, map, sent });
        // Shows looked for before (missing, or found by title) are looked up again with this
        refreshMatches(Object.keys(map));
        return true;
    })().finally(() => { running = null; });
    return running;
}

// The Jellyfin webhook (api/server.js) names the series and season, not the TVDB id: the server gets
// what this check found under those names, so watching in Jellyfin itself counts the right entry.
// Only with live tracking on (turning it off deletes it there), and only when it changed or the
// tracking link is new; logged out or the server away, it is tried with the next check.
async function sendLibrary(map, items, lastSent) {
    const secret = getHookSecret();
    if (!getToken() || !secret) return lastSent;
    const byId = new Map(items.map(i => [i.id, i]));
    /** @type {Record<string, [number, number][]>} */
    const names = {};
    for (const [mediaId, m] of Object.entries(map)) {
        const item = byId.get(m.id);
        if (!item) continue;
        const name = normTitle(splitYear(item.name).title);
        const key = m.kind === 'movie' ? `movie|${name}` : `${name}|${m.season}`;
        (names[key] ||= []).push([Number(mediaId), m.kind === 'movie' ? 0 : m.offset]);
    }
    const body = JSON.stringify({ map: names });
    const sent = secret + body;
    if (sent === lastSent) return lastSent;
    const res = await fetch('/api/me/jflibrary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body,
        signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    return res?.ok ? sent : lastSent;
}
