const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const dnsCallback = require('dns');
const net = require('net');

const DATA_DIR = path.join(__dirname, 'data');
const PORT = 3001;
const ALLOWED_ORIGIN = 'https://aniroll.hxlx.de';
const VIEWER_TTL_MS = 10 * 60 * 1000;
const ANILIST_URL = process.env.ANILIST_URL || 'https://graphql.anilist.co';

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Every data file is written to a temporary file first and then renamed over the old one.
// A write that stops halfway (restart, full disk) leaves the old file intact instead of half
// a JSON document. mode: file permissions, e.g. 0o600 for anything holding a secret.
function writeFileAtomic(file, text, mode) {
    ensureDataDir();
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never created */ }
        throw e;
    }
}

function writeJson(file, data, { mode, pretty = true } = {}) {
    writeFileAtomic(file, JSON.stringify(data, null, pretty ? 2 : 0), mode);
}

// A missing file is empty. A file that cannot be parsed is moved aside, not treated as empty:
// the next save would otherwise overwrite it and every stored token or webhook would be gone.
function readJson(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (e) {
        if (e.code !== 'ENOENT') console.error(`cannot read ${path.basename(file)}: ${e.code}`);
        return {};
    }
    try {
        return JSON.parse(text);
    } catch {
        const aside = `${file}.corrupt-${Date.now()}`;
        try { fs.renameSync(file, aside); } catch { /* keep going with an empty store */ }
        console.error(`${path.basename(file)} was unreadable, moved to ${path.basename(aside)} - restore it from there or the backup`);
        return {};
    }
}

// ===== Jellyfin config, stored per AniList account =====
// Holds the user's own Jellyfin API key, so the connection follows the account to any
// device instead of living in one browser. File is written with owner-only permissions.
const JF_FILE = path.join(__dirname, 'data', 'jellyfin.json');

// ===== Share pages (/a/<id>) =====
// Link previews (Discord, Twitter, ...) never see the part after "#", so a shared anime
// needs a real URL that the server answers. This server is blocked from querying AniList,
// so the browser publishes the few display fields when someone shares a title and we only
// keep them. Unknown ids fall back to the generic AniRoll preview.
const SHARE_FILE = path.join(__dirname, 'data', 'share.json');
const SHARE_MAX = 3000;
const SITE = 'https://aniroll.hxlx.de';

function loadShare() {
    return readJson(SHARE_FILE);
}

function saveShare(all) {
    const ids = Object.keys(all);
    if (ids.length > SHARE_MAX) {
        // Drop the least recently shared entries
        ids.sort((a, b) => (all[a].savedAt || 0) - (all[b].savedAt || 0))
            .slice(0, ids.length - SHARE_MAX)
            .forEach(id => delete all[id]);
    }
    writeJson(SHARE_FILE, all, { pretty: false });
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sharePage(entry, id) {
    const route = entry && entry.type === 'MANGA' ? 'manga' : 'anime';
    const target = id ? `/#/${route}/${id}` : '/';
    const title = entry ? `${entry.title} · AniRoll` : 'AniRoll';
    const description = entry
        ? entry.description
        : 'Your AniList with watch parties, a random pick for what to watch next, recommendations and an airing calendar.';
    // Portrait covers look better as a thumbnail than as a stretched banner
    const image = entry && entry.cover ? entry.cover : `${SITE}/og-image-v3.jpg`;
    const card = entry && entry.cover ? 'summary' : 'summary_large_image';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta property="og:site_name" content="AniRoll">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(entry ? entry.title : 'AniRoll')}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE}${id ? `/a/${id}` : '/'}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="${card}">
