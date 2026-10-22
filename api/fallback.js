// When AniList is down (2026-10-21, a day long): enough to keep AniRoll going, in AniList's own shape, so the
// pages need no second way of reading it (js/api.js asks here only after AniList failed).
//   GET /api/fallback/media/<anilistId>   one show or film from TMDB, matched by the anime map (api/animemap.js)
//   GET /api/fallback/search?q=           TMDB's search, animation only, back to AniList ids by the same map
//   GET/PUT /api/me/list?type=            a VIP's own list, kept here after every fresh read from AniList
// TMDB answers are never stored as AniList's: once AniList answers again, the browser uses its data.
// TMDB needs a key (TMDB_TOKEN, its "API Read Access Token"); without one these answer 503.
const path = require('path');
const fs = require('fs');

const TMDB_API = process.env.TMDB_URL || 'https://api.themoviedb.org/3';
const TMDB_TOKEN = process.env.TMDB_TOKEN || '';
const IMG = 'https://image.tmdb.org/t/p/';
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;
const CACHE_MAX = 3000;
const LIST_MAX_BYTES = 3e6;
const LIST_TYPES = new Set(['ANIME', 'MANGA']);
// TMDB's genres in AniList's words; Animation, Family, Kids and the like say nothing about an anime
const GENRES = {
    'Action & Adventure': ['Action', 'Adventure'], 'Sci-Fi & Fantasy': ['Sci-Fi', 'Fantasy'], 'Science Fiction': ['Sci-Fi'],
    Action: ['Action'], Adventure: ['Adventure'], Comedy: ['Comedy'], Drama: ['Drama'], Fantasy: ['Fantasy'], Horror: ['Horror'],
    Mystery: ['Mystery'], Romance: ['Romance'], Thriller: ['Thriller'], Music: ['Music'], 'War & Politics': ['Drama'],
};

