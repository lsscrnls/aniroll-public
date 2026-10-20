// Songs in the player (js/player/songs.js):
//   GET  /api/songs/themes/<anilistId>  openings and endings from AnimeThemes (api.animethemes.moe), kept a week
//   POST /api/songs/identify            "What's this song?": a signature made in the browser (js/player/songsig.js),
//                                       asked of Shazam from here, so Shazam never sees who asked
//   GET  /api/songs/cover?u=            the cover Shazam names, fetched from here for the same reason
// Shazam has no public API: this is the request its Android app makes (as SongRec does). When it says
// "too many" (429) it is left alone for a while, longer each time, and the player says to try later.
// Songs found are kept per anime, episode and time, without who asked: the next one at that spot gets
// the answer without Shazam being asked again.
const crypto = require('crypto');
const path = require('path');

const THEMES_TTL = 7 * 24 * 60 * 60 * 1000;
const THEMES_EMPTY_TTL = 24 * 60 * 60 * 1000;
const MAX_THEMES = 4000;
const MAX_SPOTS = 20000;
const SPOT_NEAR_S = 20; // a song kept at 3:10 answers for 2:50–3:30
const COOLDOWN_FIRST = 15 * 60 * 1000;
const COOLDOWN_MAX = 6 * 60 * 60 * 1000;
const SIG_PREFIX = 'data:audio/vnd.shazam.sig;base64,';
const USER_AGENTS = [
    'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)',
    'Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-T210 Build/LMY47X)',
    'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)',
    'Dalvik/2.1.0 (Linux; U; Android 7.0; SM-G930F Build/NRD90M)',
    'Dalvik/2.1.0 (Linux; U; Android 8.0.0; SM-G950F Build/R16NW)',
];
const COVER_HOST = /^is\d+-ssl\.mzstatic\.com$/;
// Stand-ins for the tests (tools/api-test)
const THEMES_API = process.env.ANIMETHEMES_URL || 'https://api.animethemes.moe';
const SHAZAM_API = process.env.SHAZAM_URL || 'https://amp.shazam.com';

