import { buildTasteProfile, tasteMatch } from './taste.js?v=99';

const API_URL = 'https://graphql.anilist.co';

let rateLimitRemaining = 90;
let rateLimitReset = 0;

// ===== Rate limit awareness =====
// AniList drops to roughly 30 requests/minute when degraded. Once it starts refusing, stop
// firing requests altogether for a while instead of retrying every few seconds, and keep the
// user's own list changes in a queue so nothing they did gets lost.
const RATE_LIMIT_EVENT = 'aniroll:rate-limited';
const PENDING_KEY = 'aniroll_pending_saves';
const RATE_LIMIT_PAUSE = 5 * 60 * 1000;
let rateLimitedUntil = 0;

export function isRateLimited() { return Date.now() < rateLimitedUntil; }

// The account whose data this is (the viewer stored by js/auth.js), so one browser never mixes two
// accounts: cache keys and queued saves carry it. 'new' right after login, before the viewer is known.
function accountId() {
    try { return JSON.parse(localStorage.getItem('aniroll_user'))?.id ?? 'new'; } catch { return 'new'; }
}

// ===== Request budget =====
// A hard ceiling on AniList requests, shared across all open tabs via localStorage.
// AniList allows ~30/min while degraded; staying well under that is the difference between
// a working app and an instant 429. Nothing in the app can exceed this, whatever it tries.
const MAX_REQUESTS_PER_MIN = 20;
const BUDGET_KEY = 'aniroll_req_times';
let localTimes = []; // fallback when storage is unavailable

function readTimes() {
    try {
        const raw = JSON.parse(localStorage.getItem(BUDGET_KEY));
        return Array.isArray(raw) ? raw : [];
    } catch { return localTimes; }
}

function writeTimes(times) {
    localTimes = times;
    try { localStorage.setItem(BUDGET_KEY, JSON.stringify(times)); } catch { /* storage blocked */ }
}

export function requestsLastMinute() {
    const cutoff = Date.now() - 60000;
    return readTimes().filter(t => t > cutoff).length;
}

// Read, check and write of the shared list in one step: without the lock two tabs could read the same
// list, each add their request and write it back, and one of the two requests would go uncounted
function claimSlot() {
    const cutoff = Date.now() - 60000;
    const times = readTimes().filter(t => t > cutoff);
    if (times.length >= MAX_REQUESTS_PER_MIN) return times;
    times.push(Date.now());
    writeTimes(times.slice(-MAX_REQUESTS_PER_MIN * 2));
    return null;
}
const lockedClaim = () => navigator.locks?.request ? navigator.locks.request('aniroll-request-budget', claimSlot) : claimSlot();

// Takes a slot, waiting for one if the last minute is already full
async function takeRequestSlot(maxWaitMs = 15000) {
    const started = Date.now();
    for (;;) {
        const times = await lockedClaim();
        if (!times) return;
        const waitFor = Math.min(Math.max(times[0] + 60000 - Date.now() + 50, 200), 2000);
        if (Date.now() - started + waitFor > maxWaitMs) {
            const err = new Error('Too many AniList requests just now — AniRoll is holding back, try again in a moment');
            err.throttled = true;
            throw err;
        }
        await new Promise(r => setTimeout(r, waitFor));
    }
}

// Maintenance mode: every automatic loop stands still, the user can still browse
let backgroundPaused = false;
export function isBackgroundPaused() { return backgroundPaused; }
export function setBackgroundPaused(on) { backgroundPaused = !!on; }

// True whenever background work should hold off — rate limit or maintenance
export function shouldHoldBackground() { return backgroundPaused || isRateLimited(); }
export function rateLimitWaitMs() { return Math.max(0, rateLimitedUntil - Date.now()); }

function rateLimitError() {
    const err = new Error(`AniList is rate limiting — paused for ${Math.ceil(rateLimitWaitMs() / 60000)} min`);
    err.rateLimited = true;
    return err;
}

function markRateLimited(retryAfterSec) {
    const wait = Math.max(RATE_LIMIT_PAUSE, Math.min(Number(retryAfterSec) || 0, 3600) * 1000);
    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + wait);
    window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { until: rateLimitedUntil } }));
}

// Every queued change belongs to the account that made it: after switching accounts in the same
// browser, the other account's changes wait for it instead of going out with the new login.
// Older items carry no account; one with a list entry id is safe (AniList only lets the owner change
// that entry), one that would add a show by mediaId could land on the wrong list and is dropped.
function loadAll() {
    try {
        const raw = JSON.parse(localStorage.getItem(PENDING_KEY));
        return Array.isArray(raw) ? raw.filter(item => item.user != null || item.vars?.id) : [];
    } catch { return []; }
}
const mine = (item, me = accountId()) => item.user == null || String(item.user) === String(me);

function loadPending() { return loadAll().filter(item => mine(item)); }

// Replaces this account's part of the queue, leaves every other account's as it is
function savePending(list) {
    const others = loadAll().filter(item => !mine(item));
    try { localStorage.setItem(PENDING_KEY, JSON.stringify([...others, ...list.slice(-50)])); } catch { /* storage blocked */ }
}

export function pendingSaveCount() { return loadPending().length; }

// One queued change per entry — editing the same show again replaces the older one
function queuePendingSave(variables) {
    const key = String(variables.id || `media-${variables.mediaId}`);
    const list = loadPending().filter(item => item.key !== key);
    list.push({ key, user: accountId(), vars: variables, ts: Date.now() });
    savePending(list);
}

let flushing = false;

