// @ts-check
// Taste matches already worked out (js/dna.js matchDna), kept in this browser for a week: Social shows them
// next to friends, the own profile the closest ones. { [userId]: { name, match, at } }
const KEY = 'aniroll_dna_matches';
const FRESH_MS = 7 * 24 * 3600 * 1000;
const MAX = 300;

/** @returns {Record<string, { name: string, match: number, at: number }>} */
export function knownMatches() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function freshMatch(id) {
    const hit = knownMatches()[id];
    return hit && Date.now() - hit.at < FRESH_MS ? hit : null;
}

export function keepMatch(id, name, match) {
    const all = knownMatches();
    all[id] = { name, match, at: Date.now() };
    const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const old of ids.slice(MAX)) delete all[old];
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* not kept */ }
}

export function matchVerdict(match) {
    if (match >= 85) return 'Taste twins';
    if (match >= 70) return 'Very alike';
    if (match >= 55) return 'Plenty in common';
    if (match >= 40) return 'Different worlds, a few bridges';
    return 'Opposites';
}
