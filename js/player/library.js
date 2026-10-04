import { getConfig, jfAuth, normTitle, splitYear, splitSeason, nearYear, hasAniListId } from '../jellyfin.js?v=134';
import { linkForMedia } from '../jflinks.js?v=134';

// AniList show + episode -> the Jellyfin item to play. The same title rules as the Jellyfin sync
// (js/jellyfin.js, api/server.js) in the other direction: Jellyfin keeps one series with seasons,
// AniList one entry per season ("Jujutsu Kaisen 2nd Season" = season 2 of "Jujutsu Kaisen").
// Only Jellyfin is asked, never AniList. Found series are kept for a week in this browser, per
// Jellyfin user, so a new tab shows the Play button without searching again. A rescan can give a
// series a new id: a 404 drops the match and the next look searches again.

const CACHE_KEY = 'aniroll_jf_match3'; // 3: kept in localStorage with a date per match
const FOUND_MS = 7 * 24 * 60 * 60 * 1000;
// Same marks as splitSeason, cut off to search for the series name ("Mob Psycho 100 II" -> "Mob Psycho 100")
const SEASON_MARK = /\s*(?:\b\d+(?:st|nd|rd|th)\s+season\b|\bseason\s+\d+\b|\bpart\s+\d+\b|\bS\d+\b).*$/i;
const ROMAN_MARK = /\s(?:II|III|IV|V|VI|VII|VIII|IX|X)$/;