// Pushes queued changes once AniList answers again; called on start and every few minutes
export async function flushPendingSaves(token) {
    // Not before the viewer is known: until then the queue can't tell whose changes are whose
    if (!token || flushing || shouldHoldBackground() || accountId() === 'new') return 0;
    const list = loadPending();
    if (!list.length) return 0;

    flushing = true;
    let done = 0;
    try {
        // A handful per run: 20 queued changes at once used to mean ~85 requests/minute,
        // which tripped the limit seconds after the page opened
        for (const item of list.slice(0, 5)) {
            try {
                await saveMediaListEntry(item.vars, token, { queue: false });
                done++;
                savePending(loadPending().filter(x => x.key !== item.key));
            } catch (err) {
                if (err.rateLimited) break; // still limited: keep the rest for later
                savePending(loadPending().filter(x => x.key !== item.key)); // permanent failure, drop it
            }
            await new Promise(r => setTimeout(r, 2000)); // stay under AniList's write limit
        }
    } finally {
        flushing = false;
    }
    return done;
}

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Different data ages at different speeds, so one blanket lifetime wasted requests.
// Anything the user changes themselves is invalidated on write (see clearCache calls).
const TTL = {
    lists: 15 * 60 * 1000,        // own/foreign lists — invalidated on every save anyway
    media: 30 * 60 * 1000,        // details of one title
    discovery: 30 * 60 * 1000,    // trending, popular, season, browse
    airing: 30 * 60 * 1000,       // airing schedule
    profile: 30 * 60 * 1000,      // user profiles
    friends: 10 * 60 * 1000,      // who of my friends watches this
    recommendations: 60 * 60 * 1000,
    genres: 24 * 60 * 60 * 1000,  // static
};
const CACHE_MAX_ENTRIES = 5000;
let _cacheBytes = 0;
const CACHE_MAX_BYTES = 50 * 1024 * 1024;

function estimateSize(obj) {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return str ? str.length * 2 : 0;
}

// A Map keeps insertion order and every hit re-inserts its entry (touch), so the first keys are the
// ones used longest ago
function touch(key, entry) {
    _cache.delete(key);
    _cache.set(key, entry);
}

function evictCache() {
    const iter = _cache.keys();
    while ((_cache.size > CACHE_MAX_ENTRIES || _cacheBytes > CACHE_MAX_BYTES) && _cache.size > 0) {
        const oldest = iter.next().value;
        if (!oldest) break;
        const entry = _cache.get(oldest);
        if (entry) _cacheBytes -= entry.bytes || 0;
        _cache.delete(oldest);
    }
}

// Two components asking for the same thing at the same time used to fire two requests
const _inFlight = new Map();

export async function cachedQuery(q, variables = {}, token = null, ttl = CACHE_TTL) {
    // Logged in, answers depend on the account (mediaListEntry, isFollowing, ...): the key says whose
    // they are, never the token itself (keys are stored in IndexedDB)
    const account = accountId();
    // Right after login, before the viewer is known, nothing is cached: it would belong to nobody
    if (token && account === 'new') return query(q, variables, token);
    const key = JSON.stringify({ q: q.replace(/\s+/g, ' ').trim(), variables, scope: token ? `user:${account}` : 'public' });
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) {
        touch(key, hit);
        return hit.data;
    }

    const pending = _inFlight.get(key);
    if (pending) return pending;
    const run = cachedQueryUncoalesced(q, variables, token, ttl, key, hit);
    _inFlight.set(key, run);
    try {
        return await run;
    } finally {
        _inFlight.delete(key);
    }
}

async function cachedQueryUncoalesced(q, variables, token, ttl, key, hit) {

    if (!hit) {
        const idbHit = await idbGet(key);
        if (idbHit && Date.now() - idbHit.ts < ttl) {
            _cache.set(key, idbHit);
            _cacheBytes += idbHit.bytes || 0;
            return idbHit.data;
        }
    }

    try {
        const data = await query(q, variables, token);
        const bytes = estimateSize(data);
        if (hit) _cacheBytes -= hit.bytes || 0;
        const entry = { data, ts: Date.now(), bytes };
        touch(key, entry);
        _cacheBytes += bytes;
        evictCache();
        idbSet(key, entry).then(() => { if (Math.random() < 0.02) idbEvict(); });
        return data;
    } catch (err) {
        if (hit) return hit.data;
        const idbHit = await idbGet(key);
        if (idbHit) return idbHit.data;
        throw err;
    }
}

// Marks entries outdated without dropping them from memory: the next read refetches, but if
// that refetch fails the old data is still there to fall back on instead of an empty section
export function expireCache(pattern) {
    for (const [key, entry] of _cache) {
        if (key.includes(pattern)) entry.ts = 0;
    }
    idbDeleteMatching(pattern);
}

// Handled failures worth knowing about — they never reach window.onerror.
// Same endpoint as app.js: api/server.js → data/client-errors.log
export function reportIssue(message) {
    try {
        const payload = JSON.stringify({
            message: String(message).slice(0, 500),
            source: 'handled',
            route: location.hash.split('?')[0] || '#/',
        });
        navigator.sendBeacon('/api/log', new Blob([payload], { type: 'application/json' }));
    } catch { /* logging must never break the page */ }
}

// Logout: what AniRoll cached for this account goes with it (RAM and IndexedDB), so the next person on
// this browser finds none of it. Queued saves stay; they wait for the account that made them.
export async function forgetAccountCache() {
    const scope = `"scope":"user:${accountId()}"`;
    clearCache(scope);
    await idbDeleteMatching(scope);
}

export function clearCache(pattern) {
    if (!pattern) {
        _cache.clear();
        _cacheBytes = 0;
        return;
    }
    for (const key of _cache.keys()) {
        if (key.includes(pattern)) {
            const entry = _cache.get(key);
            if (entry) _cacheBytes -= entry.bytes || 0;
            _cache.delete(key);
        }
    }
    idbDeleteMatching(pattern);
}

