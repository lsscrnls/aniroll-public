// Watch order of a franchise (js/pages/detail.js): every part linked by AniList's PREQUEL/SEQUEL, in two orders.
//   GET /api/watchorder/<anilistId>  { release: [ids], story: [ids], same, media: { id: { title, format, ... } } }
// Release: by start date. Story: AniList's own prequel/sequel links, which are about the story, not the airing
// (Fate/Zero is the prequel of Fate/stay night though it came later); parts with no link between them keep
// their release order. Asked of AniList from here, one request per step through the chain, and kept a week for
// every part of it: the next visitor of any of them gets it without AniList.
const path = require('path');

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PARTS = 60;
const MAX_STEPS = 15;
const MAX_KEPT = 4000;

const QUERY = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) {
    id format status episodes startDate { year month day } title { userPreferred romaji english native } coverImage { medium }
    relations { edges { relationType(version: 2) node { id type format } } }
} } }`;

module.exports = function watchOrder({ dataDir, readJson, writeJson, json, overLimit, clientIp, anilist }) {
    const file = path.join(dataDir, 'watchorder.json');
    const running = new Map(); // id -> promise, so a franchise is walked once when many ask at once

    // { byId: { id: key }, orders: { key: { at, release, story, same, media } } }
    const load = () => { const all = readJson(file); return { byId: all.byId || {}, orders: all.orders || {} }; };

    const dateKey = (m) => {
        const d = m.startDate || {};
        // Not yet dated goes last, in id order
        return d.year ? d.year * 10000 + (d.month || 12) * 100 + (d.day || 31) : 99999999;
    };
    const byRelease = (a, b) => dateKey(a) - dateKey(b) || a.id - b.id;

    async function walk(startId) {
        const parts = new Map();
        let next = [startId];
        for (let step = 0; next.length && step < MAX_STEPS && parts.size < MAX_PARTS; step++) {
            const body = await anilist(QUERY, { ids: next.slice(0, 50) });
            const found = body?.data?.Page?.media || [];
            const more = new Set();
            for (const m of found) {
                if (parts.has(m.id) || m.format === 'MUSIC') continue;
                parts.set(m.id, m);
                for (const e of m.relations?.edges || []) {
                    if (!['PREQUEL', 'SEQUEL'].includes(e.relationType) || e.node?.type !== 'ANIME' || e.node.format === 'MUSIC') continue;
                    if (!parts.has(e.node.id)) more.add(e.node.id);
                }
            }
            next = [...more].filter(id => !parts.has(id));
        }
        return parts;
    }

    function orders(parts) {
        const list = [...parts.values()];
        const release = [...list].sort(byRelease);
        // before -> after, from both sides of each link
        const after = new Map(list.map(m => [m.id, new Set()]));
        for (const m of list) {
            for (const e of m.relations?.edges || []) {
                const other = e.node?.id;
                if (!parts.has(other) || other === m.id) continue;
                if (e.relationType === 'SEQUEL') after.get(m.id).add(other);
                if (e.relationType === 'PREQUEL') after.get(other).add(m.id);
            }
        }
        // Kahn's sort, the earliest released first among those that may come next. A loop in the links
        // (it happens) is broken by taking the earliest released of what is left
        const before = new Map(list.map(m => [m.id, 0]));
        for (const set of after.values()) for (const id of set) before.set(id, before.get(id) + 1);
        const left = new Set(list.map(m => m.id));
        const story = [];
        while (left.size) {
            const ready = release.filter(m => left.has(m.id) && before.get(m.id) === 0);
            const pick = ready[0] || release.find(m => left.has(m.id));
            left.delete(pick.id);
            story.push(pick);
            for (const id of after.get(pick.id)) before.set(id, before.get(id) - 1);
        }
        const ids = (arr) => arr.map(m => m.id);
        const slim = Object.fromEntries(list.map(m => [m.id, {
            id: m.id, title: m.title, format: m.format, status: m.status, episodes: m.episodes, startDate: m.startDate, cover: m.coverImage?.medium || null,
        }]));
        return { release: ids(release), story: ids(story), same: ids(release).join() === ids(story).join(), media: slim };
    }

    async function compute(id) {
        const parts = await walk(id);
        if (!parts.has(id)) return null;
        const result = { at: Date.now(), ...orders(parts) };
        const all = load();
        const key = String(Math.min(...parts.keys()));
        // Old ones go first when there are too many
        const keys = Object.keys(all.orders);
        if (keys.length >= MAX_KEPT) {
            const old = keys.sort((a, b) => all.orders[a].at - all.orders[b].at).slice(0, Math.ceil(MAX_KEPT / 10));
            for (const k of old) delete all.orders[k];
            for (const [i, k] of Object.entries(all.byId)) if (!all.orders[k]) delete all.byId[i];
        }
        all.orders[key] = result;
        for (const p of parts.keys()) all.byId[p] = key;
        writeJson(file, all, { pretty: false });
        return result;
    }

    async function handle(req, res, pathname) {
        const m = /^\/api\/watchorder\/(\d{1,9})$/.exec(pathname);
        if (!m || req.method !== 'GET') return json(res, 404, { error: 'Not found' });
        const id = Number(m[1]);
        const all = load();
        const kept = all.orders[all.byId[id]];
        if (kept && Date.now() - kept.at < KEEP_MS && kept.media[id]) return json(res, 200, kept);
        if (overLimit('watchorder-ip', clientIp(req), 10, 60000)) return json(res, 429, { error: 'Too many requests, try again in a minute' });
        try {
            if (!running.has(id)) running.set(id, compute(id).finally(() => running.delete(id)));
            const result = await running.get(id);
            if (result) return json(res, 200, result);
            return json(res, 404, { error: 'No such anime' });
        } catch (e) {
            // AniList busy or away: an older answer is better than none
            if (kept) return json(res, 200, kept);
            return json(res, 503, { error: 'AniList isn’t answering right now' });
        }
    }

    return { handle };
};
