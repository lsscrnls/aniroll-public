// Minimal AniList stand-in for testing the API server's background sync locally.
// Tokens: good-token -> 1 "me", guest-token -> 2 "guest", host-token -> 3 "host",
//         rewatch-token -> 4 "rewatcher", optout-token -> 5 "optout"
const http = require('http');

const USERS = {
    'good-token': { id: 1, name: 'me' },
    'guest-token': { id: 2, name: 'guest' },
    'host-token': { id: 3, name: 'host' },
    'rewatch-token': { id: 4, name: 'rewatcher' },
    'optout-token': { id: 5, name: 'optout' },
    'repeat-token': { id: 6, name: 'repeater' },
    'watching-token': { id: 7, name: 'watcher' },
    // A VIP of the seat limit (hexlux's real AniList id)
    'vip-token': { id: 6649000, name: 'hexlux' },
};
const MEDIA = {
    101: { id: 101, episodes: 28, format: 'TV', seasonYear: 2023, synonyms: ['Frieren'], title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", userPreferred: 'Sousou no Frieren' }, coverImage: { large: 'https://s4.anilist.co/frieren.jpg' } },
    102: { id: 102, episodes: 23, format: 'TV', seasonYear: 2023, synonyms: [], title: { romaji: 'Jujutsu Kaisen 2nd Season', english: 'JUJUTSU KAISEN Season 2', userPreferred: 'Jujutsu Kaisen 2nd Season' }, coverImage: { large: 'https://s4.anilist.co/jjk2.jpg' } },
    103: { id: 103, episodes: 12, format: 'TV', seasonYear: 2016, synonyms: [], title: { romaji: 'Mob Psycho 100', english: 'Mob Psycho 100', userPreferred: 'Mob Psycho 100' }, coverImage: { large: 'https://s4.anilist.co/mob.jpg' } },
    104: { id: 104, episodes: 1, format: 'MOVIE', seasonYear: 2016, synonyms: [], title: { romaji: 'Kimi no Na wa.', english: 'Your Name.', userPreferred: 'Kimi no Na wa.' }, coverImage: { large: 'https://s4.anilist.co/yourname.jpg' } },
    201: { id: 201, episodes: 1, format: 'MOVIE', seasonYear: 2022, synonyms: [], title: { romaji: 'Suzume no Tojimari', english: 'Suzume', userPreferred: 'Suzume no Tojimari' }, coverImage: { large: 'https://s4.anilist.co/suzume.jpg' } },
    // Same name twice: the 2020 pilot and its 2026 series, told apart by "(2026)" (seasonYear is null for ONAs)
    401: { id: 401, episodes: 1, format: 'ONA', seasonYear: null, startDate: { year: 2020 }, synonyms: [], title: { romaji: 'Jiyi Guanli Ju', english: 'False Memory', userPreferred: 'Jiyi Guanli Ju' }, coverImage: { large: 'https://s4.anilist.co/fm2020.jpg' } },
    402: { id: 402, episodes: 7, format: 'ONA', seasonYear: null, startDate: { year: 2026 }, synonyms: [], title: { romaji: 'Jiyi Guanli Ju (2026)', english: 'False Memory (2026)', userPreferred: 'Jiyi Guanli Ju (2026)' }, coverImage: { large: 'https://s4.anilist.co/fm2026.jpg' } },
    300: { id: 300, episodes: 12, format: 'TV', seasonYear: 2024, synonyms: [], title: { romaji: 'Party Show', english: 'Party Show', userPreferred: 'Party Show' }, coverImage: { large: 'https://s4.anilist.co/party.jpg' } },
};
const LONG_AGO = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
const lists = {
    1: {
        101: { status: 'CURRENT', progress: 4, repeat: 0, updatedAt: LONG_AGO },
        102: { status: 'PLANNING', progress: 0, repeat: 0, updatedAt: LONG_AGO },
        103: { status: 'COMPLETED', progress: 12, repeat: 0, updatedAt: LONG_AGO },
        104: { status: 'COMPLETED', progress: 1, repeat: 0, updatedAt: LONG_AGO },
        401: { status: 'COMPLETED', progress: 1, repeat: 0, updatedAt: LONG_AGO },
    },
    2: { 300: { status: 'CURRENT', progress: 1, repeat: 0, updatedAt: LONG_AGO } },
    3: {},
    4: { 300: { status: 'COMPLETED', progress: 12, repeat: 1, updatedAt: LONG_AGO } },
    5: { 300: { status: 'COMPLETED', progress: 12, repeat: 0, updatedAt: LONG_AGO } },
    // Already rewatching / watching for the first time, to check a mixed party
    6: { 300: { status: 'REPEATING', progress: 3, repeat: 1, updatedAt: LONG_AGO } },
    7: { 300: { status: 'CURRENT', progress: 2, repeat: 0, updatedAt: LONG_AGO } },
};
// Released A (2010), C (2012), B (2015); the story starts with B, a prequel made later. 804 is a music video,
// 805 a side story: neither is a part. 811 -> 812 come out in the order they are told
const part = (id, year, edges) => ({ id, format: id === 804 ? 'MUSIC' : 'TV', status: 'FINISHED', episodes: 12, startDate: { year, month: 4, day: 1 },
    title: { userPreferred: `Part ${id}`, romaji: `Part ${id}`, english: null, native: null }, coverImage: { medium: '' },
    relations: { edges: edges.map(([relationType, id2]) => ({ relationType, node: { id: id2, type: 'ANIME', format: id2 === 804 ? 'MUSIC' : 'TV' } })) } });
const FRANCHISE = {
    801: part(801, 2010, [['SEQUEL', 803], ['PREQUEL', 802], ['OTHER', 804], ['SIDE_STORY', 805]]),
    802: part(802, 2015, [['SEQUEL', 801]]),
    803: part(803, 2012, [['PREQUEL', 801]]),
    804: part(804, 2011, [['SEQUEL', 801]]),
    805: part(805, 2011, [['PARENT', 801]]),
    811: part(811, 2018, [['SEQUEL', 812]]),
    812: part(812, 2020, [['PREQUEL', 811]]),
};
const log = [];
let blocked = false;

function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

let themeAsks = 0;
let shazamAsks = 0;
let shazamBusy = false;
http.createServer((req, res) => {
    if (req.url === '/__state') return send(res, 200, { lists, log });
    // AnimeThemes and Shazam stand-ins for api/songs.js
    if (req.url.startsWith('/animethemes/anime?')) {
        themeAsks++;
        if (!req.url.includes('external_id]=101&')) return send(res, 200, { anime: [] });
        return send(res, 200, { anime: [{ animethemes: [
            { type: 'ED', sequence: 1, song: { title: 'End Song', artists: [{ name: 'Singer B' }] }, animethemeentries: [{ episodes: '1-12' }] },
            { type: 'OP', sequence: 1, song: { title: 'First Song', artists: [{ name: 'Singer A', artistsong: { as: 'Character' } }] }, animethemeentries: [{ episodes: '1-12' }, { episodes: '1-12' }] },
            { type: 'IN', sequence: 1, song: { title: 'Insert' }, animethemeentries: [] },
        ] }] });
    }
    if (req.url === '/__themeasks') return send(res, 200, { asks: themeAsks });
    if (req.url === '/__shazam429') { shazamBusy = true; return send(res, 200, {}); }
    if (req.url.startsWith('/shazam/discovery/v5/')) {
        shazamAsks++;
        if (shazamBusy) { shazamBusy = false; res.writeHead(429, { 'Retry-After': '120' }); return res.end(); }
        return send(res, 200, { matches: [{}], track: { title: 'buddy', subtitle: 'kensuke ushio', url: 'https://www.shazam.com/track/1/buddy',
            images: { coverart: 'https://is1-ssl.mzstatic.com/image/a.jpg' },
            hub: { options: [{ actions: [{ uri: 'intent://music.apple.com/us/album/buddy/1?i=2#Intent;scheme=https;end' }] }] } } });
    }
    if (req.url === '/__shazamasks') return send(res, 200, { asks: shazamAsks });
    // TMDB stand-in for api/fallback.js: one show (two AniList parts in season 1, see run.sh), one film
    if (req.url.startsWith('/tmdb/')) {
        if (req.headers.authorization !== 'Bearer test-tmdb') return send(res, 401, {});
        const u = new URL(req.url, 'http://x');
        const genres = [{ name: 'Animation' }, { name: 'Action & Adventure' }];
        if (u.pathname === '/tmdb/tv/7001') return send(res, 200, { name: 'Frieren', original_name: '葬送のフリーレン', overview: 'The show', poster_path: '/show.jpg',
            backdrop_path: '/back.jpg', first_air_date: '2023-09-29', status: 'Ended', genres, vote_average: 8.8, vote_count: 500, episode_run_time: [24] });
        if (u.pathname === '/tmdb/tv/7001/season/1') return send(res, 200, { name: 'Season 1', overview: '', poster_path: '/s1.jpg', air_date: '2023-09-29',
            episodes: Array.from({ length: 28 }, (_, i) => ({ episode_number: i + 1, air_date: '2023-10-01', runtime: 24 })) });
        if (u.pathname === '/tmdb/movie/9001') return send(res, 200, { title: 'Mob Film', original_title: 'モブ', overview: 'A film', poster_path: '/m.jpg',
            release_date: '2016-07-11', status: 'Released', runtime: 100, genres: [{ name: 'Comedy' }], vote_average: 7, vote_count: 5 });
        if (u.pathname === '/tmdb/search/multi') return send(res, 200, { results: [
            { id: 7001, media_type: 'tv', genre_ids: [16, 10759], name: 'Frieren', original_name: '葬送のフリーレン', poster_path: '/show.jpg', first_air_date: '2023-09-29', vote_average: 8.8, vote_count: 500 },
            { id: 5, media_type: 'tv', genre_ids: [18], name: 'Frieren (live action)' },
            { id: 6, media_type: 'tv', genre_ids: [16], name: 'Unmapped cartoon' },
        ] });
        return send(res, 404, {});
    }
    if (req.url === '/__block') { blocked = true; return send(res, 200, { blocked }); }
    if (req.url === '/__unblock') { blocked = false; return send(res, 200, { blocked }); }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
        if (blocked) return send(res, 403, { errors: [{ message: 'temporarily disabled', status: 403 }] });
        let q;
        try { q = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(res, 400, {}); }
        const token = String(req.headers.authorization || '').replace('Bearer ', '');
        const viewer = USERS[token] || null;
        const v = q.variables || {};
        const text = q.query;
        log.push({ at: Date.now(), auth: viewer ? viewer.name : null, op: text.match(/(SaveMediaListEntry|MediaListCollection|MediaList|Viewer|Page|Media)\b/)[1], v });

        if (token && !viewer) return send(res, 401, { errors: [{ message: 'Invalid token', status: 401 }] });
        // Watch order (api/watchorder.js): parts of a franchise by id, with their prequel/sequel links
        if (/relationType\(version: 2\)/.test(text) && Array.isArray(v.ids)) {
            return send(res, 200, { data: { Page: { media: v.ids.filter(id => FRANCHISE[id]).map(id => FRANCHISE[id]) } } });
        }
        // Whom someone follows (api/server.js followingOf): "me" and "guest" follow each other, "host" nobody
        if (/following\(userId/.test(text)) {
            const following = { 1: [{ id: 2, name: 'guest', avatar: { medium: 'https://s4.anilist.co/g.png' } }], 2: [{ id: 1, name: 'me', avatar: { medium: 'https://s4.anilist.co/a.png' } }] }[v.userId] || [];
            return send(res, 200, { data: { Page: { pageInfo: { hasNextPage: false }, following } } });
        }
        if (/Viewer/.test(text)) return viewer ? send(res, 200, { data: { Viewer: { ...viewer, avatar: { medium: 'https://s4.anilist.co/a.png' } } } }) : send(res, 400, { errors: [{ message: 'Unauthorized', status: 401 }] });
        if (/SaveMediaListEntry/.test(text)) {
            if (!viewer) return send(res, 400, { errors: [{ message: 'Unauthorized', status: 401 }] });
            const list = lists[viewer.id];
            const e = list[v.mediaId] || { status: 'CURRENT', progress: 0, repeat: 0 };
            if (v.progress !== undefined) e.progress = v.progress;
            if (v.status) e.status = v.status;
            if (v.repeat !== undefined) e.repeat = v.repeat;
            if (v.startedAt) e.startedAt = v.startedAt;
            e.updatedAt = Math.floor(Date.now() / 1000);
            list[v.mediaId] = e;
            return send(res, 200, { data: { SaveMediaListEntry: { progress: e.progress, status: e.status, repeat: e.repeat } } });
        }
        if (/MediaListCollection/.test(text) && v.name) {
            // The landing page's DNA try (by name): one public list, one private, the rest unknown
            if (v.name === 'private-one') return send(res, 404, { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 404 }] });
            if (v.name !== 'Viewer2') return send(res, 404, { data: { MediaListCollection: null }, errors: [{ message: 'User not found', status: 404 }] });
            const entries = Object.values(MEDIA).map(m => ({ status: 'COMPLETED', score: 80, progress: m.episodes || 1, repeat: 0, media: m }));
            return send(res, 200, { data: { MediaListCollection: { user: { name: 'Viewer2' }, lists: [{ entries }] } } });
        }
        if (/MediaListCollection/.test(text)) {
            const list = lists[v.userId] || {};
            const entries = Object.entries(list).map(([id, e]) => ({ status: e.status, progress: e.progress, media: MEDIA[id] }));
            return send(res, 200, { data: { MediaListCollection: { lists: [{ entries }] } } });
        }
        if (/MediaList\(/.test(text)) {
            const e = (lists[v.userId] || {})[v.mediaId];
            if (!e) return send(res, 404, { data: { MediaList: null }, errors: [{ message: 'Not Found.', status: 404 }] });
            return send(res, 200, { data: { MediaList: { status: e.status, progress: e.progress, repeat: e.repeat || 0, updatedAt: e.updatedAt, startedAt: e.startedAt || { year: null }, media: { episodes: MEDIA[v.mediaId].episodes } } } });
        }
        if (/Page/.test(text)) {
            const s = String(v.search || '').toLowerCase();
            const media = Object.values(MEDIA).filter(m => [m.title.romaji, m.title.english].some(t => t.toLowerCase().includes(s.split(' ')[0])));
            return send(res, 200, { data: { Page: { media } } });
        }
        if (/Media\(/.test(text)) return send(res, 200, { data: { Media: { episodes: (MEDIA[v.id] || {}).episodes || null } } });
        send(res, 400, { errors: [{ message: 'unknown query' }] });
    });
}).listen(3099, () => console.log('mock anilist on 3099'));