async function query(q, variables = {}, token = null) {
    if (isRateLimited()) throw rateLimitError();
    await takeRequestSlot();

    if (rateLimitRemaining <= 1 && Date.now() / 1000 < rateLimitReset) {
        const wait = (rateLimitReset - Date.now() / 1000) * 1000 + 500;
        await new Promise(r => setTimeout(r, wait));
    }

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: q, variables })
    });

    rateLimitRemaining = parseInt(res.headers.get('X-RateLimit-Remaining') || '90');
    rateLimitReset = parseInt(res.headers.get('X-RateLimit-Reset') || '0');

    if (res.status === 429) {
        markRateLimited(res.headers.get('Retry-After'));
        throw rateLimitError();
    }

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'API Error');
    return json.data;
}

const MEDIA_FRAGMENT = `
fragment mediaFields on Media {
    id
    title { romaji english native userPreferred }
    coverImage { large extraLarge color }
    bannerImage
    format
    status
    episodes
    chapters
    volumes
    meanScore
    averageScore
    popularity
    genres
    season
    seasonYear
    startDate { year month day }
    endDate { year month day }
    nextAiringEpisode { airingAt episode timeUntilAiring }
    mediaListEntry { id status score(format: POINT_100) progress repeat notes startedAt { year month day } completedAt { year month day } }
    type
    description(asHtml: false)
    studios(isMain: true) { nodes { id name } }
    source
    duration
    countryOfOrigin
    isAdult
    trailer { id site }
}`;

const MEDIA_CARD_FRAGMENT = `
fragment mediaCard on Media {
    id
    title { userPreferred english romaji native }
    coverImage { large extraLarge color }
    format
    status
    episodes
    chapters
    meanScore
    season
    seasonYear
    nextAiringEpisode { episode timeUntilAiring airingAt }
    mediaListEntry { id status score progress }
    type
    genres
    isAdult
}`;

export async function searchMedia(search, type = null, page = 1, perPage = 20, token = null) {
    const data = await cachedQuery(`
        ${MEDIA_CARD_FRAGMENT}
        query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                pageInfo { total currentPage lastPage hasNextPage }
                media(search: $search, type: $type, sort: [SEARCH_MATCH], isAdult: false) {
                    ...mediaCard
                }
            }
        }
    `, {
        search, page, perPage,
        // Omit an unset type: AniList reads an explicit `type: null` as a filter and returns 0 hits
        ...(type ? { type } : {}),
    }, token);
    return data.Page;
}

export async function getMedia(id, token = null) {
    const data = await cachedQuery(`
        ${MEDIA_FRAGMENT}
        query ($id: Int) {
            Media(id: $id) {
                ...mediaFields
                recommendations(page: 1, perPage: 10, sort: [RATING_DESC]) {
                    nodes {
                        rating
                        mediaRecommendation { id title { userPreferred english romaji native } coverImage { large } meanScore format type }
                    }
                }
                relations { edges {
                    relationType(version: 2)
                    node { id title { userPreferred english romaji native } coverImage { large } format type status meanScore }
                }}
                characters(page: 1, perPage: 12, sort: [ROLE, RELEVANCE]) {
                    edges {
                        role
                        voiceActors(language: JAPANESE, sort: [RELEVANCE]) { id name { full } image { medium } }
                        node { id name { full } image { medium } }
                    }
                }
                reviews(page: 1, perPage: 5, sort: [RATING_DESC]) {
                    nodes { id summary rating ratingAmount score user { id name avatar { medium } } }
                }
                stats {
                    scoreDistribution { score amount }
                    statusDistribution { status amount }
                }
                tags { id name rank isMediaSpoiler }
                externalLinks { id url site icon color type language }
            }
        }
    `, { id }, token, TTL.media);
    return data.Media;
}

export async function getTrending(type = 'ANIME', page = 1, perPage = 20, token = null) {
    const data = await cachedQuery(`
        ${MEDIA_CARD_FRAGMENT}
        query ($type: MediaType, $page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                media(type: $type, sort: [TRENDING_DESC], isAdult: false) { ...mediaCard }
            }
        }
    `, { type, page, perPage }, token, TTL.discovery);
    return data.Page.media;
}

export async function getPopular(type = 'ANIME', page = 1, perPage = 20, token = null) {
    const data = await cachedQuery(`
        ${MEDIA_CARD_FRAGMENT}
        query ($type: MediaType, $page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                media(type: $type, sort: [POPULARITY_DESC], isAdult: false) { ...mediaCard }
            }
        }
    `, { type, page, perPage }, token, TTL.discovery);
    return data.Page.media;
}

export async function getTopRated(type = 'ANIME', page = 1, perPage = 20, token = null) {
    const data = await cachedQuery(`
        ${MEDIA_CARD_FRAGMENT}
        query ($type: MediaType, $page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                media(type: $type, sort: [SCORE_DESC], isAdult: false) { ...mediaCard }
            }
        }
    `, { type, page, perPage }, token, TTL.discovery);
    return data.Page.media;
}

export async function getSeason(season, year, sort = 'POPULARITY_DESC', token = null) {
    const data = await cachedQuery(`
        ${MEDIA_CARD_FRAGMENT}
        query ($season: MediaSeason, $year: Int, $sort: [MediaSort]) {
            Page(page: 1, perPage: 50) {
                media(season: $season, seasonYear: $year, type: ANIME, sort: $sort, isAdult: false) { ...mediaCard }
            }
        }
    `, { season, year, sort: [sort] }, token, TTL.discovery);
    return data.Page.media;
}

export async function getAiringSchedule(page = 1, perPage = 50, token = null) {
    const now = Math.floor(Date.now() / 1000);
    const weekEnd = now + 7 * 24 * 60 * 60;
    const data = await query(`
        query ($page: Int, $perPage: Int, $start: Int, $end: Int) {
            Page(page: $page, perPage: $perPage) {
                airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: [TIME]) {
                    id
                    airingAt
                    episode
                    media {
                        id
                        title { userPreferred english romaji native }
                        coverImage { large }
                        format
                        episodes
                        mediaListEntry { id status progress }
                    }
                }
            }
        }
    `, { page, perPage, start: now, end: weekEnd }, token, TTL.airing);
    return data.Page.airingSchedules;
}