module.exports = function songs({ dataDir, readJson, writeJson, json, readBody, overLimit, clientIp, verifyViewer, refuseAuth }) {
    const themesFile = path.join(dataDir, 'themes.json');
    const spotsFile = path.join(dataDir, 'songspots.json');
    const cooldown = { until: 0, strikes: 0 };
    const covers = new Map(); // url -> { type, body }
    const counts = { asked: 0, found: 0, kept: 0, limited: 0 };

    // ----- Openings and endings -----
    function slimThemes(anime) {
        return (anime?.animethemes || []).filter(t => t && (t.type === 'OP' || t.type === 'ED') && t.song?.title).map(t => {
            const eps = [...new Set((t.animethemeentries || []).map(e => String(e.episodes || '').trim()).filter(Boolean))];
            return {
                type: t.type,
                n: Number(t.sequence) || 1,
                title: String(t.song.title).slice(0, 200),
                artist: (t.song.artists || []).map(a => a.artistsong?.as || a.name).filter(Boolean).join(', ').slice(0, 200),
                // "1-13", "1, 3, 5-7"; none: every episode
                episodes: eps.join(', ').slice(0, 200) || null,
            };
        }).sort((a, b) => (a.type === b.type ? a.n - b.n : a.type === 'OP' ? -1 : 1));
    }

    async function handleThemes(req, res, id) {
        if (overLimit('themes-ip', clientIp(req), 30, 60000)) return json(res, 429, { error: 'Too many requests, try again in a minute' });
        const all = readJson(themesFile);
        const kept = Object.hasOwn(all, id) ? all[id] : null;
        if (kept && Date.now() - kept.at < (kept.list.length ? THEMES_TTL : THEMES_EMPTY_TTL)) return json(res, 200, { themes: kept.list });
        // AnimeThemes allows 90 a minute; most of ours come from the file above
        if (overLimit('themes-upstream', 'all', 60, 60000)) return json(res, 200, { themes: kept?.list || [] });
        let list;
        try {
            const r = await fetch(`${THEMES_API}/anime?`
                + 'filter[has]=resources&filter[site]=AniList'
                + `&filter[external_id]=${id}&include=animethemes.song.artists,animethemes.animethemeentries`,
                { headers: { 'User-Agent': 'AniRoll (aniroll.app)', Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
            if (!r.ok) throw new Error(String(r.status));
            const data = await r.json();
            list = slimThemes((data?.anime || [])[0]);
        } catch {
            // Not reachable: what was kept, however old, or nothing (and asked again next time)
            return json(res, 200, { themes: kept?.list || [] });
        }
        all[id] = { at: Date.now(), list };
        const ids = Object.keys(all);
        if (ids.length > MAX_THEMES) {
            ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - MAX_THEMES).forEach(k => delete all[k]);
        }
        writeJson(themesFile, all, { pretty: false });
        json(res, 200, { themes: list });
    }

    // ----- What's this song? -----
    const coverUrl = (u) => {
        try {
            const url = new URL(u);
            return url.protocol === 'https:' && COVER_HOST.test(url.hostname) ? `/api/songs/cover?u=${encodeURIComponent(url.href)}` : '';
        } catch { return ''; }
    };
    const https = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u.slice(0, 500) : '');

    function songFrom(track) {
        if (!track?.title) return null;
        const title = String(track.title).slice(0, 200);
        const artist = String(track.subtitle || '').slice(0, 200);
        const q = encodeURIComponent(`${title} ${artist}`.trim());
        // Apple Music's link comes as an Android intent: intent://music.apple.com/…#Intent;…
        const open = (track.hub?.options || []).flatMap(o => o.actions || []).map(a => String(a.uri || ''))
            .find(u => u.startsWith('intent://music.apple.com/'));
        return {
            title, artist,
            cover: coverUrl(track.images?.coverarthq || track.images?.coverart),
            shazam: https(track.url),
            apple: open ? https('https://' + open.slice('intent://'.length).split('#')[0]) : '',
            youtube: `https://music.youtube.com/search?q=${q}`,
            spotify: `https://open.spotify.com/search/${q}`,
        };
    }

    function spotKey(media, episode) {
        return Number.isInteger(media) && media > 0 && Number.isInteger(episode) && episode >= 0 ? `${media}/${episode}` : null;
    }
    function keptSong(key, at) {
        if (!key) return null;
        const list = readJson(spotsFile)[key] || [];
        let best = null;
        for (const s of list) if (Math.abs(s.at - at) <= SPOT_NEAR_S && (!best || Math.abs(s.at - at) < Math.abs(best.at - at))) best = s;
        return best?.song || null;
    }
    function keepSong(key, at, song) {
        if (!key) return;
        const all = readJson(spotsFile);
        const list = (Object.hasOwn(all, key) ? all[key] : []).filter(s => Math.abs(s.at - at) > SPOT_NEAR_S / 2);
        list.push({ at, song, kept: Date.now() });
        all[key] = list.slice(-40);
        const keys = Object.keys(all);
        if (keys.length > MAX_SPOTS) {
            const last = (k) => Math.max(...all[k].map(s => s.kept || 0));
            keys.sort((a, b) => last(a) - last(b)).slice(0, keys.length - MAX_SPOTS).forEach(k => delete all[k]);
        }
        writeJson(spotsFile, all, { pretty: false });
    }

    async function askShazam(uri, samplems) {
        const now = Date.now();
        const url = `${SHAZAM_API}/discovery/v5/en/US/android/-/tag/${crypto.randomUUID().toUpperCase()}/${crypto.randomUUID()}`
            + '?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3';
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', 'Content-Language': 'en_US',
                'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            },
            body: JSON.stringify({
                geolocation: { altitude: 300, latitude: 45, longitude: 2 },
                signature: { samplems, timestamp: now >>> 0, uri },
                timestamp: now >>> 0,
                timezone: 'Europe/Berlin',
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (r.status === 429) {
            cooldown.strikes++;
            const after = Number(r.headers.get('retry-after'));
            const wait = after > 0 ? after * 1000 : COOLDOWN_FIRST * 2 ** (cooldown.strikes - 1);
            cooldown.until = Date.now() + Math.min(wait, COOLDOWN_MAX);
            counts.limited++;
            return { busy: true };
        }
        if (!r.ok) throw new Error(String(r.status));
        cooldown.strikes = 0;
        return { song: songFrom((await r.json())?.track) };
    }

    const busy = (res) => json(res, 503, { error: 'Song recognition is busy, try again later', busy: true,
        retryIn: Math.max(60, Math.ceil((cooldown.until - Date.now()) / 1000)) });

    async function handleIdentify(req, res) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok') return refuseAuth(res, auth);
        const body = await readBody(req);
        const uri = typeof body.uri === 'string' ? body.uri : '';
        const samplems = Number(body.samplems);
        if (!uri.startsWith(SIG_PREFIX) || uri.length > 60000 || !/^[A-Za-z0-9+/=]+$/.test(uri.slice(SIG_PREFIX.length))
            || !(samplems >= 3000 && samplems <= 20000)) return json(res, 400, { error: 'No signature' });
        const key = spotKey(Number(body.media), Number(body.episode));
        const at = Math.max(0, Math.round(Number(body.at) || 0));

        // Someone found it here before: no need to ask
        if (!body.fresh) {
            const song = keptSong(key, at);
            if (song) { counts.kept++; return json(res, 200, { song }); }
        }
        const user = String(auth.viewer.id);
        if (overLimit('song-user', user, 6, 60000) || overLimit('song-user-day', user, 60, 24 * 60 * 60 * 1000)) {
            return json(res, 429, { error: 'That was a lot of songs, try again in a minute' });
        }
        if (Date.now() < cooldown.until) return busy(res);
        // Kind to Shazam: everyone together at most this many a minute
        if (overLimit('song-shazam', 'all', 20, 60000)) return busy(res);
        counts.asked++;
        let answer;
        try { answer = await askShazam(uri, Math.round(samplems)); } catch { return json(res, 502, { error: 'Shazam did not answer, try again' }); }
        if (answer.busy) return busy(res);
        if (answer.song) { counts.found++; keepSong(key, at, answer.song); }
        json(res, 200, { song: answer.song });
    }

    async function handleCover(req, res) {
        let url;
        try { url = new URL(new URL(req.url, 'http://x').searchParams.get('u') || ''); } catch { return json(res, 400, { error: 'Bad cover' }); }
        if (url.protocol !== 'https:' || !COVER_HOST.test(url.hostname)) return json(res, 400, { error: 'Bad cover' });
        if (overLimit('cover-ip', clientIp(req), 60, 60000)) return json(res, 429, { error: 'Too many requests' });
        let hit = covers.get(url.href);
        if (!hit) {
            try {
                const r = await fetch(url.href, { signal: AbortSignal.timeout(6000) });
                const type = r.headers.get('content-type') || '';
                const body = Buffer.from(await r.arrayBuffer());
                if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type) || body.length > 1 << 20) throw new Error('not an image');
                hit = { type, body };
            } catch { return json(res, 502, { error: 'No cover' }); }
            if (covers.size >= 200) covers.delete(covers.keys().next().value);
            covers.set(url.href, hit);
        }
        res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=2592000, immutable' });
        res.end(hit.body);
    }

    function handle(req, res, pathname) {
        const themes = pathname.match(/^\/api\/songs\/themes\/(\d{1,9})$/);
        if (themes && req.method === 'GET') return handleThemes(req, res, themes[1]);
        if (pathname === '/api/songs/identify') return handleIdentify(req, res);
        if (pathname === '/api/songs/cover' && req.method === 'GET') return handleCover(req, res);
        return json(res, 404, { error: 'Not found' });
    }

    return { handle, stats: () => ({ ...counts, coolingUntil: cooldown.until > Date.now() ? cooldown.until : 0 }) };
};
