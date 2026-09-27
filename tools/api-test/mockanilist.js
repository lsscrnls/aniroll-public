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
const log = [];
let blocked = false;

function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
    if (req.url === '/__state') return send(res, 200, { lists, log });
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
