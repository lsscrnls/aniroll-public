// AniList search — the core, without any UI. Extracted from AniRoll (https://aniroll.app).
// Plain ES module, no dependencies. Works in browsers and in Node 18+ (global fetch).
//
//   import { searchAniList, createSearchController, displayTitle } from './anilist-search.js';
//
// Lessons baked in from running this against AniList:
// - Never send an unset variable as null. AniList reads `type: null` as a filter and returns
//   0 results — even for an exact title. Unset variables are left out entirely.
// - AniList rate-limits (30 req/min while degraded, 90 normally). A 429 pauses all searches for
//   the Retry-After time instead of retrying right away, which would only extend the block.
// - Typing fires a request per keystroke unless debounced; late answers for an older query must
//   not overwrite newer results.

const ENDPOINT = 'https://graphql.anilist.co';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MIN_PAUSE_MS = 60 * 1000;

const SEARCH_QUERY = `
query ($search: String, $type: MediaType, $page: Int, $perPage: Int, $isAdult: Boolean) {
    Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage }
        media(search: $search, type: $type, isAdult: $isAdult, sort: [SEARCH_MATCH]) {
            id
            idMal
            type
            format
            status
            episodes
            chapters
            season
            seasonYear
            meanScore
            isAdult
            siteUrl
            title { userPreferred romaji english native }
            coverImage { medium large color }
        }
    }
}`;

export class AniListRateLimitError extends Error {
    constructor(retryAt) {
        super(`AniList is rate limiting — searches pause for ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))}s`);
        this.name = 'AniListRateLimitError';
        this.retryAt = retryAt;
    }
}

const cache = new Map();
let pausedUntil = 0;

function withoutUnset(variables) {
    return Object.fromEntries(Object.entries(variables).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * One search request.
 * @param {string} term
 * @param {object} [options]
 * @param {'ANIME'|'MANGA'|null} [options.type]  null = both
 * @param {number}  [options.page=1]
 * @param {number}  [options.perPage=10]        max 50
 * @param {boolean} [options.includeAdult=false]
 * @param {string}  [options.token]             AniList OAuth token — only needed for the user's own
 *                                              adult-content setting; public search works without
 * @param {AbortSignal} [options.signal]
 * @param {number}  [options.cacheTtlMs=300000] 0 disables the cache
 * @param {Function} [options.fetch]            custom fetch (tests, proxies)
 * @returns {Promise<{ media: object[], pageInfo: object }>}
 */
export async function searchAniList(term, options = {}) {
    const {
        type = null,
        page = 1,
        perPage = 10,
        includeAdult = false,
        token = null,
        signal,
        cacheTtlMs = DEFAULT_TTL_MS,
        fetch: fetchImpl = globalThis.fetch,
    } = options;

    const search = String(term ?? '').trim();
    if (!search) return { media: [], pageInfo: { total: 0, currentPage: 1, lastPage: 1, hasNextPage: false } };
    if (Date.now() < pausedUntil) throw new AniListRateLimitError(pausedUntil);

    const variables = withoutUnset({
        search,
        type,
        page,
        perPage: Math.min(Math.max(perPage, 1), 50),
        // false filters adult titles out; omitted (includeAdult) means "don't filter"
        isAdult: includeAdult ? null : false,
    });

    const key = JSON.stringify(variables);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheTtlMs) return hit.value;

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: SEARCH_QUERY, variables }),
        signal,
    });

    if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 0;
        pausedUntil = Date.now() + Math.max(retryAfter * 1000, MIN_PAUSE_MS);
        throw new AniListRateLimitError(pausedUntil);
    }

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.errors?.length) {
        throw new Error(body?.errors?.[0]?.message || `AniList request failed (${res.status})`);
    }

    const value = { media: body.data.Page.media, pageInfo: body.data.Page.pageInfo };
    if (cacheTtlMs > 0) {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
    }
    return value;
}

/**
 * Search-as-you-type: debounces input, skips terms that are too short, cancels the request for
 * an older term and never reports results out of order.
 *
 *   const controller = createSearchController({
 *       onState: (state) => render(state),   // { status: 'idle'|'short'|'loading'|'done'|'error', term, media, error }
 *   });
 *   input.addEventListener('input', () => controller.update(input.value));
 */
export function createSearchController({
    onState,
    minLength = 3,
    debounceMs = 300,
    ...searchOptions
} = {}) {
    if (typeof onState !== 'function') throw new TypeError('createSearchController: onState callback is required');

    let timer = null;
    let inflight = null;
    let sequence = 0;

    function cancel() {
        clearTimeout(timer);
        inflight?.abort();
        inflight = null;
    }

    function update(rawTerm) {
        const term = String(rawTerm ?? '').trim();
        cancel();
        const mySequence = ++sequence;

        if (!term) return onState({ status: 'idle', term, media: [] });
        if (term.length < minLength) return onState({ status: 'short', term, media: [], minLength });

        timer = setTimeout(async () => {
            inflight = new AbortController();
            onState({ status: 'loading', term, media: [] });
            try {
                const { media, pageInfo } = await searchAniList(term, { ...searchOptions, signal: inflight.signal });
                if (mySequence === sequence) onState({ status: 'done', term, media, pageInfo });
            } catch (error) {
                if (error.name === 'AbortError' || mySequence !== sequence) return;
                onState({ status: 'error', term, media: [], error });
            }
        }, debounceMs);
    }

    return { update, cancel };
}

/** Title in the preferred language, falling back through the others. */
export function displayTitle(media, preference = 'userPreferred') {
    const t = media?.title || {};
    return t[preference] || t.userPreferred || t.english || t.romaji || t.native || '';
}

/** Short meta line like "TV · 2023 · 24 Ep · 90%". */
export function describeMedia(media) {
    const formats = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga', NOVEL: 'Light Novel', ONE_SHOT: 'One Shot' };
    return [
        formats[media.format] || media.format,
        media.seasonYear,
        media.episodes ? `${media.episodes} Ep` : media.chapters ? `${media.chapters} Ch` : null,
        media.meanScore ? `${media.meanScore}%` : null,
    ].filter(Boolean).join(' · ');
}