export async function browseMedia(variables, token = null) {
    const data = await cachedQuery(`
        ${MEDIA_CARD_FRAGMENT}
        query (
            $page: Int, $perPage: Int, $type: MediaType, $sort: [MediaSort],
            $genre_in: [String], $tag_in: [String], $season: MediaSeason,
            $seasonYear: Int, $format: MediaFormat, $status: MediaStatus,
            $search: String, $year: String
        ) {
            Page(page: $page, perPage: $perPage) {
                pageInfo { total currentPage lastPage hasNextPage }
                media(
                    type: $type, sort: $sort, genre_in: $genre_in, tag_in: $tag_in,
                    season: $season, seasonYear: $seasonYear, format: $format,
                    status: $status, search: $search, startDate_like: $year, isAdult: false
                ) { ...mediaCard }
            }
        }
    `, variables, token, TTL.discovery);
    return data.Page;
}

export async function getGenres() {
    const data = await cachedQuery(`{ GenreCollection }`, {}, null, TTL.genres);
    return data.GenreCollection;
}

export async function getViewer(token) {
    const data = await query(`
        query {
            Viewer {
                id name avatar { large medium } bannerImage
                about
                statistics {
                    anime {
                        count minutesWatched episodesWatched meanScore
                        genres(sort: [COUNT_DESC], limit: 10) { genre count meanScore minutesWatched }
                        tags(sort: [COUNT_DESC], limit: 10) { tag { name } count meanScore }
                        scores(sort: [MEAN_SCORE]) { score count meanScore }
                        formats(sort: [COUNT_DESC]) { format count }
                        statuses(sort: [COUNT_DESC]) { status count }
                        releaseYears(sort: [COUNT_DESC], limit: 10) { releaseYear count }
                        startYears(sort: [COUNT_DESC], limit: 10) { startYear count }
                        studios(sort: [COUNT_DESC], limit: 10) { studio { id name } count meanScore }
                    }
                    manga {
                        count chaptersRead volumesRead meanScore
                        genres(sort: [COUNT_DESC], limit: 10) { genre count meanScore chaptersRead }
                        scores(sort: [MEAN_SCORE]) { score count meanScore }
                        formats(sort: [COUNT_DESC]) { format count }
                        statuses(sort: [COUNT_DESC]) { status count }
                    }
                }
                options { titleLanguage displayAdultContent profileColor }
                mediaListOptions {
                    scoreFormat
                    animeList { customLists sectionOrder }
                    mangaList { customLists sectionOrder }
                }
                unreadNotificationCount
                siteUrl
            }
        }
    `, {}, token);
    return data.Viewer;
}

export async function getUserProfile(name, token = null) {
    const data = await query(`
        query ($name: String) {
            User(name: $name) {
                id name avatar { large medium } bannerImage
                about
                statistics {
                    anime {
                        count minutesWatched episodesWatched meanScore
                        genres(sort: [COUNT_DESC], limit: 10) { genre count meanScore minutesWatched }
                        scores(sort: [MEAN_SCORE]) { score count meanScore }
                        formats(sort: [COUNT_DESC]) { format count }
                        statuses(sort: [COUNT_DESC]) { status count }
                        studios(sort: [COUNT_DESC], limit: 10) { studio { id name } count meanScore }
                    }
                    manga {
                        count chaptersRead volumesRead meanScore
                        genres(sort: [COUNT_DESC], limit: 10) { genre count meanScore chaptersRead }
                    }
                }
                favourites {
                    anime(page: 1, perPage: 10) { nodes { id title { userPreferred english romaji native } coverImage { large } } }
                    manga(page: 1, perPage: 10) { nodes { id title { userPreferred english romaji native } coverImage { large } } }
                    characters(page: 1, perPage: 10) { nodes { id name { full } image { medium } } }
                }
                siteUrl
            }
        }
    `, { name }, token, TTL.profile);
    return data.User;
}

export async function getMediaList(userId, type = 'ANIME', token = null) {
    const data = await cachedQuery(`
        query ($userId: Int, $type: MediaType) {
            MediaListCollection(userId: $userId, type: $type, sort: [UPDATED_TIME_DESC]) {
                lists {
                    name
                    status
                    entries {
                        id
                        mediaId
                        status
                        score
                        progress
                        progressVolumes
                        repeat
                        notes
                        startedAt { year month day }
                        completedAt { year month day }
                        updatedAt
                        media {
                            id idMal title { userPreferred english romaji native } coverImage { large extraLarge color } bannerImage
                            episodes chapters volumes format status
                            startDate { year month day }
                            nextAiringEpisode { episode timeUntilAiring airingAt }
                            meanScore genres
                        }
                    }
                }
            }
        }
    `, { userId, type }, token, TTL.lists);
    return data.MediaListCollection.lists;
}

