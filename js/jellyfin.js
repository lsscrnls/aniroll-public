import { toast } from './store.js?v=102';
import { getToken } from './auth.js?v=102';

// Jellyfin integration: when AniList progress moves forward, mark the matching
// episodes watched on the user's own Jellyfin server.
//
// The connection belongs to the AniList account and is stored on the AniRoll backend,
// so it follows the user to any device. localStorage only mirrors it for instant UI and
// for the moments the backend cannot verify the account (AniList blocks it now and then).
//
// Requests to Jellyfin go straight from the browser whenever possible — the API key then
// stays between the user and their own server. Only if that fails (no CORS headers, or
// plain http called from our https page) do we relay through the backend.
const KEYS = {
    url: 'aniroll_jf_url',
    apiKey: 'aniroll_jf_apikey',
    userId: 'aniroll_jf_userid',
    userName: 'aniroll_jf_username',
    serverName: 'aniroll_jf_servername',
    scope: 'aniroll_jf_scope',
    pull: 'aniroll_jf_pull',
};
const PROXY = '/api/jellyfin/proxy';
const CONFIG_URL = '/api/jellyfin/config';
const STATUS_TTL = 60000;

export function getConfig() {
    const url = localStorage.getItem(KEYS.url);
    const apiKey = localStorage.getItem(KEYS.apiKey);
    const userId = localStorage.getItem(KEYS.userId);
    if (!url || !apiKey || !userId) return null;
    return {
        url, apiKey, userId,
        userName: localStorage.getItem(KEYS.userName) || '',
        serverName: localStorage.getItem(KEYS.serverName) || 'Jellyfin',
    };
}

// 'account' = stored on the backend for this AniList account, 'device' = this browser only
export function getScope() {
    return localStorage.getItem(KEYS.scope) === 'account' ? 'account' : 'device';
}

function writeLocal(cfg, scope) {
    localStorage.setItem(KEYS.url, cfg.url);
    localStorage.setItem(KEYS.apiKey, cfg.apiKey);
    localStorage.setItem(KEYS.userId, cfg.userId);
    localStorage.setItem(KEYS.userName, cfg.userName || '');
    localStorage.setItem(KEYS.serverName, cfg.serverName || 'Jellyfin');
    localStorage.setItem(KEYS.scope, scope);
    statusCache = null;
}

function clearLocal() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    statusCache = null;
}

