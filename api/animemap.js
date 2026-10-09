// AniList id <-> TVDB / TMDB, for the player's library check (js/player/animemap.js).
// Jellyfin names a show after TVDB/TMDB ("X"), AniList often adds a subtitle ("X: Y"), so titles
// alone miss shows that are there. The community list behind this (Fribb/anime-lists) also knows
// the TVDB season and the episode offset of every AniList entry: a later part that shares a TVDB
// season starts at episode 13, not 1. Loaded once a day, kept slim in data/; AniList is never asked.
const fs = require('fs');
const path = require('path');

const SOURCE = process.env.ANIME_MAP_URL ?? 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_IDS = 3000;

module.exports = function animeMap({ dataDir, writeJson, readJson, json, readBody, overLimit, clientIp, verifyViewer, refuseAuth, normTitle, splitYear }) {
    const file = path.join(dataDir, 'animemap.json');
    const libraryFile = path.join(dataDir, 'jflibrary.json');
    let entries = [];         // [{ a, tvdb, ts, to, tmdb, ms, mo, movie: [TMDB movie ids] }]
    let byTvdb = new Map();   // TVDB series id -> entries
    let byTmdb = new Map();   // TMDB tv id -> entries
    let byMovie = new Map();  // TMDB movie id -> entries
    let loadedAt = 0;
    let loading = null;

    const num = (v) => (Number.isInteger(v) ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null));

    function index(list, at) {
        entries = list;
        loadedAt = at;
        byTvdb = new Map(); byTmdb = new Map(); byMovie = new Map();
        const add = (map, key, e) => { if (key) map.set(key, [...(map.get(key) || []), e]); };
        for (const e of list) { add(byTvdb, e.tvdb, e); add(byTmdb, e.tmdb, e); (e.movie || []).forEach(id => add(byMovie, id, e)); }
    }

    // The full list carries a dozen ids per show; only the ones the player needs are kept
    function slim(raw) {
        const out = [];
        for (const r of Array.isArray(raw) ? raw : []) {
            const a = num(r.anilist_id);
            if (!a) continue;
            const tmdb = r.themoviedb_id && typeof r.themoviedb_id === 'object' ? r.themoviedb_id : {};
            const e = {
                a,
                tvdb: num(r.tvdb_id), ts: num(r.season?.tvdb), to: num(r.episode_offset?.tvdb) || 0,
                tmdb: num(tmdb.tv), ms: num(r.season?.tmdb), mo: num(r.episode_offset?.tmdb) || 0,
                movie: [].concat(tmdb.movie ?? []).map(num).filter(Boolean),
            };
            if (e.tvdb || e.tmdb || e.movie.length) out.push(e);
        }
        return out;
    }

    async function refresh() {
        if (!SOURCE || loading) return loading;
        loading = (async () => {
            try {
                const res = await fetch(SOURCE, { signal: AbortSignal.timeout(60000) });
                if (!res.ok) throw new Error(`answered ${res.status}`);
                const list = slim(await res.json());
                // A broken or cut download must not replace a good list
                if (list.length < 1000) throw new Error(`only ${list.length} entries`);
                const at = Date.now();
                index(list, at);
                writeJson(file, { at, entries: list }, { pretty: false });
            } catch (e) {
                console.error('anime map refresh failed:', e.message);
            } finally {
                loading = null;
            }
        })();
        return loading;
    }

    const kept = readJson(file);
    if (kept && Array.isArray(kept.entries)) index(kept.entries, kept.at || 0);
    if (Date.now() - loadedAt > REFRESH_MS) refresh();
    setInterval(() => { if (Date.now() - loadedAt > REFRESH_MS) refresh(); }, 60 * 60 * 1000).unref();

    const ids = (v) => (Array.isArray(v) ? v.map(num).filter(Boolean).slice(0, MAX_IDS) : []);

    // POST /api/animemap { tvdb: [...], tmdb: [...], movie: [...] } -> { entries: [...] }:
    // every AniList entry that belongs to one of the given library ids. Nothing is stored.
    async function handle(req, res) {
        const body = await readBody(req);
        if (overLimit('animemap-ip', clientIp(req), 20, 60000)) return json(res, 429, { error: 'Too many requests' });
        const found = new Set();
        for (const id of ids(body.tvdb)) (byTvdb.get(id) || []).forEach(e => found.add(e));
        for (const id of ids(body.tmdb)) (byTmdb.get(id) || []).forEach(e => found.add(e));
        for (const id of ids(body.movie)) (byMovie.get(id) || []).forEach(e => found.add(e));
        res.setHeader('Cache-Control', 'no-store');
        json(res, 200, { at: loadedAt, entries: [...found] });
    }

    // The browser's last library check, per AniList account, for the Jellyfin webhook: it names the
    // series and season, not the TVDB id, so the browser sends what it found under those names.
    // { "<series>|<season>": [[mediaId, offset], ...], "movie|<name>": [[mediaId, 0]] }
    // PUT /api/me/jflibrary { map }
    async function handleLibrary(req, res) {
        if (req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' });
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok') return refuseAuth(res, auth);
        const body = await readBody(req);
        const map = {};
        for (const [key, list] of Object.entries(body.map && typeof body.map === 'object' ? body.map : {}).slice(0, MAX_IDS)) {
            if (typeof key !== 'string' || key.length > 200 || !Array.isArray(list)) continue;
            const pairs = list.slice(0, 8).map(p => [num(p?.[0]), Math.max(0, num(p?.[1]) || 0)]).filter(p => p[0]);
            if (pairs.length) map[key] = pairs;
        }
        const all = readJson(libraryFile);
        all[String(auth.viewer.id)] = { at: Date.now(), map };
        writeJson(libraryFile, all, { pretty: false, mode: 0o600 });
        json(res, 200, { ok: true, kept: Object.keys(map).length });
    }

    // A webhook event -> { mediaId, offset } from the library check, or null. A season shared by two
    // AniList parts goes to the part whose first episode is the latest one before this episode.
    function libraryMatch(userId, info) {
        const map = (readJson(libraryFile)[String(userId)] || {}).map;
        if (!map) return null;
        if (info.type === 'Movie') {
            const hit = map[`movie|${normTitle(splitYear(info.name).title)}`];
            return hit ? { mediaId: hit[0][0], offset: 0 } : null;
        }
        const season = info.season === null || info.season === undefined ? 1 : info.season;
        const list = map[`${normTitle(splitYear(info.series).title)}|${season}`];
        if (!list) return null;
        const episode = info.episode || 1;
        const fits = list.filter(([, offset]) => offset < episode).sort((a, b) => b[1] - a[1]);
        return fits.length ? { mediaId: fits[0][0], offset: fits[0][1] } : null;
    }

    // Live tracking turned off: the library is only there for it
    function forgetLibrary(userId) {
        const all = readJson(libraryFile);
        if (!all[String(userId)]) return;
        delete all[String(userId)];
        writeJson(libraryFile, all, { pretty: false, mode: 0o600 });
    }

    return { handle, handleLibrary, libraryMatch, forgetLibrary, stats: () => ({ entries: entries.length, at: loadedAt }) };
};