// Scores: always pass `scoreRaw` (0-100). `score` would be interpreted in the user's own scoreFormat.
export async function saveMediaListEntry(variables, token, { queue = true } = {}) {
    const data = await queryOrQueue(variables, token, queue, `
        mutation (
            $mediaId: Int, $id: Int, $status: MediaListStatus, $scoreRaw: Int,
            $progress: Int, $progressVolumes: Int, $repeat: Int, $notes: String,
            $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput
        ) {
            SaveMediaListEntry(
                mediaId: $mediaId, id: $id, status: $status, scoreRaw: $scoreRaw,
                progress: $progress, progressVolumes: $progressVolumes,
                repeat: $repeat, notes: $notes,
                startedAt: $startedAt, completedAt: $completedAt
            ) {
                id mediaId status score(format: POINT_100) progress progressVolumes repeat notes
                startedAt { year month day }
                completedAt { year month day }
            }
        }
    `);
    clearCache('MediaListCollection');
    clearCache('Media(id');
    // The feed carries the viewer's own list entry per show, so refresh it — but keep the old
    // copy: deleting it left the Friends section with nothing when the refetch was throttled
    expireCache('activities(');

    const saved = data.SaveMediaListEntry;

    // Mirror the new progress to Jellyfin — fire and forget, a failure never breaks the list update
    if (saved?.mediaId && saved.progress) {
        import('./jellyfin.js?v=99').then(m =>
            m.syncProgress(saved.mediaId, saved.progress, () => mediaTitlesForSync(saved.mediaId, token)));
    }

    return saved;
}

// Runs the mutation; if AniList is rate limiting, the change is queued and retried later
async function queryOrQueue(variables, token, queue, mutation) {
    try {
        return await query(mutation, variables, token);
    } catch (err) {
        // Throttled by our own budget counts too, or the change would be lost
        if ((err.rateLimited || err.throttled) && queue) {
            queuePendingSave(variables);
            const queued = new Error('AniList is rate limiting — change saved, AniRoll retries it automatically');
            queued.rateLimited = true;
            queued.queued = true;
            throw queued;
        }
        throw err;
    }
}

// Jellyfin matches by title when the library carries no AniList id
async function mediaTitlesForSync(mediaId, token) {
    const data = await cachedQuery(`
        query ($id: Int) {
            Media(id: $id) { title { romaji english userPreferred } startDate { year } }
        }
    `, { id: mediaId }, token);
    const t = data.Media?.title || {};
    return { titles: [...new Set([t.romaji, t.english, t.userPreferred].filter(Boolean))], year: data.Media?.startDate?.year || null };
}

export function fuzzyToday() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

// SaveMediaListEntry variables for a progress change, incl. status transitions and start/finish dates
export function progressVars(entry, progress, max) {
    const vars = { id: entry.id, progress };
    if (max && progress >= max) {
        vars.status = 'COMPLETED';
        if (entry.status === 'REPEATING') vars.repeat = (entry.repeat || 0) + 1;
        else if (!entry.completedAt?.year) vars.completedAt = fuzzyToday();
    } else if (progress > 0 && (entry.status === 'PLANNING' || entry.status === 'PAUSED')) {
        vars.status = 'CURRENT';
    }
    if (progress > 0 && entry.status !== 'REPEATING' && !entry.startedAt?.year) vars.startedAt = fuzzyToday();
    return vars;
}

// Uncached single-entry lookup, used for Watch Party sync (must always be fresh).
// `user` is either a user id (number) or a user name (string). Returns null if not on list.
export async function getUserMediaProgress(user, mediaId, token = null) {
    // Without a user filter AniList returns *someone's* entry — never allow that
    if (!user || !mediaId) throw new Error('getUserMediaProgress: user and mediaId are required');
    const vars = typeof user === 'number' ? { userId: user, mediaId } : { userName: user, mediaId };
    try {
        const data = await query(`
            query ($userId: Int, $userName: String, $mediaId: Int) {
                MediaList(userId: $userId, userName: $userName, mediaId: $mediaId) { id status progress repeat }
            }
        `, vars, token);
        return data.MediaList;
    } catch (err) {
        if (/not found/i.test(err.message)) return null;
        throw err;
    }
}

// Everyone's progress for one show in a SINGLE request (party member list).
// Missing entries are simply absent from the result.
export async function getMembersProgress(mediaId, userIds, token = null) {
    const ids = (userIds || []).filter(Boolean);
    if (!mediaId || !ids.length) return new Map();
    const data = await query(`
        query ($mediaId: Int, $users: [Int]) {
            Page(perPage: 50) {
                mediaList(mediaId: $mediaId, userId_in: $users) {
                    userId status progress
                }
            }
        }
    `, { mediaId, users: ids }, token);
    return new Map((data.Page?.mediaList || []).map(e => [e.userId, e]));
}

// `timeUntilAiring` is a snapshot and goes stale in the cache; `airingAt` is absolute.
// Prefer it so a cached card still shows the right countdown.
export function untilAiring(next) {
    if (!next) return null;
    if (next.airingAt) return Math.max(0, next.airingAt - Math.floor(Date.now() / 1000));
    return next.timeUntilAiring ?? null;
}

// Resolves up to 50 MAL ids per request → Map(malId → anilistId)
export async function resolveMalIds(malIds, type) {
    const result = new Map();
    for (let i = 0; i < malIds.length; i += 50) {
        const chunk = malIds.slice(i, i + 50);
        const data = await cachedQuery(`
            query ($ids: [Int], $type: MediaType) {
                Page(perPage: 50) { media(idMal_in: $ids, type: $type) { id idMal } }
            }
        `, { ids: chunk, type }, null, 24 * 60 * 60 * 1000);
        for (const m of data.Page.media || []) result.set(m.idMal, m.id);
    }
    return result;
}

export async function deleteMediaListEntry(id, token) {
    const data = await query(`
        mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }
    `, { id }, token);
    clearCache('MediaListCollection');
    clearCache('Media(id');
    return data.DeleteMediaListEntry;
}

// Card data for AniList media links in text posts — every card of a feed page in one request
export async function getMediaCards(ids, token = null) {
    const unique = [...new Set(ids.map(Number).filter(Boolean))].sort((a, b) => a - b).slice(0, 50);
    if (!unique.length) return new Map();
    const data = await cachedQuery(`
        query ($ids: [Int]) {
            Page(perPage: 50) {
                media(id_in: $ids) {
                    id type format status season seasonYear meanScore
                    title { userPreferred english romaji native }
                    coverImage { large }
                }
            }
        }
    `, { ids: unique }, token, TTL.media);
    return new Map(data.Page.media.map(m => [m.id, m]));
}

