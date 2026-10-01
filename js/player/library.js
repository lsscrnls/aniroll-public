import { getConfig, jfAuth, normTitle, splitYear, splitSeason, nearYear, hasAniListId } from '../jellyfin.js?v=128';

// AniList show + episode -> the Jellyfin item to play. The same title rules as the Jellyfin sync
// (js/jellyfin.js, api/server.js) in the other direction: Jellyfin keeps one series with seasons,
// AniList one entry per season ("Jujutsu Kaisen 2nd Season" = season 2 of "Jujutsu Kaisen").
// Only Jellyfin is asked, never AniList. Found series are kept for the session, per Jellyfin user.

const CACHE_KEY = 'aniroll_jf_match2'; // 2: matches from before the provider-id check were wrong
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
        const all = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
        return all.user === cfg.userId ? all : { user: cfg.userId, map: {} };
    } catch {
        return { user: cfg.userId, map: {} };
    }
}

function writeCache(cache) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full or blocked */ }
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

// -> { kind: 'series', id, season } | { kind: 'movie', id } | null
async function findShow(base, cfg, media) {
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

// The Jellyfin show (or movie) behind an AniList entry, looked up once per session
async function showFor(base, cfg, media) {
    const cache = readCache(cfg);
    let show = cache.map[media.id];
    if (show === undefined) {
        show = await findShow(base, cfg, media);
        cache.map[media.id] = show; // null too: no need to search again this session
        writeCache(cache);
    }
    return show;
}

// Every episode of the AniList entry's season in Jellyfin, in order, with a thumbnail; [] when none.
// [{ itemId, name, episode, episodeEnd, runTimeTicks, positionTicks, played, image }]
export async function listEpisodes(base, media) {
    const cfg = getConfig();
    if (!cfg || !media?.id) return [];
    const show = await showFor(base, cfg, media);
    if (!show || show.kind !== 'series') return [];
    const data = await jfGet(base, `/Shows/${encodeURIComponent(show.id)}/Episodes?userId=${encodeURIComponent(cfg.userId)}`
        + `&season=${show.season}&fields=UserData`, cfg.apiKey);
    return (data?.Items || [])
        .filter(e => e.ParentIndexNumber === show.season && e.IndexNumber != null)
        // A later part of a season can share Jellyfin's season; AniList knows how many are this entry's
        .filter(e => !media.episodes || e.IndexNumber <= media.episodes)
        .sort((a, b) => a.IndexNumber - b.IndexNumber)
        .map(e => ({
            ...toEpisode(e),
            episodeEnd: e.IndexNumberEnd ?? null,
            image: e.ImageTags?.Primary ? `${base}/Items/${encodeURIComponent(e.Id)}/Images/Primary?fillWidth=400&quality=80&tag=${encodeURIComponent(e.ImageTags.Primary)}` : null,
        }));
}

// The Jellyfin item for episode `episode` of an AniList show, or null.
// { itemId, name, seriesName, season, episode, runTimeTicks, positionTicks, played }
export async function findEpisode(base, media, episode) {
    const cfg = getConfig();
    if (!cfg || !media?.id) return null;

    const show = await showFor(base, cfg, media);
    if (!show) return null;

    if (show.kind === 'movie') {
        const item = await jfGet(base, `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(show.id)}`, cfg.apiKey);
        return item ? toEpisode(item) : null;
    }

    const data = await jfGet(base, `/Shows/${encodeURIComponent(show.id)}/Episodes?userId=${encodeURIComponent(cfg.userId)}`
        + `&season=${show.season}&fields=UserData`, cfg.apiKey);
    const eps = (data?.Items || []).filter(e => e.ParentIndexNumber === show.season);
    const hit = eps.find(e => e.IndexNumber === episode)
        // A double episode in one file: "E05-E06"
        || eps.find(e => e.IndexNumber < episode && e.IndexNumberEnd >= episode);
    return hit ? toEpisode(hit) : null;
}

function toEpisode(item) {
    return {
        itemId: item.Id,
        name: item.Name || '',
        seriesName: item.SeriesName || item.Name || '',
        season: item.ParentIndexNumber ?? null,
        episode: item.IndexNumber ?? null,
        runTimeTicks: item.RunTimeTicks || 0,
        positionTicks: item.UserData?.PlaybackPositionTicks || 0,
        played: !!item.UserData?.Played,
    };
}

export function forgetMatches() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* nothing kept */ }
}