<meta name="twitter:title" content="${escapeHtml(entry ? entry.title : 'AniRoll')}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta name="theme-color" content="#d13438">
<meta http-equiv="refresh" content="0; url=${target}">
<style>body{background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}a{color:#d13438}</style>
</head>
<body>
<p>Opening <a href="${target}">${escapeHtml(entry ? entry.title : 'AniRoll')}</a> …</p>
</body>
</html>`;
}

function html(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(body);
}

// Maintenance switch: a file every client polls, so all browsers and devices go quiet at
// once (background polling lives in the browsers, not here). Written by scripts/aniroll-maintenance.sh.
const MAINT_FILE = path.join(__dirname, 'data', 'maintenance.json');

function readMaintenance() {
    try {
        const m = JSON.parse(fs.readFileSync(MAINT_FILE, 'utf8'));
        return m && m.maintenance ? m : null;
    } catch { return null; }
}

function loadJellyfin() {
    return readJson(JF_FILE);
}

function saveJellyfin(all) {
    writeJson(JF_FILE, all, { mode: 0o600 });
}

// The Jellyfin API key is the user's own credential, so it is encrypted at rest: a copy of
// the data volume (backup, snapshot) is useless without JF_SECRET, which lives outside it.
// There is no fallback key next to the data: without JF_SECRET the server does not start.
const JF_SECRET = process.env.JF_SECRET || '';
if (JF_SECRET.length < 32) {
    console.error('JF_SECRET must be set (32+ characters): it encrypts the stored Jellyfin keys and AniList tokens');
    process.exit(1);
}
const jfKey = crypto.createHash('sha256').update(JF_SECRET).digest();
const jfSecret = () => jfKey;

function encryptSecret(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', jfSecret(), iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decryptSecret(payload) {
    const [ivB64, tagB64, dataB64] = String(payload).split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', jfSecret(), Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        return null; // wrong or rotated key
    }
}

// One account's entry with the API key decrypted; older plaintext entries are migrated
function jfEntry(all, key) {
    const raw = all[key];
    if (!raw) return null;

    if (raw.apiKey && !raw.apiKeyEnc) {
        raw.apiKeyEnc = encryptSecret(raw.apiKey);
        delete raw.apiKey;
        saveJellyfin(all);
    }

    const apiKey = raw.apiKeyEnc ? decryptSecret(raw.apiKeyEnc) : null;
    if (!apiKey) return { broken: true };
    const { apiKeyEnc, ...rest } = raw;
    return { ...rest, apiKey };
}

// ===== Background sync: AniRoll updates AniList while the user's tab is closed =====
// Only with the user's consent (Settings, or the dialog when joining a Watch Party). The
// AniList token is encrypted exactly like the Jellyfin key. AniList blocks this server now
// and then, so every failed write is kept and retried — and the browser catches up anyway.
const TOKEN_FILE = path.join(__dirname, 'data', 'tokens.json');
const HOOK_FILE = path.join(__dirname, 'data', 'jfhooks.json');
const JF_PENDING_FILE = path.join(__dirname, 'data', 'jfpending.json');
// Override only for the local test run (tools/api-test), which needs more than a real user
const SERVER_BUDGET_PER_MIN = Number(process.env.ANILIST_BUDGET_PER_MIN) || 30;
const ANILIST_PAUSE_MS = 5 * 60 * 1000;

function loadPrivate(file) {
    return readJson(file);
}

function savePrivate(file, all) {
    writeJson(file, all, { mode: 0o600 });
}

function bearerToken(req) {
    const auth = String(req.headers['authorization'] || '');
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function storedToken(userId) {
    const entry = loadPrivate(TOKEN_FILE)[String(userId)];
    return entry ? decryptSecret(entry.tokenEnc) : null;
}

function forgetToken(userId) {
    const all = loadPrivate(TOKEN_FILE);
    if (!all[String(userId)]) return;
    delete all[String(userId)];
    savePrivate(TOKEN_FILE, all);
}

class SyncError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code; // no-token | invalid | unreachable | busy | private | error
    }
}

let serverCalls = [];
let anilistPausedUntil = 0;

// userId: act as that user (needs their stored token); null: anonymous read
async function anilist(query, variables, userId = null) {
    const token = userId ? storedToken(userId) : null;
    if (userId && !token) throw new SyncError('no-token');
    if (Date.now() < anilistPausedUntil) throw new SyncError('unreachable');
    const now = Date.now();
    serverCalls = serverCalls.filter(t => now - t < 60000);
    if (serverCalls.length >= SERVER_BUDGET_PER_MIN) throw new SyncError('busy');
    serverCalls.push(now);

    let res, body;
    try {
        res = await fetch(ANILIST_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
            },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(8000),
        });
        body = await res.json().catch(() => null);
    } catch {
        throw new SyncError('unreachable');
    }
    const errors = (body && body.errors) || [];
    if (res.status === 401 || errors.some(e => e.status === 401 || /invalid token/i.test(e.message || ''))) {
        if (userId) forgetToken(userId);
        throw new SyncError('invalid');
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500 || !body) {
        anilistPausedUntil = Date.now() + ANILIST_PAUSE_MS;
        throw new SyncError('unreachable');
    }
    return body; // { data, errors } — a 404 error just means "no list entry"
}

function fuzzyToday() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

const listCache = new Map(); // userId -> { at, entries }

const REWATCH_GAP_MS = 12 * 60 * 60 * 1000;

// Moves one list entry to `target`: forward only, capped at the episode count.
// Rewatches (`rewatch`: 'party' when watching along with a party, 'jellyfin' for playback):
//  - REPEATING moves forward; the last episode completes it and counts one rewatch
//  - COMPLETED: a party turns it into REPEATING at the host's episode. Jellyfin only on episode 1
//    (one favourite episode must not start a rewatch); a movie or one-episode title watched
//    again counts a rewatch, at most once per 12h (a resumed session must not count twice)
async function moveForward(userId, mediaId, target, { rewatch = null } = {}) {
    const read = await anilist(`query ($userId: Int, $mediaId: Int) {
        MediaList(userId: $userId, mediaId: $mediaId) { status progress repeat updatedAt startedAt { year } media { episodes } }
    }`, { userId, mediaId }, userId);
    const entry = read.data && read.data.MediaList;
    const errors = read.errors || [];
    if (!entry && errors.some(e => e.status !== 404)) throw new SyncError('error', errors[0].message);

    let episodes = entry && entry.media ? entry.media.episodes : null;
    if (!entry) {
        const m = await anilist('query ($id: Int) { Media(id: $id) { episodes } }', { id: mediaId });
        episodes = m.data && m.data.Media ? m.data.Media.episodes : null;
    }
    const capped = episodes ? Math.min(target, episodes) : target;
    const current = entry ? entry.progress || 0 : 0;
    const vars = { mediaId };

    if (entry && entry.status === 'REPEATING') {
        if (capped <= current) return { progress: current, changed: false };
        vars.progress = capped;
        if (episodes && capped >= episodes) {
            vars.status = 'COMPLETED';
            vars.repeat = (entry.repeat || 0) + 1;
        }
    } else if (entry && entry.status === 'COMPLETED' && rewatch) {
        const recent = entry.updatedAt && Date.now() - entry.updatedAt * 1000 < REWATCH_GAP_MS;
        if (episodes === 1) {
            if (recent) return { progress: current, changed: false, reason: 'completed' };
            vars.repeat = (entry.repeat || 0) + 1;
        } else if (rewatch === 'party' ? (!episodes || capped < episodes) : capped === 1) {
            vars.status = 'REPEATING';
            vars.progress = capped;
        } else {
            return { progress: current, changed: false, reason: 'completed' };
        }
    } else {
        const completed = entry && entry.status === 'COMPLETED';
        if (capped <= current) return { progress: current, changed: false, reason: completed ? 'completed' : null };
        vars.progress = capped;
        if (episodes && capped >= episodes) {
            vars.status = 'COMPLETED';
            vars.completedAt = fuzzyToday();
        } else if (!entry || entry.status !== 'CURRENT') {
            vars.status = 'CURRENT';
        }
        if (!entry || !entry.startedAt || !entry.startedAt.year) vars.startedAt = fuzzyToday();
    }

    const write = await anilist(`mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $repeat: Int,
            $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, repeat: $repeat,
            startedAt: $startedAt, completedAt: $completedAt) { progress status repeat }
    }`, vars, userId);
    const saved = write.data && write.data.SaveMediaListEntry;
    if (!saved) throw new SyncError('error', ((write.errors || [])[0] || {}).message || 'Write failed');
    // Matching only needs which shows are on the list, so re-read it only when one was added
    if (!entry) listCache.delete(String(userId));
    return { progress: saved.progress, status: saved.status, repeat: saved.repeat, changed: true, rewatch: saved.status === 'REPEATING' || vars.repeat !== undefined };
}

// ===== Jellyfin webhook: live "now watching" and instant tracking =====
// The Jellyfin Webhook plugin posts playback events here. The secret in the URL identifies
// the AniList account; nothing else is taken on trust from the request.
const TRACK_AT = 0.9;
const HOOK_TEMPLATE = '{"event":"{{NotificationType}}","itemId":"{{ItemId}}","type":"{{ItemType}}",'
    + '"name":"{{Name}}","series":"{{SeriesName}}","season":"{{SeasonNumber}}","episode":"{{EpisodeNumber}}",'
    + '"episodeEnd":"{{EpisodeNumberEnd}}","year":"{{Year}}","position":"{{PlaybackPositionTicks}}",'
    + '"runtime":"{{RunTimeTicks}}","paused":"{{IsPaused}}","completed":"{{PlayedToCompletion}}",'
    + '"device":"{{DeviceName}}","deviceId":"{{DeviceId}}","client":"{{ClientName}}"}';
const MEDIA_FIELDS = 'id episodes format seasonYear startDate { year } synonyms title { romaji english native userPreferred } coverImage { large }';

const nowPlaying = new Map(); // userId -> Map(deviceId|itemId -> session)
const jfRecent = new Map(); // userId -> last tracked items
const hookSeen = new Map(); // userId -> time of the last event
const hookHits = new Map();

function hookOwner(secret) {
    if (!/^[a-f0-9]{48}$/.test(secret)) return null;
    const entry = loadPrivate(HOOK_FILE)[secret];
    return entry ? entry.userId : null;
}

function hookOf(userId) {
    const all = loadPrivate(HOOK_FILE);
    return Object.keys(all).find(secret => all[secret].userId === userId) || null;
}

function hookInfo(userId) {
    const secret = hookOf(userId);
    return {
        enabled: !!secret,
        secret: secret || null,
        url: secret ? `${SITE}/api/jellyfin/hook/${secret}` : null,
        template: HOOK_TEMPLATE,
        background: !!loadPrivate(TOKEN_FILE)[String(userId)],
        lastEventAt: hookSeen.get(userId) || null,
    };
}

// Handlebars in the plugin HTML-escapes every value
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(value) {
    return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, code) => {
        const c = code.toLowerCase();
        if (c.startsWith('#x')) return String.fromCodePoint(parseInt(c.slice(2), 16));
        if (c.startsWith('#')) return String.fromCodePoint(parseInt(c.slice(1), 10));
        return NAMED_ENTITIES[c] || m;
    });
}

function hookField(body, name, max = 300) {
    return decodeEntities(str(body[name], max * 3)).trim().slice(0, max);
}

const normTitle = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// "Mob Psycho 100 II" -> { base: 'mobpsycho100', season: 2 }: AniList names some sequels with a Roman numeral
// at the end, Jellyfin keeps them as season 2 of one series. II to X in capitals only, so a word never counts
const ROMAN_SEASONS = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
// "Jujutsu Kaisen 2nd Season" -> { base: 'jujutsukaisen', season: 2 }  (same rule as js/jellyfin.js)
function splitSeason(title) {
    const t = String(title || '');
    const m = t.match(/(?:\b(\d+)(?:st|nd|rd|th)\s+season\b|\bseason\s+(\d+)\b|\bpart\s+(\d+)\b|\bS(\d+)\b)/i);
    if (m) return { base: normTitle(t.slice(0, m.index)), season: Number(m[1] || m[2] || m[3] || m[4]) };
    const r = t.match(/\s(II|III|IV|V|VI|VII|VIII|IX|X)$/);
    if (r) return { base: normTitle(t.slice(0, r.index)), season: ROMAN_SEASONS[r[1]] };
    return { base: normTitle(t), season: 1 };
}

// "False Memory (2026)" -> { title: 'False Memory', year: 2026 }. AniList adds the year when
// two entries share a name; the Jellyfin folder may or may not carry it.
function splitYear(title) {
    const m = String(title || '').match(/^(.*\S)\s*\((\d{4})\)$/);
    return m ? { title: m[1], year: Number(m[2]) } : { title: String(title || ''), year: null };
}

const mediaYear = (media) => media.seasonYear || (media.startDate && media.startDate.year) || null;
const nearYear = (a, b) => !a || !b || Math.abs(a - b) <= 1;

// Strict on purpose: a wrong guess would move someone's list forward on the wrong show.
// A year in either title has to agree; otherwise the name alone decides, and matchItem
// picks between entries that share a name.
function mediaMatches(media, info) {
    const titles = [media.title && media.title.romaji, media.title && media.title.english,
        media.title && media.title.userPreferred, ...(media.synonyms || [])].filter(Boolean).map(splitYear);
    if (info.type === 'Movie') {
        const movie = splitYear(info.name);
        const name = normTitle(movie.title);
        const year = movie.year || info.year;
        return media.format === 'MOVIE' && nearYear(year, mediaYear(media))
            && titles.some(t => nearYear(t.year, year) && normTitle(t.title) === name);
    }
    const show = splitYear(info.series);
    const series = normTitle(show.title);
    const season = info.season === null || info.season === undefined ? 1 : info.season;
    if (!series || season === 0) return false; // specials never count
    return titles.some(({ title: t, year }) => {
        if (!nearYear(year, show.year || info.year)) return false;
        const wanted = splitSeason(t);
        if (normTitle(t) === series) return season === 1 || season === wanted.season;
        // Jellyfin keeps one series with seasons, AniList one entry per season
        return wanted.season > 1 && wanted.base === series && season === wanted.season;
    });
}

// Several entries can share a name ("False Memory" 2020 with 1 episode, its 2026 sequel with 7):
// the episode has to fit, then the year decides. Either one failing makes the entry a doubtful
// pick (negative), so matchItem looks for a better one before settling for it.
function matchFit(media, info) {
    let fit = 0;
    const episode = info.episodeEnd || info.episode;
    if (info.type !== 'Movie' && episode && media.episodes) fit += episode <= media.episodes ? 2 : -4;
    const year = splitYear(info.type === 'Movie' ? info.name : info.series).year || info.year;
    if (year && mediaYear(media)) fit += nearYear(year, mediaYear(media)) ? 1 : -3;
    return fit;
}

// Neither the episode nor the year fits: certainly another show of the same name
const WRONG_SHOW = -7;

const bestFit = (candidates, info) => candidates
    .map((c, i) => ({ ...c, fit: matchFit(c.media, info), i }))
    .filter(c => c.fit > WRONG_SHOW)
    .sort((a, b) => b.fit - a.fit || a.i - b.i)[0] || null;

const STATUS_RANK = { CURRENT: 0, REPEATING: 0, PLANNING: 1, PAUSED: 1, COMPLETED: 2, DROPPED: 2 };

async function listEntries(userId) {
    const hit = listCache.get(String(userId));
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.entries;
    const body = await anilist(`query ($userId: Int) {
        MediaListCollection(userId: $userId, type: ANIME) { lists { entries { status progress media { ${MEDIA_FIELDS} } } } }
    }`, { userId }, storedToken(userId) ? userId : null);
    const lists = body.data && body.data.MediaListCollection && body.data.MediaListCollection.lists;
    if (!lists) throw new SyncError('private', ((body.errors || [])[0] || {}).message || 'List not readable');
    const entries = lists.flatMap(l => l.entries || [])
        .sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3));
    listCache.set(String(userId), { at: Date.now(), entries });
    return entries;
}

function matchResult(media, entry) {
    return {
        mediaId: media.id,
        title: (media.title && (media.title.userPreferred || media.title.romaji)) || '',
        cover: (media.coverImage && media.coverImage.large) || '',
        episodes: media.episodes || null,
        onList: !!entry,
    };
}

// The user's own list first; a show not on it yet — or one whose entry does not fit the
// episode or year — is looked up (exact title only)
async function matchItem(userId, info) {
    const entries = await listEntries(userId);
    const own = entries.filter(e => e.media && mediaMatches(e.media, info)).map(e => ({ media: e.media, entry: e }));
    let best = bestFit(own, info);
    if (best && best.fit >= 0) return matchResult(best.media, best.entry);

    const searches = info.type === 'Movie'
        ? [splitYear(info.name).title]
        : [splitYear(info.series).title, info.season > 1 ? `${splitYear(info.series).title} season ${info.season}` : null];
    const found = [...own];
    for (const search of searches.filter(Boolean)) {
        const body = await anilist(`query ($search: String) {
            Page(perPage: 10) { media(search: $search, type: ANIME) { ${MEDIA_FIELDS} } }
        }`, { search });
        for (const m of (body.data && body.data.Page && body.data.Page.media) || []) {
            if (!mediaMatches(m, info) || found.some(c => c.media.id === m.id)) continue;
            found.push({ media: m, entry: entries.find(e => e.media && e.media.id === m.id) || null });
        }
        best = bestFit(found, info);
        if (best && best.fit >= 0) break;
    }
    return best ? matchResult(best.media, best.entry) : { error: 'not-found' };
}

function userSessions(userId) {
    let sessions = nowPlaying.get(userId);
    if (!sessions) {
        sessions = new Map();
        nowPlaying.set(userId, sessions);
    }
    const now = Date.now();
    for (const [key, s] of sessions) {
        const idle = now - s.updatedAt;
        if ((s.stoppedAt && now - s.stoppedAt > 3 * 60 * 1000)
            || (!s.paused && !s.stoppedAt && idle > 2 * 60 * 1000)
            || idle > 45 * 60 * 1000) sessions.delete(key);
    }
    return sessions;
}

function pushRecent(userId, item) {
    jfRecent.set(userId, [item, ...(jfRecent.get(userId) || [])].slice(0, 10));
}

function addPending(userId, item) {
    const all = loadPrivate(JF_PENDING_FILE);
    const key = String(userId);
    // A later episode of the same show replaces the earlier one
    const list = (all[key] || []).filter(p => !(item.mediaId && p.mediaId === item.mediaId && p.target <= item.target));
    list.push({ id: crypto.randomBytes(6).toString('hex'), at: Date.now(), ...item });
    all[key] = list.slice(-50);
    savePrivate(JF_PENDING_FILE, all);
}

function removePending(userId, ids) {
    const all = loadPrivate(JF_PENDING_FILE);
    const key = String(userId);
    if (!all[key]) return;
    all[key] = all[key].filter(p => !ids.includes(p.id));
    if (!all[key].length) delete all[key];
    savePrivate(JF_PENDING_FILE, all);
}

function updatePending(userId, id, patch) {
    const all = loadPrivate(JF_PENDING_FILE);
    const item = (all[String(userId)] || []).find(p => p.id === id);
    if (!item) return;
    Object.assign(item, patch);
    savePrivate(JF_PENDING_FILE, all);
}

function pickInfo(s) {
    return { type: s.type, name: s.name, series: s.series, season: s.season, episode: s.episode, episodeEnd: s.episodeEnd, year: s.year };
}

async function resolveMatch(userId, session) {
    if (session.match && (session.match.mediaId || session.match.error === 'not-found')) return session.match;
    // A failed lookup (AniList busy) is retried at most once a minute
    if (!session.matching && session.matchTriedAt && Date.now() - session.matchTriedAt < 60000) return session.match || null;
    if (!session.matching) {
        session.matchTriedAt = Date.now();
        session.matching = matchItem(userId, pickInfo(session))
            .catch(e => ({ error: e.code || 'error' }))
            .then(m => { session.match = m; session.matching = null; return m; });
    }
    return session.matching;
}

async function trackSession(userId, session) {
    const target = session.type === 'Movie' ? 1 : (session.episodeEnd || session.episode);
    if (!target) return;
    session.tracked = 'saving';
    const match = session.match && session.match.mediaId ? session.match : null;
    if (!match) {
        if (session.match && session.match.error === 'not-found') {
            session.tracked = 'unmatched';
            pushRecent(userId, { title: session.series || session.name, episode: target, type: session.type, status: 'unmatched', at: Date.now() });
            return;
        }
        // Lookup failed for now — keep the raw item, the retry loop resolves it later
        session.tracked = 'pending';
        addPending(userId, { mediaId: null, target, title: session.series || session.name, info: pickInfo(session) });
        pushRecent(userId, { title: session.series || session.name, episode: target, type: session.type, status: 'pending', at: Date.now() });
        return;
    }
    const base = { title: match.title, mediaId: match.mediaId, cover: match.cover, episode: target, type: session.type };
    try {
        const r = await moveForward(userId, match.mediaId, target, { rewatch: 'jellyfin' });
        session.tracked = r.changed ? 'saved' : (r.reason === 'completed' ? 'completed' : 'already');
        session.rewatch = !!r.rewatch;
        // entryStatus/repeat let the Watch Party follow without reading AniList again
        pushRecent(userId, { ...base, status: session.tracked, rewatch: session.rewatch, progress: r.progress,
            entryStatus: r.status, repeat: r.repeat, at: Date.now() });
    } catch (e) {
        session.tracked = 'pending';
        addPending(userId, { mediaId: match.mediaId, target, title: match.title, type: session.type });
        pushRecent(userId, { ...base, status: e.code === 'no-token' || e.code === 'invalid' ? 'waiting' : 'pending', at: Date.now() });
    }
}

async function handleJellyfinEvent(userId, body) {
    const event = hookField(body, 'event', 40);
    const type = hookField(body, 'type', 20);
    const itemId = hookField(body, 'itemId', 64);
    if (!/^Playback(Start|Progress|Stop)$/.test(event) || !['Episode', 'Movie'].includes(type) || !itemId) return;
    hookSeen.set(userId, Date.now());

    const num = (name) => {
        const n = parseInt(hookField(body, name, 20), 10);
        return Number.isFinite(n) ? n : null;
    };
    const sessions = userSessions(userId);
    const key = `${hookField(body, 'deviceId', 100)}|${itemId}`;
    let session = sessions.get(key);
    if (!session) {
        session = {
            key, itemId, type, startedAt: Date.now(),
            name: hookField(body, 'name'), series: hookField(body, 'series'),
            season: num('season'), episode: num('episode'), episodeEnd: num('episodeEnd'), year: num('year'),
        };
        sessions.set(key, session);
    }
    Object.assign(session, {
        position: num('position') || session.position || 0,
        runtime: num('runtime') || session.runtime || 0,
        paused: /^true$/i.test(hookField(body, 'paused', 8)),
        device: hookField(body, 'device', 100),
        client: hookField(body, 'client', 100),
        updatedAt: Date.now(),
    });
    if (event === 'PlaybackStart') session.stoppedAt = null;
    if (event === 'PlaybackStop') session.stoppedAt = Date.now();

    await resolveMatch(userId, session);

    const ratio = session.runtime > 0 ? session.position / session.runtime : 0;
    const finished = ratio >= TRACK_AT
        || (event === 'PlaybackStop' && /^true$/i.test(hookField(body, 'completed', 8)));
    if (finished && !session.tracked) await trackSession(userId, session);
}

async function retryPending() {
    const all = loadPrivate(JF_PENDING_FILE);
    for (const key of Object.keys(all)) {
        const userId = Number(key);
        for (const item of all[key]) {
            if (Date.now() - item.at > 7 * 24 * 60 * 60 * 1000) {
                removePending(userId, [item.id]);
                continue;
            }
            if (item.triedAt && Date.now() - item.triedAt < 2 * 60 * 1000) continue;
            try {
                let mediaId = item.mediaId;
                let title = item.title;
                if (!mediaId && item.info) {
                    const m = await matchItem(userId, item.info);
                    if (!m.mediaId) {
                        removePending(userId, [item.id]);
                        pushRecent(userId, { title, episode: item.target, type: item.info.type, status: 'unmatched', at: Date.now() });
                        continue;
                    }
                    mediaId = m.mediaId;
                    title = m.title;
                    updatePending(userId, item.id, { mediaId, title });
                }
                // Without server access the browser applies it on the next visit
                if (!storedToken(userId)) continue;
                const r = await moveForward(userId, mediaId, item.target, { rewatch: 'jellyfin' });
                removePending(userId, [item.id]);
                pushRecent(userId, { title, mediaId, episode: item.target, type: item.type || (item.info ? item.info.type : 'Episode'),
                    status: r.changed ? 'saved' : (r.reason === 'completed' ? 'completed' : 'already'),
                    rewatch: !!r.rewatch, progress: r.progress, entryStatus: r.status, repeat: r.repeat, at: Date.now() });
            } catch (e) {
                updatePending(userId, item.id, { triedAt: Date.now() });
                if (e.code === 'unreachable' || e.code === 'busy') return;
            }
        }
    }
}

function publicSession(s) {
    const match = s.match && s.match.mediaId ? s.match : null;
    return {
        type: s.type, name: s.name, series: s.series, season: s.season, episode: s.episode, episodeEnd: s.episodeEnd,
        position: s.position, runtime: s.runtime, paused: !!s.paused, stopped: !!s.stoppedAt,
        device: s.device, client: s.client, updatedAt: s.updatedAt, tracked: s.tracked || null, rewatch: !!s.rewatch,
        match: match ? { mediaId: match.mediaId, title: match.title, cover: match.cover, episodes: match.episodes } : null,
        unmatched: s.match && !match ? s.match.error : null,
    };
}

// nginx is the only way in (the container listens on 127.0.0.1), so X-Real-IP is trustworthy
function clientIp(req) {
    return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
}

// Sliding one-window counter per bucket and key; true once `max` hits are used up
const rateHits = new Map();

function overLimit(bucket, key, max, windowMs) {
    const id = bucket + ':' + key;
    const now = Date.now();
    const recent = (rateHits.get(id) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
        rateHits.set(id, recent);
        return true;
    }
    recent.push(now);
    rateHits.set(id, recent);
    if (rateHits.size > 10000) rateHits.clear();
    return false;
}

// ===== AniList token check =====
// AniList regularly blocks requests from this server (403 "temporarily disabled").
// "unreachable" therefore never locks anyone out — the host key still protects the party.
// But anyone could cause that block on purpose by sending random tokens, each one a request
// to AniList. So rejected tokens are remembered, and lookups are capped per IP and in total;
// over the cap the answer is "limited", which — unlike "unreachable" — trusts nobody.
const viewerCache = new Map();
const rejectedTokens = new Map();
const VERIFY_PER_IP_PER_MIN = 10;
// Leaves room for the background sync (30/min) while AniList throttles this server to ~30-60/min
const VERIFY_PER_MIN = 20;
// Once AniList refuses, it is not asked again for a while: while blocked, tokens never get
// cached, and every guest heartbeat would otherwise cost a lookup and run into the caps.
// Shortened only for the local test run (tools/api-test).
const VERIFY_PAUSE_MS = Number(process.env.VERIFY_PAUSE_MS) || 60 * 1000;
let verifyPausedUntil = 0;

function tokenHash(token) {
    return token ? crypto.createHash('sha256').update(token).digest('hex') : '';
}

async function verifyViewer(req) {
    const auth = String(req.headers['authorization'] || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return { status: 'missing' };
    // AniList tokens are JWTs; anything else is refused here, so no odd header can make the
    // lookup itself fail and pass for "AniList unreachable"
    if (token.length > 4096 || !/^[A-Za-z0-9_.~+/=-]+$/.test(token)) return { status: 'invalid' };

    const hit = viewerCache.get(token);
    if (hit && Date.now() - hit.ts < VIEWER_TTL_MS) return { status: 'ok', viewer: hit.viewer };
    const hash = tokenHash(token);
    const rejectedAt = rejectedTokens.get(hash);
    if (rejectedAt && Date.now() - rejectedAt < VIEWER_TTL_MS) return { status: 'invalid' };
    if (Date.now() < verifyPausedUntil) return { status: 'unreachable' };

    if (overLimit('verify-ip', clientIp(req), VERIFY_PER_IP_PER_MIN, 60000)) return { status: 'limited' };
    if (overLimit('verify', 'all', VERIFY_PER_MIN, 60000)) return { status: 'limited' };

    try {
        const res = await fetch(ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ query: '{ Viewer { id name avatar { medium } } }' }),
            signal: AbortSignal.timeout(4000)
        });
        const body = await res.json().catch(() => null);
        const viewer = body && body.data && body.data.Viewer;
        if (viewer) {
            if (viewerCache.size > 500) viewerCache.clear();
            viewerCache.set(token, { viewer, ts: Date.now() });
            return { status: 'ok', viewer };
        }
        if (res.status === 400 || res.status === 401) {
            if (rejectedTokens.size > 5000) rejectedTokens.clear();
            rejectedTokens.set(hash, Date.now());
            return { status: 'invalid' };
        }
    } catch { /* unreachable below */ }
    verifyPausedUntil = Date.now() + VERIFY_PAUSE_MS;
    return { status: 'unreachable' };
}

// The answer for a request whose account could not be confirmed (auth.status !== 'ok')
function refuseAuth(res, auth) {
    if (auth.status === 'limited') return json(res, 429, { error: 'Too many sign-in checks, try again in a minute' });
    if (auth.status === 'unreachable') return json(res, 503, { error: 'AniList unreachable, cannot verify your account right now' });
    return json(res, 401, { error: 'Login required' });
}

// A local dev server, on any port. Parsed, not prefix-matched: "http://localhost.evil.test" is not local
function isLocalOrigin(origin) {
    try {
        const u = new URL(origin);
        return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/';
    } catch { return false; }
}

function setCors(req, res) {
    const origin = req.headers.origin;
    const allowed = isLocalOrigin(origin) ? origin : ALLOWED_ORIGIN;
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Host-Key, X-Hook-Secret');
}

function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise(function(resolve) {
        // Collect buffers, not strings: a multi-byte character (Japanese titles!) can be
        // split across chunks and would be corrupted by decoding each chunk on its own
        const chunks = [];
        let size = 0;
        req.on('data', function(c) {
            size += c.length;
            if (size > 1e5) return resolve({});
            chunks.push(c);
        });
        req.on('end', function() {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); }
        });
        req.on('error', function() { resolve({}); });
    });
}

function str(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

// Client-side errors, so problems on other people's devices become visible.
// One JSON line per error; no IP, no user name. Capped per client and in file size.
const ERROR_LOG = path.join(__dirname, 'data', 'client-errors.log');
const ERROR_LOG_MAX = 1024 * 1024;

function logClientError(req, body) {
    if (!str(body.message, 1)) return;
    if (overLimit('log', clientIp(req), 20, 60000)) return;

    const entry = {
        at: new Date().toISOString(),
        message: str(body.message, 500),
        source: str(body.source, 200),
        stack: str(body.stack, 2000),
        route: str(body.route, 100),
        version: str(body.version, 10),
        ua: str(req.headers['user-agent'], 200),
    };
    try {
        fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
        if (fs.existsSync(ERROR_LOG) && fs.statSync(ERROR_LOG).size > ERROR_LOG_MAX) {
            fs.renameSync(ERROR_LOG, ERROR_LOG + '.1');
        }
        fs.appendFileSync(ERROR_LOG, JSON.stringify(entry) + '\n');
    } catch (e) {
        console.error('client error log failed:', e.message);
    }
}

// Only the Jellyfin endpoints AniRoll itself calls
const JF_PATHS = [
    /^\/System\/Info$/,
    /^\/Users$/,
    /^\/Users\/[A-Za-z0-9-]+\/Items\?/,
    /^\/Shows\/[A-Za-z0-9-]+\/Episodes\?/,
    /^\/Users\/[A-Za-z0-9-]+\/PlayedItems\/[A-Za-z0-9-]+$/,
];

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
            || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19)); // benchmarking range
    }
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')
        || v.startsWith('::ffff:') || v.startsWith('64:ff9b:'); // IPv4-mapped, NAT64
}

// DNS lookup for the relay's own connection that refuses private addresses. The check sits in
// the connection itself, so it and the address connected to come from the same answer — a
// name cannot resolve to a public address for the check and to 127.0.0.1 a moment later.
function publicLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!addresses.length || addresses.some(a => isPrivateIp(a.address))) {
            const refused = new Error(`${hostname} resolves to a private address`);
            refused.code = 'EPRIVATE';
            return callback(refused);
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
    });
}

const RELAY_MAX_BYTES = 262144;
// Relay calls while AniList can't confirm the caller (a Jellyfin pull is a few dozen requests)
const RELAY_UNVERIFIED_PER_IP = 60;
const RELAY_UNVERIFIED_TOTAL = 300;

// One request to a Jellyfin server: no redirects, 8 s in total, at most 256 KB read
function relayRequest(target, method, headers) {
    return new Promise((resolve, reject) => {
        const lib = target.protocol === 'https:' ? https : http;
        const chunks = [];
        let size = 0;
        let status = 0;
        const req = lib.request(target, { method, headers, lookup: publicLookup }, (res) => {
            status = res.statusCode;
            res.on('data', (c) => {
                chunks.push(c);
                size += c.length;
                if (size >= RELAY_MAX_BYTES) res.destroy();
            });
            res.on('close', () => resolve({ status, text: Buffer.concat(chunks).toString('utf8').slice(0, RELAY_MAX_BYTES) }));
            res.on('error', () => { /* the close above still answers with what arrived */ });
        });
        const timer = setTimeout(() => req.destroy(new Error('timeout')), 8000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', reject);
        req.end();
    });
}

// A home Jellyfin (192.168.x.x) is unreachable from this VPS anyway, so refusing private
// targets costs nothing and keeps the relay from touching localhost services. This early check
// gives a clear error and covers IP literals (no lookup happens for those); publicLookup
// repeats it for names at connect time.
async function targetAllowed(target) {
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) return false;
    const host = target.hostname;
    const ips = net.isIP(host)
        ? [host]
        : (await dns.lookup(host, { all: true }).catch(() => [])).map(r => r.address);
    return ips.length > 0 && !ips.some(isPrivateIp);
}

// Watch parties live in api/party.js; it gets what it needs from here
const party = require('./party')({
    dataDir: DATA_DIR, readJson, writeJson, moveForward, verifyViewer, refuseAuth,
    json, readBody, str, tokenHash, bearerToken,
});

async function handle(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const pathname = req.url.split('?')[0];

    if (pathname === '/api/log' && req.method === 'POST') {
        const body = await readBody(req);
        logClientError(req, body);
        res.writeHead(204);
        res.end();
        return;
    }

    // What a shared anime link renders as a preview
    const shareMatch = pathname.match(/^\/share\/anime\/(\d+)$/);
    if (shareMatch && req.method === 'GET') {
        const id = shareMatch[1];
        const entry = loadShare()[id] || null;
        return html(res, 200, sharePage(entry, id));
    }

    // The browser hands us the display fields when a title is shared. Nobody can check them
    // against AniList here, so a stored preview is only replaced by a confirmed account —
    // otherwise anyone could put their own text on /a/<id> for every popular title.
    if (pathname === '/share/anime' && req.method === 'POST') {
        if (overLimit('share', clientIp(req), 20, 10 * 60000)) return json(res, 429, { error: 'Too many shares, try again later' });
        const body = await readBody(req);
        const id = parseInt(body.id);
        const title = str(body.title, 200).trim();
        if (!id || !title) return json(res, 400, { error: 'id and title are required' });
        const url = `${SITE}/a/${id}`;

        const cover = str(body.cover, 400);
        const entry = {
            title,
            // Only AniList's own image host, so a preview can never point somewhere else
            cover: /^https:\/\/s4\.anilist\.co\//.test(cover) ? cover : '',
            description: str(body.description, 300).trim(),
            type: body.type === 'MANGA' ? 'MANGA' : 'ANIME',
            savedAt: Date.now(),
        };
        const all = loadShare();
        const stored = all[String(id)];
        const changes = stored && ['title', 'cover', 'description', 'type'].some(k => stored[k] !== entry[k]);
        if (changes && (await verifyViewer(req)).status !== 'ok') {
            // The link works either way; keep the preview as it is
            return json(res, 200, { ok: true, url, kept: true });
        }
        all[String(id)] = entry;
        saveShare(all);
        return json(res, 200, { ok: true, url });
    }

    // Public read-only state — clients ask every minute whether to stay quiet
    if (pathname === '/api/maintenance' && req.method === 'GET') {
        const m = readMaintenance();
        return json(res, 200, m
            ? { maintenance: true, since: str(m.since, 40), note: str(m.note, 200) }
            : { maintenance: false });
    }

    // Jellyfin webhook events — the secret in the URL is the only credential
    const hookPost = pathname.match(/^\/api\/jellyfin\/hook\/([a-f0-9]{48})$/);
    if (hookPost && req.method === 'POST') {
        const userId = hookOwner(hookPost[1]);
        if (!userId) return json(res, 404, { error: 'Unknown webhook' });
        const now = Date.now();
        const hits = (hookHits.get(userId) || []).filter(t => now - t < 60000);
        if (hits.length >= 240) return json(res, 429, { error: 'Too many events' });
        hits.push(now);
        hookHits.set(userId, hits);
        const body = await readBody(req);
        // Answer right away; Jellyfin does not wait for AniList
        handleJellyfinEvent(userId, body).catch(e => console.error('jellyfin event failed:', e.message));
        return json(res, 200, { ok: true });
    }

    // What is playing right now, what was tracked, what still waits — read with the hook secret,
    // so it keeps working while AniList refuses to verify accounts from this server
    if (pathname === '/api/jellyfin/now' || pathname === '/api/jellyfin/now/ack') {
        const userId = hookOwner(String(req.headers['x-hook-secret'] || ''));
        if (!userId) return json(res, 401, { error: 'Unknown webhook' });
        if (pathname.endsWith('/ack')) {
            if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
            const body = await readBody(req);
            const ids = Array.isArray(body.ids) ? body.ids.map(id => str(id, 20)).filter(Boolean) : [];
            removePending(userId, ids);
            return json(res, 200, { ok: true });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
        const sessions = [...userSessions(userId).values()].sort((a, b) => b.updatedAt - a.updatedAt);
        return json(res, 200, {
            lastEventAt: hookSeen.get(userId) || null,
            trackAt: TRACK_AT,
            background: !!loadPrivate(TOKEN_FILE)[String(userId)],
            sessions: sessions.map(publicSession),
            recent: jfRecent.get(userId) || [],
            pending: (loadPrivate(JF_PENDING_FILE)[String(userId)] || [])
                .filter(p => p.mediaId)
                .map(({ id, mediaId, target, title, type, at }) => ({ id, mediaId, target, title, type, at })),
        });
    }

    // Set up (POST, also renews the link), read (GET) or remove (DELETE) the account's webhook
    if (pathname === '/api/jellyfin/hook') {
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok') return refuseAuth(res, auth);
        const userId = auth.viewer.id;
        if (req.method === 'GET') return json(res, 200, hookInfo(userId));
        if (req.method !== 'POST' && req.method !== 'DELETE') return json(res, 405, { error: 'Method not allowed' });
        const all = loadPrivate(HOOK_FILE);
        for (const secret of Object.keys(all)) if (all[secret].userId === userId) delete all[secret];
        if (req.method === 'POST') all[crypto.randomBytes(24).toString('hex')] = { userId, createdAt: Date.now() };
        savePrivate(HOOK_FILE, all);
        return json(res, 200, hookInfo(userId));
    }

    // Consent for background sync: PUT stores the AniList token, DELETE removes it
    if (pathname === '/api/account/background') {
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok') return refuseAuth(res, auth);
        const key = String(auth.viewer.id);
        const all = loadPrivate(TOKEN_FILE);
        if (req.method === 'PUT') {
            all[key] = { tokenEnc: encryptSecret(bearerToken(req)), name: auth.viewer.name, savedAt: Date.now() };
            savePrivate(TOKEN_FILE, all);
        } else if (req.method === 'DELETE') {
            delete all[key];
            savePrivate(TOKEN_FILE, all);
        } else if (req.method !== 'GET') {
            return json(res, 405, { error: 'Method not allowed' });
        }
        return json(res, 200, { enabled: !!all[key], savedAt: all[key] ? all[key].savedAt : null });
    }

    // Jellyfin connection of the logged-in AniList account
    if (pathname === '/api/jellyfin/config') {
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok') return refuseAuth(res, auth);

        const all = loadJellyfin();
        const key = String(auth.viewer.id);

        if (req.method === 'GET') {
            const entry = jfEntry(all, key);
            if (!entry) return json(res, 404, { configured: false });
            if (entry.broken) {
                delete all[key];
                saveJellyfin(all);
                return json(res, 404, { configured: false, reason: 'key-unreadable' });
            }
            return json(res, 200, { configured: true, ...entry });
        }

        if (req.method === 'PUT') {
            const body = await readBody(req);
            let base;
            try { base = new URL(str(body.url, 300)); } catch { return json(res, 400, { error: 'Invalid Jellyfin URL' }); }
            if (!/^https?:$/.test(base.protocol)) return json(res, 400, { error: 'Invalid Jellyfin URL' });
            const apiKey = str(body.apiKey, 200);
            const userId = str(body.userId, 100);
            if (!apiKey || !userId) return json(res, 400, { error: 'Missing API key or Jellyfin user' });

            all[key] = {
                url: base.origin + base.pathname.replace(/\/+$/, ''),
                apiKeyEnc: encryptSecret(apiKey),
                userId,
                userName: str(body.userName, 100),
                serverName: str(body.serverName, 100),
                updatedAt: Date.now(),
            };
            saveJellyfin(all);
            const { apiKeyEnc, ...stored } = all[key];
            // The browser sent the key a moment ago and keeps it; it never comes back in the answer
            return json(res, 200, { configured: true, ...stored });
        }

        if (req.method === 'DELETE') {
            delete all[key];
            saveJellyfin(all);
            return json(res, 200, { configured: false });
        }

        return json(res, 405, { error: 'Method not allowed' });
    }

    // Jellyfin relay. The browser talks to Jellyfin directly whenever it can; this is only
    // for servers without CORS headers or plain http. Locked down on purpose: an AniList login
    // is required, only the handful of Jellyfin endpoints AniRoll uses are allowed, and
    // loopback/private targets are refused so this can never probe services on this machine.
    if (pathname === '/api/jellyfin/proxy' && req.method === 'POST') {
        const auth = await verifyViewer(req);
        if (auth.status !== 'ok' && auth.status !== 'unreachable') return refuseAuth(res, auth);
        // While AniList blocks this server nobody can be confirmed, and Jellyfin should keep working. Such
        // unconfirmed calls get a small allowance per IP and in total, so the relay can't be used as a proxy.
        if (auth.status === 'unreachable'
            && (overLimit('relay-ip', clientIp(req), RELAY_UNVERIFIED_PER_IP, 60000) || overLimit('relay', 'all', RELAY_UNVERIFIED_TOTAL, 60000))) {
            return json(res, 429, { error: 'AniList cannot confirm your account right now, try again in a few minutes' });
        }

        const body = await readBody(req);
        // Prefer what the account has stored; a client may still pass its own server explicitly
        const found = auth.status === 'ok' ? jfEntry(loadJellyfin(), String(auth.viewer.id)) : null;
        const stored = found && !found.broken ? found : null;
        const apiKey = str(body.apiKey, 200) || (stored ? stored.apiKey : '');
        const rawUrl = str(body.url, 300) || (stored ? stored.url : '');
        if (!apiKey || !rawUrl) return json(res, 400, { error: 'No Jellyfin server configured' });

        let base, target;
        try {
            base = new URL(rawUrl);
            target = new URL(str(body.path, 500), base);
        } catch {
            return json(res, 400, { error: 'Invalid Jellyfin URL' });
        }
        if (target.origin !== base.origin) return json(res, 400, { error: 'Path must stay on the same host' });

        const path = target.pathname + target.search;
        const method = body.method === 'POST' ? 'POST' : 'GET';
        if (!JF_PATHS.some(re => re.test(path))) return json(res, 400, { error: 'Endpoint not allowed' });
        if (!(await targetAllowed(target))) return json(res, 400, { error: 'Only public Jellyfin hosts can be relayed' });

        try {
            const r = await relayRequest(target, method,
                { Authorization: `MediaBrowser Token="${apiKey}"`, 'X-Emby-Token': apiKey, Accept: 'application/json' });
            let data = null;
            try { data = r.text ? JSON.parse(r.text) : null; } catch { /* not JSON */ }
            return json(res, 200, { status: r.status, data });
        } catch (e) {
            if (e.code === 'EPRIVATE') return json(res, 400, { error: 'Only public Jellyfin hosts can be relayed' });
            return json(res, 502, { error: 'Jellyfin not reachable: ' + e.message });
        }
    }

    if (await party.route(req, res, pathname)) return;
    return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(function(req, res) {
    handle(req, res).catch(function(err) {
        console.error(err);
        if (!res.headersSent) json(res, 500, { error: 'Server error' });
    });
});

// Writes that failed (AniList busy or blocking this server) are retried once a minute
setInterval(function() {
    party.syncMembers()
        .then(retryPending)
        .catch(function(e) { console.error('background sync failed:', e.message); });
}, 60000);

server.listen(PORT, '0.0.0.0', function() {
    console.log('Aniroll API running on port ' + PORT);
});