// Replies of one activity — loaded only when someone opens the thread (1 request, cached briefly)
export async function getActivityReplies(id, token = null) {
    const replyFields = 'replies { id text createdAt likeCount isLiked user { id name avatar { medium } } }';
    const data = await cachedQuery(`
        query ($id: Int) {
            Activity(id: $id) {
                ... on TextActivity { id ${replyFields} }
                ... on ListActivity { id ${replyFields} }
                ... on MessageActivity { id ${replyFields} }
            }
        }
    `, { id }, token, 2 * 60 * 1000);
    return data.Activity?.replies || [];
}

export async function getActivityFeed(page = 1, isFollowing = true, token = null) {
    const data = await cachedQuery(`
        query ($page: Int, $isFollowing: Boolean) {
            Page(page: $page, perPage: 25) {
                pageInfo { total currentPage lastPage hasNextPage }
                activities(sort: [ID_DESC], isFollowing: $isFollowing, type_in: [TEXT, ANIME_LIST, MANGA_LIST, MESSAGE]) {
                    ... on TextActivity {
                        id type text userId
                        user { id name avatar { medium } }
                        likes { id name avatar { medium } }
                        likeCount isLiked createdAt replyCount
                    }
                    ... on ListActivity {
                        id type status progress
                        user { id name avatar { medium } }
                        media { id title { userPreferred english romaji native } coverImage { large } type format mediaListEntry { status progress } }
                        likes { id name avatar { medium } }
                        likeCount isLiked createdAt replyCount
                    }
                    ... on MessageActivity {
                        id type message
                        messenger { id name avatar { medium } }
                        recipient { id name avatar { medium } }
                        likes { id name avatar { medium } }
                        likeCount isLiked createdAt replyCount
                    }
                }
            }
        }
    `, { page, isFollowing }, token);
    return data.Page;
}

export async function getFriendsMediaStatus(mediaId, userId, token) {
    try {
        const data = await cachedQuery(`
            query ($mediaId: Int!) {
                Page(perPage: 25) {
                    mediaList(mediaId: $mediaId, isFollowing: true, sort: [UPDATED_TIME_DESC]) {
                        user { id name avatar { medium } }
                        status score(format: POINT_100) progress
                        updatedAt
                    }
                }
            }
        `, { mediaId }, token, TTL.friends);
        return data.Page.mediaList || [];
    } catch (e) {
        console.warn('isFollowing query failed, using fallback:', e.message);
        // Who you follow changes rarely — worth keeping around
        const followData = await cachedQuery(`
            query ($userId: Int!) {
                Page(perPage: 50) {
                    following(userId: $userId) { id name avatar { medium } }
                }
            }
        `, { userId }, token, TTL.profile);

        // One request per friend — cap it so the fallback can't burn the rate limit
        const friends = (followData.Page.following || []).slice(0, 10);
        const results = await Promise.all(friends.map(async f => {
            try {
                const d = await query(`
                    query ($mediaId: Int!, $userId: Int!) {
                        MediaList(mediaId: $mediaId, userId: $userId) {
                            status score(format: POINT_100) progress updatedAt
                        }
                    }
                `, { mediaId, userId: f.id }, token);
                return d.MediaList ? { ...d.MediaList, user: f } : null;
            } catch (_) { return null; }
        }));
        return results.filter(Boolean);
    }
}

export async function getFollowing(userId, page = 1, token = null) {
    const data = await query(`
        query ($userId: Int!, $page: Int) {
            Page(page: $page, perPage: 25) {
                pageInfo { total currentPage lastPage hasNextPage }
                following(userId: $userId, sort: [USERNAME]) {
                    id name avatar { medium } bannerImage
                    statistics { anime { count minutesWatched episodesWatched meanScore } }
                }
            }
        }
    `, { userId, page }, token);
    return data.Page;
}

export async function getFollowers(userId, page = 1, token = null) {
    const data = await query(`
        query ($userId: Int!, $page: Int) {
            Page(page: $page, perPage: 25) {
                pageInfo { total currentPage lastPage hasNextPage }
                followers(userId: $userId, sort: [USERNAME]) {
                    id name avatar { medium }
                    statistics { anime { count episodesWatched meanScore } }
                }
            }
        }
    `, { userId, page }, token);
    return data.Page;
}

// Replies to an activity. Drops the cached thread (the next open shows the reply) and marks
// the feeds stale for the new reply count, keeping them as fallback if the refetch fails.
export async function postActivityReply(activityId, text, token) {
    const data = await query(`
        mutation ($activityId: Int, $text: String) {
            SaveActivityReply(activityId: $activityId, text: $text) {
                id text createdAt likeCount isLiked user { id name avatar { medium } }
            }
        }
    `, { activityId, text }, token);
    clearCache('on TextActivity { id replies {');
    expireCache('activities(');
    return data.SaveActivityReply;
}

export async function toggleLike(id, type, token) {
    const data = await query(`
        mutation ($id: Int, $type: LikeableType) {
            ToggleLikeV2(id: $id, type: $type) {
                ... on ListActivity { id likeCount isLiked }
                ... on TextActivity { id likeCount isLiked }
                ... on MessageActivity { id likeCount isLiked }
            }
        }
    `, { id, type }, token);
    return data.ToggleLikeV2;
}

export async function toggleFollow(userId, token) {
    const data = await query(`
        mutation ($userId: Int) {
            ToggleFollow(userId: $userId) { id name isFollowing }
        }
    `, { userId }, token);
    return data.ToggleFollow;
}