export function normalizeUrl(raw) {
    let url = String(raw || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url;
}

// Jellyfin 12 only accepts the MediaBrowser scheme; X-Emby-Token stays for 10.x servers
// behind proxies that strip Authorization.
function jfAuth(apiKey) {
    return {
        Authorization: `MediaBrowser Token="${apiKey}"`,
        'X-Emby-Token': apiKey,
    };
}

function authHeaders(json = false) {
    const token = getToken();
    return {
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

// Pulls the account's connection from the backend — call this after login
export async function loadAccountConfig() {
    if (!getToken()) return null;
    try {
        const res = await fetch(CONFIG_URL, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
        if (res.status === 404) {
            // The account has no connection; only drop a mirror that came from the account
            if (getScope() === 'account') clearLocal();
            return null;
        }
        if (!res.ok) return getConfig(); // 401/503: keep whatever this browser has
        const cfg = await res.json();
        writeLocal(cfg, 'account');
        return getConfig();
    } catch {
        return getConfig();
    }
}

async function saveAccountConfig(cfg) {
    if (!getToken()) return false;
    try {
        const res = await fetch(CONFIG_URL, {
            method: 'PUT',
            headers: authHeaders(true),
            body: JSON.stringify(cfg),
            signal: AbortSignal.timeout(10000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// Stores an already verified connection on the account (used by the retry button)
export async function saveToAccount() {
    const cfg = getConfig();
    if (!cfg) return false;
    const ok = await saveAccountConfig(cfg);
    if (ok) localStorage.setItem(KEYS.scope, 'account');
    return ok;
}

export async function clearConfig() {
    if (getToken()) {
        try {
            await fetch(CONFIG_URL, { method: 'DELETE', headers: authHeaders(), signal: AbortSignal.timeout(8000) });
        } catch { /* removed locally either way */ }
    }
    clearLocal();
}

async function viaProxy(cfg, path, method) {
    const res = await fetch(PROXY, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ url: cfg.url, apiKey: cfg.apiKey, path, method }),
        signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Relay failed (${res.status})`);
    return { status: body.status, data: body.data };
}

async function request(cfg, path, method = 'GET') {
    try {
        const res = await fetch(cfg.url + path, {
            method,
            headers: { ...jfAuth(cfg.apiKey), Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
        });
        const data = res.status === 204 ? null : await res.json().catch(() => null);
        return { status: res.status, data };
    } catch {
        // CORS, mixed content or simply not reachable from here — try the backend relay
        return viaProxy(cfg, path, method);
    }
}

// Verifies server + API key, resolves the Jellyfin user, then stores the connection
export async function connect(rawUrl, apiKey, username) {
    const cfg = { url: normalizeUrl(rawUrl), apiKey: String(apiKey || '').trim() };
    if (!cfg.url || !cfg.apiKey) throw new Error('Server URL and API key are required');

    const info = await request(cfg, '/System/Info');
    if (info.status === 401 || info.status === 403) throw new Error('Jellyfin rejected the API key');
    if (info.status !== 200 || !info.data) throw new Error(`No usable answer from the server (HTTP ${info.status})`);

    const users = await request(cfg, '/Users');
    if (users.status !== 200 || !Array.isArray(users.data)) throw new Error('Could not read the user list from Jellyfin');

    const wanted = String(username || '').trim().toLowerCase();
    const user = wanted
        ? users.data.find(u => String(u.Name || '').toLowerCase() === wanted)
        : (users.data.length === 1 ? users.data[0] : null);
    if (!user) {
        const names = users.data.map(u => u.Name).filter(Boolean).join(', ');
        throw new Error(wanted ? `No Jellyfin user called "${username}"` : `Enter your Jellyfin username (${names})`);
    }

    const full = {
        url: cfg.url,
        apiKey: cfg.apiKey,
        userId: user.Id,
        userName: user.Name || '',
        serverName: info.data.ServerName || 'Jellyfin',
    };
    const onAccount = await saveAccountConfig(full);
    writeLocal(full, onAccount ? 'account' : 'device');
    return { ...full, version: info.data.Version, scope: onAccount ? 'account' : 'device' };
}

let statusCache = null;

export async function getStatus(force = false) {
    const cfg = getConfig();
    if (!cfg) return { state: 'off' };
    if (!force && statusCache && Date.now() - statusCache.ts < STATUS_TTL) return statusCache.value;

    let value;
    try {
        const info = await request(cfg, '/System/Info');
        if (info.status === 200 && info.data) {
            value = {
                state: 'connected',
                serverName: info.data.ServerName || cfg.serverName,
                version: info.data.Version || '',
                userName: cfg.userName,
            };
        } else {
            value = { state: 'error', error: (info.status === 401 || info.status === 403) ? 'API key rejected' : `HTTP ${info.status}` };
        }
    } catch {
        value = { state: 'error', error: 'Server not reachable' };
    }
    statusCache = { ts: Date.now(), value };
    return value;
}

export function invalidateStatus() { statusCache = null; }

const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// "False Memory (2026)" -> { title: 'False Memory', year: 2026 }. AniList adds the year when two
// entries share a name; the Jellyfin folder may or may not carry it.  (same rule as api/server.js)
function splitYear(title) {
    const m = String(title || '').match(/^(.*\S)\s*\((\d{4})\)$/);
    return m ? { title: m[1], year: Number(m[2]) } : { title: String(title || ''), year: null };
}

const nearYear = (a, b) => !a || !b || Math.abs(a - b) <= 1;

// Jellyfin libraries rarely carry AniList ids, so fall back to a title search. Jellyfin finds
// nothing for "False Memory (2026)", so the year is searched apart and has to fit the series.
async function findSeries(cfg, anilistId, titles, year) {
    for (const providerId of [`anilist.${anilistId}`, `AniList.${anilistId}`]) {
        const r = await request(cfg, `/Users/${encodeURIComponent(cfg.userId)}/Items?AnyProviderIdEquals=${encodeURIComponent(providerId)}&IncludeItemTypes=Series&Recursive=true`);
        const hit = r.data?.Items?.[0];
        if (hit) return hit;
    }
    for (const raw of (titles || []).filter(Boolean)) {
        const { title, year: titleYear } = splitYear(raw);
        const r = await request(cfg, `/Users/${encodeURIComponent(cfg.userId)}/Items?searchTerm=${encodeURIComponent(title)}&IncludeItemTypes=Series&Recursive=true&limit=5`);
        const items = (r.data?.Items || []).filter(i =>
            nearYear(titleYear || year, splitYear(i.Name).year || i.ProductionYear));
        const exact = items.find(i => normTitle(splitYear(i.Name).title) === normTitle(title));
        if (exact || items.length === 1) return exact || items[0];
    }
    return null;
}

// Marks every episode up to `episode` as played — progress can jump by more than one
// (party sync, several +1 in a row); episodes already played are skipped.
export async function markWatched(anilistId, episode, titles, year = null) {
    const cfg = getConfig();
    if (!cfg || !episode) return null;

    const series = await findSeries(cfg, anilistId, titles, year);
    if (!series) return { marked: 0, reason: 'series-not-found' };

    const eps = await request(cfg, `/Shows/${encodeURIComponent(series.Id)}/Episodes?userId=${encodeURIComponent(cfg.userId)}&fields=UserData`);
    const pending = (eps.data?.Items || []).filter(e =>
        e.ParentIndexNumber !== 0 && e.IndexNumber && e.IndexNumber <= episode && !e.UserData?.Played);

    let marked = 0;
    for (const e of pending) {
        const r = await request(cfg, `/Users/${encodeURIComponent(cfg.userId)}/PlayedItems/${encodeURIComponent(e.Id)}`, 'POST');
        if (r.status >= 200 && r.status < 300) marked++;
    }
    return { marked, series: series.Name, reason: pending.length ? null : 'already-played' };
}

// Fire-and-forget hook from saveMediaListEntry — never blocks or breaks a list update
// getMedia resolves to { titles, year }
export async function syncProgress(anilistId, episode, getMedia) {
    if (!getConfig() || !episode) return;
    try {
        const { titles = [], year = null } = (typeof getMedia === 'function' ? await getMedia().catch(() => null) : getMedia) || {};
        const res = await markWatched(anilistId, episode, titles, year);
        if (res?.marked) {
            toast(`Jellyfin: ${res.marked} episode${res.marked > 1 ? 's' : ''} marked watched`, 'success');
        } else if (res?.reason === 'series-not-found') {
            console.warn('Jellyfin: no series found for AniList id', anilistId, titles);
        }
    } catch (err) {
        console.error('Jellyfin sync failed:', err);
    }
}

// ===== Jellyfin -> AniList =====
// Watching an episode in Jellyfin should move AniList forward too. Matching is deliberately
// strict: the Jellyfin series name must equal one of the AniList titles exactly (normalised),
// the season must line up, the target is capped at the episode count and progress never
// moves backwards — a wrong guess would otherwise skip ahead in someone's list.
export function isPullEnabled() {
    return localStorage.getItem(KEYS.pull) !== 'off';
}

export function setPullEnabled(on) {
    localStorage.setItem(KEYS.pull, on ? 'on' : 'off');
}

// "Jujutsu Kaisen 2nd Season" -> { base: 'jujutsukaisen', season: 2 }
function splitSeason(title) {
    const t = String(title || '');
    const m = t.match(/(?:\b(\d+)(?:st|nd|rd|th)\s+season\b|\bseason\s+(\d+)\b|\bpart\s+(\d+)\b|\bS(\d+)\b)/i);
    const season = m ? Number(m[1] || m[2] || m[3] || m[4]) : 1;
    const base = normTitle(m ? t.slice(0, m.index) : t);
    return { base, season };
}

// One request: the episodes Jellyfin considers played, newest first, grouped per season
export async function playedProgress() {
    const cfg = getConfig();
    if (!cfg) return [];
    const r = await request(cfg, `/Users/${encodeURIComponent(cfg.userId)}/Items`
        + '?IncludeItemTypes=Episode&Recursive=true&Filters=IsPlayed'
        + '&SortBy=DatePlayed&SortOrder=Descending&Limit=300'
        + '&fields=SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ProductionYear');

    const groups = new Map();
    for (const ep of r.data?.Items || []) {
        if (!ep.SeriesName || !ep.IndexNumber) continue;
        const season = ep.ParentIndexNumber ?? 1; // NOT `|| 1`: season 0 (specials) must stay 0
        if (season === 0) continue;
        const key = `${ep.SeriesName}|${season}`;
        const prev = groups.get(key);
        if (!prev || ep.IndexNumber > prev.maxEpisode) {
            const playedAt = Date.parse(ep.UserData?.LastPlayedDate || '') || 0;
            groups.set(key, { seriesName: ep.SeriesName, season, maxEpisode: ep.IndexNumber, year: ep.ProductionYear || null, playedAt });
        }
    }
    return [...groups.values()];
}

// ===== Live tracking: Jellyfin Webhook plugin -> AniRoll backend =====
// Jellyfin posts playback events to our backend, which shows what is playing and moves
// AniList forward as soon as an episode passes 90% — even with no AniRoll tab open. The
// browser reads that state with the webhook secret (no AniList request at all).
const HOOK_KEY = 'aniroll_jf_hook';
export const NOW_EVENT = 'aniroll:jf-now';
// Fired for every episode the backend just wrote to AniList, so anything showing an episode
// counter (the Watch Party) can follow immediately instead of waiting for its own refresh
export const TRACKED_EVENT = 'aniroll:jf-tracked';

export function getHookSecret() {
    return localStorage.getItem(HOOK_KEY);
}

function setHookSecret(secret) {
    if (secret) localStorage.setItem(HOOK_KEY, secret);
    else localStorage.removeItem(HOOK_KEY);
}

async function hookRequest(method) {
    const res = await fetch('/api/jellyfin/hook', { method, headers: authHeaders(), signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Webhook request failed (${res.status})`);
    setHookSecret(body.secret);
    return body;
}

export const loadHook = () => hookRequest('GET');
export const createHook = () => hookRequest('POST');
export const removeHook = () => hookRequest('DELETE');

let nowState = null;
let nowTimer = null;
let newestSeen = 0;
let nowHandlers = {};

export function getNowState() {
    return nowState;
}

export async function fetchNow() {
    const secret = getHookSecret();
    if (!secret) return null;
    const res = await fetch('/api/jellyfin/now', { headers: { 'X-Hook-Secret': secret }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401) {
        setHookSecret(null); // removed or renewed on another device
        return null;
    }
    if (!res.ok) throw new Error(`Now playing unavailable (${res.status})`);
    return res.json();
}

export async function ackPending(ids) {
    const secret = getHookSecret();
    if (!secret || !ids.length) return;
    await fetch('/api/jellyfin/now/ack', {
        method: 'POST',
        headers: { 'X-Hook-Secret': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    }).catch(() => {});
}

// handlers: onTracked(item) for every newly tracked episode, onPending(items, state).
// Called again without handlers (after setting up the webhook) it keeps the earlier ones.
export function startNowPlaying(handlers) {
    if (handlers) nowHandlers = handlers;
    stopNowPlaying();
    document.addEventListener('visibilitychange', onNowVisible);
    pollNow();
}

export function stopNowPlaying() {
    clearTimeout(nowTimer);
    nowTimer = null;
    document.removeEventListener('visibilitychange', onNowVisible);
}

function onNowVisible() {
    if (document.visibilityState === 'visible') {
        clearTimeout(nowTimer);
        pollNow();
    }
}

async function pollNow() {
    clearTimeout(nowTimer);
    if (!getHookSecret()) {
        if (nowState) {
            nowState = null;
            window.dispatchEvent(new CustomEvent(NOW_EVENT, { detail: null }));
        }
        return; // restarted when live tracking is set up
    }
    try {
        const data = await fetchNow();
        nowState = data;
        if (data) {
            // Only items tracked after this page started polling announce themselves
            const newest = Math.max(0, ...data.recent.map(r => r.at));
            if (newestSeen) {
                data.recent.filter(r => r.at > newestSeen).reverse().forEach(r => {
                    nowHandlers.onTracked?.(r);
                    window.dispatchEvent(new CustomEvent(TRACKED_EVENT, { detail: r }));
                });
            }
            newestSeen = Math.max(newestSeen || Date.now() - 1, newest);
            if (data.pending.length) nowHandlers.onPending?.(data.pending, data);
        }
        window.dispatchEvent(new CustomEvent(NOW_EVENT, { detail: data }));
    } catch { /* backend unreachable: try again on the next tick */ }
    // Our backend only, no AniList: every 10s on screen, once a minute in the background
    nowTimer = setTimeout(pollNow, document.visibilityState === 'visible' ? 10000 : 60000);
}

// The episode has to fit, then the year decides  (same weights as matchFit in api/server.js)
function matchFit(media, group) {
    let fit = 0;
    if (group.maxEpisode && media.episodes) fit += group.maxEpisode <= media.episodes ? 2 : -4;
    const year = splitYear(group.seriesName).year || group.year;
    const mediaYear = media.seasonYear || media.startDate?.year || null;
    if (year && mediaYear) fit += nearYear(year, mediaYear) ? 1 : -3;
    return fit;
}

// Pushes AniList forward where Jellyfin is further along; returns what it changed
export async function pullFromJellyfin(user, token) {
    if (!getConfig() || !isPullEnabled() || !user?.id || !token) return { updated: 0, changes: [] };
    const api = await import('./api.js?v=102');
    if (api.isBackgroundPaused()) return { updated: 0, changes: [], skipped: 'maintenance' };
    if (api.isRateLimited()) return { updated: 0, changes: [], skipped: 'rate-limited' };

    const played = await playedProgress();
    if (!played.length) return { updated: 0, changes: [] };

    const lists = await api.getMediaList(user.id, 'ANIME', token);
    const entries = ['CURRENT', 'PAUSED', 'REPEATING']
        .flatMap(status => lists.find(l => l.status === status)?.entries || []);

    // Which played Jellyfin series each list entry stands for
    const claims = [];
    for (const entry of entries) {
        const m = entry.media;
        const titles = [m.title?.romaji, m.title?.english, m.title?.userPreferred, m.title?.native].filter(Boolean).map(splitYear);
        const wanted = splitSeason(titles[0]?.title);

        const hit = played.find(p => {
            const show = splitYear(p.seriesName);
            const exact = titles.some(t => nearYear(t.year, show.year || p.year) && normTitle(t.title) === normTitle(show.title));
            if (exact) return p.season === 1 || p.season === wanted.season;
            // Season spin-offs: Jellyfin keeps one series with seasons, AniList one entry per season
            return wanted.season > 1 && normTitle(show.title) === wanted.base && p.season === wanted.season;
        });
        const fit = hit ? matchFit(m, hit) : 0;
        // Neither the episode nor the year fits: another show of the same name, leave it alone
        if (hit && fit > -7) claims.push({ entry, hit, titles, fit });
    }
    // Two entries sharing a name ("False Memory" 2020 and 2026) claim the same series: the better fit wins
    const best = new Map();
    for (const c of claims) {
        const key = `${c.hit.seriesName}|${c.hit.season}`;
        if (!best.has(key) || c.fit > best.get(key).fit) best.set(key, c);
    }

    const changes = [];
    for (const { entry, hit, titles: named } of best.values()) {
        const m = entry.media;
        const titles = named.map(t => t.title);
        const target = Math.min(hit.maxEpisode, m.episodes || hit.maxEpisode);
        if (target <= (entry.progress || 0)) continue;
        // The list was changed after that episode was played (someone set it back by hand): that wins,
        // or every pull would push the same episode again
        if (hit.playedAt && entry.updatedAt && hit.playedAt <= entry.updatedAt * 1000) continue;

        try {
            await api.saveMediaListEntry(api.progressVars(entry, target, m.episodes), token);
            changes.push({ title: titles[0], from: entry.progress || 0, to: target });
        } catch (err) {
            if (err.rateLimited) break; // queued, try again later
            console.warn('Jellyfin pull failed for', titles[0], err.message);
        }
        await new Promise(r => setTimeout(r, 700)); // stay under AniList's write limit
    }
    return { updated: changes.length, changes };
}