module.exports = function fallback({ dataDir, readJson, writeJson, json, readBody, overLimit, clientIp, verifyViewer, refuseAuth, isVip, animeMap }) {
    const cache = new Map(); // TMDB path -> { at, data | null }
    const listDir = path.join(dataDir, 'lists');

    async function tmdb(p) {
        const hit = cache.get(p);
        if (hit && Date.now() - hit.at < (hit.data ? CACHE_TTL : MISS_TTL)) return hit.data;
        let data = null;
        try {
            const res = await fetch(`${TMDB_API}${p}`, {
                headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(6000),
            });
            if (res.ok) data = await res.json();
            else if (res.status !== 404) throw new Error(`TMDB answered ${res.status}`);
        } catch (e) {
            if (hit) return hit.data;
            throw e;
        }
        cache.delete(p);
        cache.set(p, { at: Date.now(), data });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        return data;
    }

    const img = (size, p) => (p ? `${IMG}${size}${p}` : null);
    const fuzzy = (d) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
        return m ? { year: +m[1], month: +m[2], day: +m[3] } : { year: null, month: null, day: null };
    };
    const seasonOf = (date) => (date.month ? ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'][date.month - 1] : null);
    const genresOf = (list) => [...new Set((list || []).flatMap(g => GENRES[g.name] || []))];
    const score = (t) => (t?.vote_count >= 10 ? Math.round(t.vote_average * 10) : null);

    // Everything the detail page reads, empty where TMDB has nothing to say
    function shape(base) {
        const start = base.startDate;
        return {
            idMal: null, chapters: null, volumes: null, popularity: null, endDate: { year: null, month: null, day: null },
            season: seasonOf(start), seasonYear: start.year, nextAiringEpisode: null, mediaListEntry: null, type: 'ANIME',
            source: null, countryOfOrigin: 'JP', isAdult: false, trailer: null,
            recommendations: { nodes: [] }, studios: { edges: [] }, relations: { edges: [] }, characters: { edges: [] },
            reviews: { nodes: [] }, stats: { scoreDistribution: [], statusDistribution: [] }, tags: [], externalLinks: [],
            fallback: 'tmdb',
            ...base,
        };
    }

    async function movieMedia(id, movieId) {
        const m = await tmdb(`/movie/${movieId}?language=en-US`);
        if (!m) return null;
        const startDate = fuzzy(m.release_date);
        return shape({
            id, title: { english: m.title, romaji: m.title, native: m.original_title || null, userPreferred: m.title },
            coverImage: { large: img('w342', m.poster_path), extraLarge: img('w780', m.poster_path), color: null },
            bannerImage: img('w1280', m.backdrop_path), format: 'MOVIE', status: m.status === 'Released' ? 'FINISHED' : 'NOT_YET_RELEASED',
            episodes: 1, meanScore: score(m), averageScore: score(m), genres: genresOf(m.genres), startDate,
            description: m.overview || null, duration: m.runtime || null, tmdb: { kind: 'movie', id: movieId },
        });
    }

    // A show's AniList entry is a TMDB season, or the part of one from its episode offset to the next entry's
    async function tvMedia(id, e) {
        const show = await tmdb(`/tv/${e.tmdb}?language=en-US`);
        if (!show) return null;
        const seasonNo = Number.isInteger(e.ms) ? e.ms : null;
        const season = seasonNo != null ? await tmdb(`/tv/${e.tmdb}/season/${seasonNo}?language=en-US`) : null;
        const all = season?.episodes || [];
        const next = animeMap.forTmdb(e.tmdb).filter(o => o.ms === e.ms && o.mo > e.mo).sort((a, b) => a.mo - b.mo)[0];
        const eps = all.filter(ep => ep.episode_number > e.mo && (!next || ep.episode_number <= next.mo));
        const today = new Date().toISOString().slice(0, 10);
        const aired = eps.filter(ep => ep.air_date && ep.air_date <= today);
        const upcoming = eps.find(ep => ep.air_date && ep.air_date > today);
        const startDate = fuzzy(eps[0]?.air_date || season?.air_date || show.first_air_date);
        const status = !eps.length ? (show.status === 'Ended' ? 'FINISHED' : 'RELEASING')
            : !aired.length ? 'NOT_YET_RELEASED' : upcoming ? 'RELEASING' : 'FINISHED';
        const airingAt = upcoming ? Math.floor(Date.parse(`${upcoming.air_date}T15:00:00Z`) / 1000) : null;
        const part = seasonNo > 1 || e.mo > 0 ? (season?.name && !/^Season \d+$/.test(season.name) ? season.name : `Season ${seasonNo}${e.mo ? `, from episode ${e.mo + 1}` : ''}`) : '';
        const name = part ? `${show.name}: ${part}` : show.name;
        const runtimes = eps.map(ep => ep.runtime).filter(Boolean);
        return shape({
            id, title: { english: name, romaji: name, native: show.original_name || null, userPreferred: name },
            coverImage: { large: img('w342', season?.poster_path || show.poster_path), extraLarge: img('w780', season?.poster_path || show.poster_path), color: null },
            bannerImage: img('w1280', show.backdrop_path), format: seasonNo === 0 ? 'SPECIAL' : 'TV', status,
            episodes: eps.length || null, meanScore: score(show), averageScore: score(show), genres: genresOf(show.genres), startDate,
            description: season?.overview || show.overview || null,
            duration: runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : (show.episode_run_time || [])[0] || null,
            nextAiringEpisode: upcoming ? { episode: upcoming.episode_number - e.mo, airingAt, timeUntilAiring: airingAt - Math.floor(Date.now() / 1000) } : null,
            tmdb: { kind: 'tv', id: e.tmdb, season: seasonNo },
        });
    }

    // The search: cards only (the fields of a media card), AniList ids by the anime map, unknown ones left out
    async function search(q) {
        const page = await tmdb(`/search/multi?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`);
        const cards = [];
        for (const r of page?.results || []) {
            if (!(r.genre_ids || []).includes(16)) continue;
            const movie = r.media_type === 'movie';
            if (!movie && r.media_type !== 'tv') continue;
            const entries = (movie ? animeMap.forMovie(r.id) : animeMap.forTmdb(r.id)).slice().sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0) || a.mo - b.mo);
            const name = movie ? r.title : r.name;
            const date = fuzzy(movie ? r.release_date : r.first_air_date);
            for (const e of entries) {
                const part = !movie && entries.length > 1 && (e.ms > 1 || e.mo > 0) ? `: Season ${e.ms}${e.mo ? `, from episode ${e.mo + 1}` : ''}` : '';
                cards.push({
                    id: e.a, title: { userPreferred: name + part, english: name + part, romaji: name + part, native: (movie ? r.original_title : r.original_name) || null },
                    coverImage: { large: img('w342', r.poster_path), extraLarge: img('w780', r.poster_path), color: null },
                    format: movie ? 'MOVIE' : 'TV', status: null, episodes: null, chapters: null, meanScore: score(r),
                    season: part ? null : seasonOf(date), seasonYear: part ? null : date.year, nextAiringEpisode: null, mediaListEntry: null,
                    type: 'ANIME', genres: [], isAdult: false, fallback: 'tmdb',
                });
                if (cards.length >= 20) break;
            }
            if (cards.length >= 20) break;
        }
        return { pageInfo: { total: cards.length, currentPage: 1, lastPage: 1, hasNextPage: false }, media: cards };
    }

    // ----- A VIP's own list -----
    const listFile = (userId, type) => path.join(listDir, `${userId}-${type}.json`);

    async function handleList(req, res) {
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok') return refuseAuth(res, auth);
        if (!isVip(auth.viewer.id)) return json(res, 403, { error: 'Kept for VIPs only' });
        const type = new URL(req.url, 'http://x').searchParams.get('type') || 'ANIME';
        if (!LIST_TYPES.has(type)) return json(res, 400, { error: 'Unknown list type' });
        const file = listFile(auth.viewer.id, type);
        if (req.method === 'GET') {
            const kept = readJson(file);
            return Array.isArray(kept.lists) ? json(res, 200, kept) : json(res, 404, { error: 'No list kept' });
        }
        if (req.method === 'PUT') {
            if (overLimit('list-put', String(auth.viewer.id), 6, 60 * 60000)) return json(res, 429, { error: 'Kept often enough' });
            const body = await readBody(req, LIST_MAX_BYTES);
            const lists = Array.isArray(body.lists) ? body.lists : null;
            if (!lists || lists.length > 60 || lists.some(l => !l || !Array.isArray(l.entries) || l.entries.length > 10000)) return json(res, 400, { error: 'Not a list' });
            fs.mkdirSync(listDir, { recursive: true });
            writeJson(file, { at: Date.now(), lists }, { pretty: false, mode: 0o600 });
            return json(res, 200, { ok: true });
        }
        return json(res, 405, { error: 'Method not allowed' });
    }

    function forgetUser(userId) {
        for (const type of LIST_TYPES) {
            const file = listFile(userId, type);
            if (fs.existsSync(file)) writeJson(file, {}, { pretty: false, mode: 0o600 });
            fs.rmSync(file, { force: true });
        }
    }

    async function handle(req, res, pathname) {
        if (pathname === '/api/me/list') return handleList(req, res);
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
        if (!TMDB_TOKEN) return json(res, 503, { error: 'TMDB is not set up' });
        if (overLimit('tmdb-ip', clientIp(req), 40, 60000)) return json(res, 429, { error: 'Too many requests, try again in a minute' });
        try {
            const m = /^\/api\/fallback\/media\/(\d{1,9})$/.exec(pathname);
            if (m) {
                const id = Number(m[1]);
                const e = animeMap.forAnilist(id);
                if (!e) return json(res, 404, { error: 'TMDB does not know this one' });
                const media = e.tmdb ? await tvMedia(id, e) : e.movie?.length ? await movieMedia(id, e.movie[0]) : null;
                return media ? json(res, 200, { media }) : json(res, 404, { error: 'TMDB does not know this one' });
            }
            if (pathname === '/api/fallback/search') {
                const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 100);
                if (q.length < 2) return json(res, 400, { error: 'Search for at least two letters' });
                return json(res, 200, await search(q));
            }
        } catch (e) {
            console.error('tmdb fallback:', e.message);
            return json(res, 502, { error: 'TMDB isn’t answering either' });
        }
        return json(res, 404, { error: 'Not found' });
    }

    return { handle, forgetUser };
};