export async function toggleFavourite(variables, token) {
    const data = await query(`
        mutation ($animeId: Int, $mangaId: Int, $characterId: Int, $staffId: Int, $studioId: Int) {
            ToggleFavourite(animeId: $animeId, mangaId: $mangaId, characterId: $characterId, staffId: $staffId, studioId: $studioId) {
                anime { nodes { id } }
                manga { nodes { id } }
            }
        }
    `, variables, token);
    return data.ToggleFavourite;
}

export async function getNotifications(page = 1, token) {
    const data = await query(`
        query ($page: Int) {
            Page(page: $page, perPage: 25) {
                pageInfo { total currentPage lastPage hasNextPage }
                notifications(resetNotificationCount: true) {
                    ... on AiringNotification {
                        id type animeId episode contexts
                        media { id title { userPreferred english romaji native } coverImage { large } }
                        createdAt
                    }
                    ... on FollowingNotification {
                        id type userId
                        user { id name avatar { medium } }
                        createdAt
                    }
                    ... on ActivityLikeNotification {
                        id type userId activityId
                        user { id name avatar { medium } }
                        createdAt
                    }
                    ... on ActivityReplyNotification {
                        id type userId activityId
                        user { id name avatar { medium } }
                        createdAt
                    }
                    ... on RelatedMediaAdditionNotification {
                        id type mediaId
                        media { id title { userPreferred english romaji native } coverImage { large } }
                        createdAt
                    }
                    ... on MediaDataChangeNotification {
                        id type mediaId reason
                        media { id title { userPreferred english romaji native } coverImage { large } }
                        createdAt
                    }
                }
            }
        }
    `, { page }, token);
    return data.Page;
}

export async function postTextActivity(text, token) {
    const data = await query(`
        mutation ($text: String) {
            SaveTextActivity(text: $text) { id }
        }
    `, { text }, token);
    return data.SaveTextActivity;
}

// Personal recommendations with a taste match (0-100).
// The match is built ONLY from the user's own scores, community recommendation votes and genre overlap —
// never from AniList's meanScore, so it can't be confused with (or echo) the global rating.
// Taste profile for the "% Match" (see taste.js): genres, tags and scores of the whole anime list.
// One request, shared by the detail panel and the recommendations. A save clears it with the
// other list caches, so the next match reflects the new score.
const _tasteProfiles = new Map();

export async function getTasteProfile(userId, token = null) {
    const data = await cachedQuery(`
        query ($userId: Int) {
            MediaListCollection(userId: $userId, type: ANIME) {
                lists { entries { score(format: POINT_100) status media { id genres tags { name rank } } } }
            }
        }
    `, { userId }, token, TTL.recommendations);
    const hit = _tasteProfiles.get(userId);
    if (hit?.data === data) return hit.profile;
    const profile = buildTasteProfile((data.MediaListCollection?.lists || []).flatMap(l => l.entries));
    _tasteProfiles.set(userId, { data, profile });
    return profile;
}

export async function getRecommendations(userId, token) {
    const data = await cachedQuery(`
        query ($userId: Int) {
            Page(perPage: 25) {
                mediaList(userId: $userId, type: ANIME, status_in: [COMPLETED, CURRENT, REPEATING], sort: [SCORE_DESC, UPDATED_TIME_DESC]) {
                    score(format: POINT_100)
                    status
                    media {
                        id
                        title { userPreferred english romaji native }
                        genres
                        recommendations(perPage: 6, sort: RATING_DESC) {
                            nodes {
                                rating
                                mediaRecommendation { ...mediaCard tags { name rank isMediaSpoiler } }
                            }
                        }
                    }
                }
            }
        }
        ${MEDIA_CARD_FRAGMENT}
    `, { userId }, token, TTL.recommendations);

    const entries = data.Page?.mediaList || [];
    const scored = entries.filter(e => e.score > 0);
    const meanScore = scored.length ? scored.reduce((s, e) => s + e.score, 0) / scored.length : 70;
    const ownIds = new Set(entries.map(e => e.media.id));

    // How much the user liked a source show; unscored entries count as the user's average
    const likeWeight = (e) => ((e.score || meanScore) / 100) ** 2 * (e.status === 'CURRENT' ? 0.8 : 1);

    // Taste profile: genres weighted by how much the user liked each show
    const genreWeight = {};
    let genreTotal = 0;
    for (const e of entries) {
        const w = likeWeight(e);
        for (const g of e.media.genres || []) {
            genreWeight[g] = (genreWeight[g] || 0) + w;
            genreTotal += w;
        }
    }

    const candidates = new Map();
    for (const e of entries) {
        const w = likeWeight(e);
        for (const node of e.media.recommendations?.nodes || []) {
            const rec = node.mediaRecommendation;
            if (!rec || rec.isAdult || rec.mediaListEntry || ownIds.has(rec.id)) continue;
            const strength = w * Math.log1p(Math.max(node.rating || 0, 0));
            if (strength <= 0) continue;
            const c = candidates.get(rec.id) || { media: rec, strength: 0, because: null, topStrength: 0 };
            c.strength += strength; // recommended by several liked shows → stronger
            if (strength > c.topStrength) {
                c.topStrength = strength;
                c.because = e.media.title;
            }
            candidates.set(rec.id, c);
        }
    }

    const list = [...candidates.values()];
    if (!list.length) return [];
    for (const c of list) {
        c.fit = genreTotal ? (c.media.genres || []).reduce((s, g) => s + (genreWeight[g] || 0), 0) / genreTotal : 0;
    }
    const maxStrength = Math.max(...list.map(c => c.strength));
    const maxFit = Math.max(...list.map(c => c.fit)) || 1;
    for (const c of list) {
        // Ranking only: which shows get recommended, in which order
        c.rank = 0.6 * Math.sqrt(c.strength / maxStrength) + 0.4 * (c.fit / maxFit);
    }

    // The number on the card is the same taste match as in the detail panel, so a show never
    // shows two different percentages. Without a profile (tiny list) fall back to the ranking.
    const profile = await getTasteProfile(userId, token).catch(() => null);

    return list
        .sort((a, b) => b.rank - a.rank || b.strength - a.strength)
        .slice(0, 20)
        .map(c => ({
            media: c.media,
            match: tasteMatch(profile, c.media)?.match ?? Math.round(50 + 49 * c.rank),
            because: c.because,
        }));
}

