// @ts-check
import { accountState, saveAccountState } from './accountstate.js?v=149';

// Jellyfin series linked to an AniList entry by hand, for shows the title rules cannot match (another
// name, a second part filed as episodes 13–24 of season 1). Kept with the account (key "jflinks"),
// so the server's webhook uses them too (api/server.js linkFor):
//   { "<series>|<season>": [mediaId, offset, jellyfinSeriesId] }
// offset: Jellyfin episodes before the entry's first one (Jellyfin 13 = AniList 1 -> 12)
const KEY = 'aniroll_jf_links';
const ACCOUNT_KEY = 'jflinks';

export const linkKey = (series, season) => `${String(series || '').toLowerCase().replace(/\s*\(\d{4}\)\s*$/, '').replace(/[^a-z0-9]+/g, '')}|${season ?? 1}`;

function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function links() {
    return readLocal();
}

// The account's links join the local ones once per page load (the account wins on a conflict)
export async function syncLinks() {
    const state = await accountState();
    const remote = state[ACCOUNT_KEY] && typeof state[ACCOUNT_KEY] === 'object' ? state[ACCOUNT_KEY] : {};
    const merged = { ...readLocal(), ...remote };
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* this tab only */ }
    return merged;
}

export function setLink(series, season, mediaId, offset = 0, seriesId = null) {
    const all = readLocal();
    all[linkKey(series, season)] = [mediaId, Math.max(0, offset | 0), seriesId];
    save(all);
}

export function removeLink(key) {
    const all = readLocal();
    delete all[key];
    save(all);
}

function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* not kept */ }
    saveAccountState(ACCOUNT_KEY, all);
}

// The link made for this AniList entry, if any: { key, season, offset, seriesId }
export function linkForMedia(mediaId) {
    for (const [key, v] of Object.entries(readLocal())) {
        if (Array.isArray(v) && v[0] === mediaId) return { key, season: Number(key.split('|')[1]) || 1, offset: v[1] || 0, seriesId: v[2] || null };
    }
    return null;
}

// The link for a Jellyfin series and season: { mediaId, offset }
export function linkForSeries(series, season) {
    const v = readLocal()[linkKey(series, season)];
    return Array.isArray(v) ? { mediaId: v[0], offset: v[1] || 0 } : null;
}