export async function jfGet(base, path, token, timeout = 8000) {
    const res = await fetch(base + path, {
        headers: { ...jfAuth(token), Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
        const err = new Error(`Jellyfin answered ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.status === 204 ? null : res.json();
}

function readCache(cfg) {
    try {
        const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        return all.user === cfg.userId && all.map ? all : { user: cfg.userId, map: {} };
    } catch {
        return { user: cfg.userId, map: {} };
    }
}

function writeCache(cache) {
    // Only the most recent few hundred shows: the oldest go first
    const ids = Object.keys(cache.map);
    if (ids.length > 400) {
        ids.sort((a, b) => (cache.map[a]?.at || cache.map[a]?.missing || 0) - (cache.map[b]?.at || cache.map[b]?.missing || 0))
            .slice(0, ids.length - 400).forEach(id => delete cache.map[id]);
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full or blocked */ }
}

// The stored series answered 404: it was removed or rescanned under a new id
function dropMatch(cfg, mediaId) {
    const cache = readCache(cfg);
    delete cache.map[mediaId];
    writeCache(cache);
}

// jfGet for a stored show: a 404 forgets the match, so the next call searches again
async function showGet(base, cfg, media, path) {
    try {
        return await jfGet(base, path, cfg.apiKey);
    } catch (err) {
        if (err.status === 404) dropMatch(cfg, media.id);
        throw err;
    }
}

function titlesOf(media) {
    const t = media.title || {};
    return [...new Set([t.romaji, t.english, t.userPreferred, ...(media.synonyms || [])].filter(Boolean))];
}

const mediaYear = (media) => media.seasonYear || media.startDate?.year || null;

async function search(base, cfg, term, type) {
    const data = await jfGet(base, `/Users/${encodeURIComponent(cfg.userId)}/Items?searchTerm=${encodeURIComponent(term)}`
        + `&IncludeItemTypes=${type}&Recursive=true&Limit=10&fields=ProductionYear,ProviderIds`, cfg.apiKey);
    return data?.Items || [];
}

// Jellyfin 12 ignores a provider filter it does not know and answers with the whole library
// (Hell's Paradise played Black Torch): a hit only counts when it really carries this AniList id
async function byProviderId(base, cfg, anilistId, type) {
    for (const providerId of [`anilist.${anilistId}`, `AniList.${anilistId}`]) {
        const data = await jfGet(base, `/Users/${encodeURIComponent(cfg.userId)}/Items?AnyProviderIdEquals=${encodeURIComponent(providerId)}`
            + `&IncludeItemTypes=${type}&Recursive=true&Limit=5&fields=ProviderIds`, cfg.apiKey).catch(() => null);
        const hit = (data?.Items || []).find(i => hasAniListId(i, anilistId));
        if (hit) return hit;
    }
    return null;
}

// -> { kind: 'series', id, season, offset? } | { kind: 'movie', id } | null
async function findShow(base, cfg, media) {
    // Linked by hand (js/jflinks.js): that series and season, from the episode the link says
    const link = linkForMedia(media.id);
    if (link?.seriesId) return { kind: 'series', id: link.seriesId, season: link.season, offset: link.offset };

    const movie = media.format === 'MOVIE';
    const type = movie ? 'Movie' : 'Series';
    const year = mediaYear(media);

    const tagged = await byProviderId(base, cfg, media.id, type);
    if (tagged) return movie ? { kind: 'movie', id: tagged.Id } : { kind: 'series', id: tagged.Id, season: splitSeason(titlesOf(media)[0]).season };

    for (const raw of titlesOf(media)) {
        const { title, year: titleYear } = splitYear(raw);
        const items = (await search(base, cfg, title, type)).filter(i =>
            nearYear(titleYear || year, splitYear(i.Name).year || i.ProductionYear));
        const exact = items.find(i => normTitle(splitYear(i.Name).title) === normTitle(title));
        if (exact) return movie ? { kind: 'movie', id: exact.Id } : { kind: 'series', id: exact.Id, season: 1 };
    }
    if (movie) return null;

    // A later season: search the series name without the season, then take that season
    for (const raw of titlesOf(media)) {
        const { title } = splitYear(raw);
        const wanted = splitSeason(title);
        if (wanted.season < 2) continue;
        const name = title.replace(SEASON_MARK, '').replace(ROMAN_MARK, '').replace(/[\s:–-]+$/, '');
        if (!name) continue;
        const hit = (await search(base, cfg, name, 'Series')).find(i => normTitle(splitYear(i.Name).title) === wanted.base);
        if (hit) return { kind: 'series', id: hit.Id, season: wanted.season };
    }
    return null;
}

// A show missing from Jellyfin is looked for again after this long: it may have just been added
// (Mashle was opened while its episode was still downloading and stayed "not there" for the whole tab)
const MISSING_MS = 10 * 60 * 1000;

// The Jellyfin show (or movie) behind an AniList entry, looked up once per session
async function showFor(base, cfg, media) {
    const link = linkForMedia(media.id);
    if (link?.seriesId) return { kind: 'series', id: link.seriesId, season: link.season, offset: link.offset };
    const cache = readCache(cfg);
    let show = cache.map[media.id];
    const stale = show === undefined || show === null
        || (show.missing && Date.now() - show.missing > MISSING_MS)
        || (!show.missing && Date.now() - (show.at || 0) > FOUND_MS);
    if (stale) {
        show = await findShow(base, cfg, media);
        cache.map[media.id] = show ? { ...show, at: Date.now() } : { missing: Date.now() };
        writeCache(cache);
    }
    return show?.missing ? null : show;
}

// Every episode of the AniList entry's season in Jellyfin, in order, with a thumbnail; [] when none.
// [{ itemId, name, episode, episodeEnd, runTimeTicks, positionTicks, played, image }]
export async function listEpisodes(base, media) {
    const cfg = getConfig();
    if (!cfg || !media?.id) return [];
    const show = await showFor(base, cfg, media);
    if (!show || show.kind !== 'series') return [];
    const data = await showGet(base, cfg, media, `/Shows/${encodeURIComponent(show.id)}/Episodes?userId=${encodeURIComponent(cfg.userId)}`
        + `&season=${show.season}&fields=UserData`);
    const offset = show.offset || 0;
    return (data?.Items || [])
        .filter(e => e.ParentIndexNumber === show.season && e.IndexNumber != null && e.IndexNumber > offset)
        // A later part of a season can share Jellyfin's season; AniList knows how many are this entry's
        .filter(e => !media.episodes || e.IndexNumber - offset <= media.episodes)
        .sort((a, b) => a.IndexNumber - b.IndexNumber)
        .map(e => toEpisode(e, base, offset));
}

// The Jellyfin item for episode `episode` of an AniList show, or null.
// { itemId, name, seriesName, season, episode, runTimeTicks, positionTicks, played }
export async function findEpisode(base, media, episode) {
    const cfg = getConfig();
    if (!cfg || !media?.id) return null;

    const show = await showFor(base, cfg, media);
    if (!show) return null;

    if (show.kind === 'movie') {
        const item = await showGet(base, cfg, media, `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(show.id)}`);
        return item ? toEpisode(item, base) : null;
    }

    const data = await showGet(base, cfg, media, `/Shows/${encodeURIComponent(show.id)}/Episodes?userId=${encodeURIComponent(cfg.userId)}`
        + `&season=${show.season}&fields=UserData`);
    const offset = show.offset || 0;
    const want = episode + offset;
    const eps = (data?.Items || []).filter(e => e.ParentIndexNumber === show.season);
    const hit = eps.find(e => e.IndexNumber === want)
        // A double episode in one file: "E05-E06"
        || eps.find(e => e.IndexNumber < want && e.IndexNumberEnd >= want);
    return hit ? toEpisode(hit, base, offset) : null;
}

// episodeEnd: the last episode of a file that holds more than one ("E05-E06" -> 6), else null.
// image: the episode's still from Jellyfin, when base is given and it has one
// offset: Jellyfin episodes before this AniList entry's first (a linked later part): numbers are AniList's
function toEpisode(item, base = null, offset = 0) {
    return {
        itemId: item.Id,
        name: item.Name || '',
        seriesName: item.SeriesName || item.Name || '',
        season: item.ParentIndexNumber ?? null,
        episode: item.IndexNumber != null ? item.IndexNumber - offset : null,
        episodeEnd: item.IndexNumberEnd > item.IndexNumber ? item.IndexNumberEnd - offset : null,
        runTimeTicks: item.RunTimeTicks || 0,
        positionTicks: item.UserData?.PlaybackPositionTicks || 0,
        played: !!item.UserData?.Played,
        image: base && item.ImageTags?.Primary
            ? `${base}/Items/${encodeURIComponent(item.Id)}/Images/Primary?fillWidth=400&quality=80&tag=${encodeURIComponent(item.ImageTags.Primary)}`
            : null,
    };
}

// Marks the episodes of this AniList entry up to `upTo` as played (movies: the movie). Only the
// entry's own season and episode count: AniList progress 5 on season 1 is not season 2's episode 5.
// -> { marked, reason }
export async function markPlayedUpTo(base, media, upTo) {
    const cfg = getConfig();
    if (!cfg || !media?.id || !upTo) return { marked: 0, reason: null };
    const show = await showFor(base, cfg, media);
    if (!show) return { marked: 0, reason: 'series-not-found' };

    let items;
    if (show.kind === 'movie') {
        const item = await showGet(base, cfg, media, `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(show.id)}`);
        items = item ? [item] : [];
    } else {
        const data = await showGet(base, cfg, media, `/Shows/${encodeURIComponent(show.id)}/Episodes?userId=${encodeURIComponent(cfg.userId)}`
            + `&season=${show.season}&fields=UserData`);
        const offset = show.offset || 0;
        const last = Math.min(upTo, media.episodes || Infinity) + offset;
        items = (data?.Items || []).filter(e => e.ParentIndexNumber === show.season && e.IndexNumber != null && e.IndexNumber > offset && e.IndexNumber <= last);
    }
    const pending = items.filter(e => !e.UserData?.Played);

    let marked = 0;
    for (const e of pending) {
        const res = await fetch(`${base}/Users/${encodeURIComponent(cfg.userId)}/PlayedItems/${encodeURIComponent(e.Id)}`, {
            method: 'POST', headers: jfAuth(cfg.apiKey), signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (res?.ok) marked++;
    }
    return { marked, reason: pending.length ? null : 'already-played' };
}

export function forgetMatches() {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* nothing kept */ }
}