const _kitsuCache = new Map();
const KITSU_TTL = 30 * 60 * 1000;

export async function getKitsuEpisodes(malId) {
    if (!malId) return null;
    const key = `kitsu_${malId}`;
    const hit = _kitsuCache.get(key);
    if (hit && Date.now() - hit.ts < KITSU_TTL) return hit.data;
    const idbHit = await idbGet(key);
    if (idbHit && Date.now() - idbHit.ts < KITSU_TTL) {
        _kitsuCache.set(key, idbHit);
        return idbHit.data;
    }

    try {
        const mappingRes = await fetch(`https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item&fields[anime]=episodeCount,startDate,endDate,status`);
        if (!mappingRes.ok) return null;
        const mappingJson = await mappingRes.json();
        const animeData = mappingJson.included?.[0];
        if (!animeData) return null;

        const kitsuId = animeData.id;
        const epRes = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=20&sort=number&fields[episodes]=number,airdate,seasonNumber`);
        if (!epRes.ok) return null;
        const epJson = await epRes.json();

        const result = {
            kitsuId,
            episodeCount: animeData.attributes?.episodeCount,
            startDate: animeData.attributes?.startDate,
            endDate: animeData.attributes?.endDate,
            status: animeData.attributes?.status,
            episodes: (epJson.data || []).map(ep => ({
                number: ep.attributes?.number,
                airdate: ep.attributes?.airdate,
            })).filter(ep => ep.airdate)
        };

        const entry = { data: result, ts: Date.now() };
        _kitsuCache.set(key, entry);
        idbSet(key, entry);
        return result;
    } catch {
        if (idbHit) return idbHit.data;
        return null;
    }
}

// IndexedDB persistence for cache
const IDB_NAME = 'aniroll_cache';
const IDB_STORE = 'entries';
const IDB_VERSION = 2;
const CACHE_VERSION = 7; // 7: keys carry the account (scope) instead of a logged-in flag

let _idbReady = null;
function openIdb() {
    if (!_idbReady) _idbReady = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = req.result;
                if (e.oldVersion < 2) {
                    try { db.deleteObjectStore(IDB_STORE); } catch {}
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const vReq = store.get('__cache_version__');
                vReq.onsuccess = () => {
                    if (vReq.result !== CACHE_VERSION) {
                        store.clear();
                        store.put(CACHE_VERSION, '__cache_version__');
                    }
                    resolve(db);
                };
                vReq.onerror = () => resolve(db);
            };
            req.onerror = () => { _idbReady = null; reject(req.error); };
        } catch (e) { _idbReady = null; reject(e); }
    });
    return _idbReady;
}

async function idbGet(key) {
    try {
        const db = await openIdb();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

async function idbSet(key, value) {
    try {
        const db = await openIdb();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
    } catch { /* best effort */ }
}

async function idbDeleteMatching(pattern) {
    try {
        const db = await openIdb();
        await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const req = tx.objectStore(IDB_STORE).openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                if (typeof cursor.key === 'string' && cursor.key.includes(pattern)) cursor.delete();
                cursor.continue();
            };
            tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        });
    } catch { /* best effort */ }
}

async function idbEvict() {
    try {
        const db = await openIdb();
        const estimate = await navigator.storage?.estimate?.();
        const usage = estimate?.usage || 0;
        const IDB_MAX = 200 * 1024 * 1024;
        if (usage < IDB_MAX) return;

        // The oldest quarter by fetch time goes (the version marker stays)
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const entries = [];
        const req = store.openCursor();
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                if (cursor.key !== '__cache_version__') entries.push([cursor.key, cursor.value?.ts || 0]);
                cursor.continue();
                return;
            }
            entries.sort((a, b) => a[1] - b[1]);
            for (const [key] of entries.slice(0, Math.max(1, Math.ceil(entries.length / 4)))) store.delete(key);
        };
    } catch { /* best effort */ }
}

export function getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 1 && month <= 3) return 'WINTER';
    if (month >= 4 && month <= 6) return 'SPRING';
    if (month >= 7 && month <= 9) return 'SUMMER';
    return 'FALL';
}

export function getNextSeason(season, year) {
    const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
    const idx = order.indexOf(season);
    if (idx === 3) return { season: 'WINTER', year: year + 1 };
    return { season: order[idx + 1], year };
}

export function getPrevSeason(season, year) {
    const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
    const idx = order.indexOf(season);
    if (idx === 0) return { season: 'FALL', year: year - 1 };
    return { season: order[idx - 1], year };
}

export function getSeasonName(season) {
    const names = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
    return names[season] || season;
}

export function formatStatus(status) {
    const map = {
        CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed',
        DROPPED: 'Dropped', PAUSED: 'Paused', REPEATING: 'Rewatching'
    };
    return map[status] || status;
}

export function formatMediaStatus(status) {
    const map = {
        FINISHED: 'Finished', RELEASING: 'Releasing', NOT_YET_RELEASED: 'Not Yet Released',
        CANCELLED: 'Cancelled', HIATUS: 'Hiatus'
    };
    return map[status] || status;
}

export function formatFormat(format) {
    const map = {
        TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special',
        OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga',
        NOVEL: 'Novel', ONE_SHOT: 'One Shot'
    };
    return map[format] || format;
}

export function timeUntil(seconds) {
    if (seconds < 60) return '<1m';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

export function timeAgo(timestamp) {
    const diff = Math.floor(Date.now() / 1000) - timestamp;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(timestamp * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
