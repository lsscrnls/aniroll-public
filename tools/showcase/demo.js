// A made-up AniList account for screenshots and clips: the list below is invented, everything about the
// shows themselves (titles, covers, airing times, recommendations) comes live from AniList without a token.
// No real profile, no real friends' names. Queries about the demo user are answered here; everything else
// goes to AniList and gets the demo user's list entries patched into `mediaListEntry`.
const { parse, print } = require('graphql');
const { respond: mockRespond } = require('../e2e/mock');

const VIEWER = {
    id: 424242, name: 'demo',
    avatar: { large: 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png', medium: 'https://s4.anilist.co/file/anilistcdn/user/avatar/medium/default.png' },
};
const API = 'https://graphql.anilist.co';

// status → [mediaId, score] (score 0 = unscored)
const LIST = {
    COMPLETED: [[5114, 96], [9253, 92], [1, 90], [154587, 95], [101348, 93], [11061, 91], [21507, 88], [16498, 85],
        [21519, 89], [199, 94], [1535, 82], [20954, 87], [97986, 90], [21827, 84], [113415, 80], [127230, 83],
        [130003, 92], [21087, 81], [101922, 76]],
    PLANNING: [[457, 0], [128547, 0], [153518, 0], [161645, 0], [99088, 0], [124080, 0], [145064, 0], [98659, 0],
        [108632, 0], [150672, 0], [140960, 0], [20464, 0]],
    CURRENT: [], // filled from what is airing right now, see init()
    PAUSED: [[21, 0]],
};

const entries = new Map(); // mediaId → entry
const NOW = Math.floor(Date.now() / 1000);

async function anilist(query, variables = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 65000)); continue; }
        return res.json();
    }
    throw new Error('AniList keeps rate limiting');
}

// Currently airing shows become "Watching", one or two episodes behind
async function init() {
    const data = await anilist(`{ Page(perPage: 7) { media(type: ANIME, status: RELEASING, format: TV, sort: POPULARITY_DESC, isAdult: false) { id nextAiringEpisode { episode } } } }`);
    LIST.CURRENT = data.data.Page.media.filter(m => m.id !== 21 && m.nextAiringEpisode)
        .slice(0, 6).map((m, i) => [m.id, 0, Math.max(1, m.nextAiringEpisode.episode - 1 - (i % 3 === 2 ? 2 : 0))]);
    let n = 0;
    for (const [status, list] of Object.entries(LIST)) {
        for (const [mediaId, score, progress] of list) {
            n++;
            entries.set(mediaId, {
                id: 9000000 + mediaId, mediaId, status, score,
                progress: progress ?? (status === 'COMPLETED' ? null : status === 'PAUSED' ? 1071 : 0),
                progressVolumes: 0, repeat: 0, notes: null, private: false, hiddenFromStatusLists: false, priority: 0,
                updatedAt: NOW - n * 5400, createdAt: NOW - n * 86400 * 9,
                startedAt: { year: 2025, month: 1 + (n % 12), day: 1 + (n % 27) },
                completedAt: status === 'COMPLETED' ? { year: 2025, month: 1 + ((n + 1) % 12), day: 2 + (n % 26) } : { year: null, month: null, day: null },
                customLists: null, advancedScores: null,
            });
        }
    }
}

// Completed shows have all episodes: fill progress once the media (and its episode count) is known
function entryFor(mediaId, media) {
    const e = entries.get(mediaId);
    if (!e) return null;
    if (e.progress == null) e.progress = media?.episodes || 12;
    return e;
}

const argValue = (field, name, vars) => {
    const a = field.arguments.find(x => x.name.value === name);
    if (!a) return undefined;
    const v = a.value;
    if (v.kind === 'Variable') return vars[v.name.value];
    if (v.kind === 'ListValue') return v.values.map(x => x.value);
    if (v.kind === 'IntValue') return Number(v.value);
    return v.value;
};

// Fragments a printed selection set needs (AniList refuses unused ones)
function neededFragments(text, fragments) {
    const need = new Set();
    const walk = s => { for (const m of s.matchAll(/\.\.\.\s*(\w+)/g)) if (fragments[m[1]] && !need.has(m[1])) { need.add(m[1]); walk(print(fragments[m[1]])); } };
    walk(text);
    return [...need].map(n => print(fragments[n])).join('\n');
}

// Real media for a list of ids, with exactly the fields the app asked for
const mediaCache = new Map();
async function realMedia(ids, selectionSet, fragments) {
    if (!ids.length) return new Map();
    const sel = print(selectionSet);
    const key = sel;
    if (!mediaCache.has(key)) {
        const q = `query { Page(perPage: 50) { media(id_in: [${ids.join(',')}]) { id ${sel.slice(1)} } }\n${neededFragments(sel, fragments)}`;
        mediaCache.set(key, anilist(q).then(r => {
            if (r.errors) throw new Error(r.errors[0].message);
            patchEntries(r.data);
            return new Map(r.data.Page.media.map(m => [m.id, m]));
        }));
    }
    return mediaCache.get(key);
}

// One list entry with the fields the selection asks for; media is filled in separately
function project(entry, selections, fragments, media) {
    const out = {};
    for (const s of selections) {
        if (s.kind === 'FragmentSpread') { Object.assign(out, project(entry, fragments[s.name.value].selectionSet.selections, fragments, media)); continue; }
        if (s.kind === 'InlineFragment') { Object.assign(out, project(entry, s.selectionSet.selections, fragments, media)); continue; }
        const key = s.alias?.value || s.name.value;
        const name = s.name.value;
        if (name === 'media') out[key] = media;
        else if (name === 'user') out[key] = { id: VIEWER.id, name: VIEWER.name, avatar: VIEWER.avatar };
        else out[key] = entry[name] ?? null;
    }
    return out;
}

async function entriesField(field, vars, fragments, filter) {
    const mediaSel = field.selectionSet.selections.find(s => s.name?.value === 'media');
    const list = [...entries.values()].filter(filter);
    // Always the whole list in one request per selection, cached — lists and filters reuse it
    const media = mediaSel ? await realMedia([...entries.keys()], mediaSel.selectionSet, fragments) : new Map();
    return list.filter(e => !mediaSel || media.has(e.mediaId))
        .map(e => project(entryFor(e.mediaId, media.get(e.mediaId)), field.selectionSet.selections, fragments, media.get(e.mediaId) || null));
}

const LIST_NAMES = { CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed', PAUSED: 'Paused', DROPPED: 'Dropped', REPEATING: 'Rewatching' };

async function collection(field, vars, fragments) {
    if (argValue(field, 'type', vars) === 'MANGA') return { lists: [], user: { id: VIEWER.id, name: VIEWER.name } };
    const out = {};
    for (const s of field.selectionSet.selections) {
        const key = s.alias?.value || s.name.value;
        if (s.name.value === 'lists') {
            out[key] = [];
            for (const status of Object.keys(LIST)) {
                const list = {};
                for (const ls of s.selectionSet.selections) {
                    const k = ls.alias?.value || ls.name.value;
                    if (ls.name.value === 'entries') list[k] = await entriesField(ls, vars, fragments, e => e.status === status);
                    else list[k] = { name: LIST_NAMES[status], status, isCustomList: false, isSplitCompletedList: false }[ls.name.value] ?? null;
                }
                out[key].push(list);
            }
        } else if (s.name.value === 'user') {
            out[key] = { id: VIEWER.id, name: VIEWER.name, mediaListOptions: { scoreFormat: 'POINT_100' } };
        } else out[key] = null;
    }
    return out;
}

const isDemo = (field, vars) => [VIEWER.id, String(VIEWER.id)].includes(argValue(field, 'userId', vars)) || argValue(field, 'userName', vars) === VIEWER.name;

// Put the demo user's entries into real answers (Media.mediaListEntry)
function patchEntries(node) {
    if (Array.isArray(node)) return node.forEach(patchEntries);
    if (!node || typeof node !== 'object') return;
    if ('mediaListEntry' in node && node.id != null) {
        const e = entries.has(node.id) ? entryFor(node.id, node) : null;
        node.mediaListEntry = e ? { id: e.id, status: e.status, score: e.score, progress: e.progress, progressVolumes: 0, repeat: 0 } : null;
    }
    for (const v of Object.values(node)) patchEntries(v);
}

// List changes stick for the rest of the run, so +/−, "Start Watching" and "Plan to Watch" look real
async function mutate(op, vars, fragments, body) {
    const f = op.selectionSet.selections[0];
    if (f.name.value !== 'SaveMediaListEntry') return mockRespond(body);
    const mediaId = vars.mediaId ?? [...entries.values()].find(e => e.id === vars.id)?.mediaId;
    if (!mediaId) return mockRespond(body);
    const e = entries.get(mediaId) || { id: 9000000 + mediaId, mediaId, score: 0, progress: 0, repeat: 0, notes: null,
        startedAt: { year: null, month: null, day: null }, completedAt: { year: null, month: null, day: null } };
    if (vars.status) e.status = vars.status;
    if (vars.progress != null) e.progress = vars.progress;
    if (vars.scoreRaw != null) e.score = vars.scoreRaw;
    if (vars.startedAt) e.startedAt = vars.startedAt;
    e.updatedAt = Math.floor(Date.now() / 1000);
    entries.set(mediaId, e);
    return { data: { [f.alias?.value || 'SaveMediaListEntry']: project(e, f.selectionSet.selections, fragments, null) } };
}

async function respond(body) {
    const doc = parse(body.query);
    const vars = body.variables || {};
    const fragments = Object.fromEntries(doc.definitions.filter(d => d.kind === 'FragmentDefinition').map(d => [d.name.value, d]));
    const op = doc.definitions.find(d => d.kind === 'OperationDefinition');
    if (op.operation === 'mutation') return mutate(op, vars, fragments, body);

    const top = op.selectionSet.selections;
    const personal = f => ['Viewer', 'MediaListCollection', 'MediaList', 'Notification', 'User'].includes(f.name.value)
        || (f.name.value === 'Page' && f.selectionSet.selections.some(s => ['mediaList', 'activities', 'notifications', 'following', 'followers', 'users'].includes(s.name?.value)));
    if (!top.some(personal)) {
        const real = await anilist(body.query, vars);
        patchEntries(real.data);
        return real;
    }

    const data = {};
    for (const f of top) {
        const key = f.alias?.value || f.name.value;
        const name = f.name.value;
        if (name === 'Viewer' || name === 'User') {
            const mock = mockRespond({ query: `query { Viewer ${print(f.selectionSet)} }\n${neededFragments(print(f.selectionSet), fragments)}` }).data.Viewer;
            data[key] = { ...mock, id: VIEWER.id, name: VIEWER.name, ...('avatar' in mock ? { avatar: VIEWER.avatar } : {}),
                ...('options' in mock ? { options: { ...mock.options, titleLanguage: 'ROMAJI', profileColor: 'red' } } : {}),
                ...('mediaListOptions' in mock ? { mediaListOptions: { ...mock.mediaListOptions, scoreFormat: 'POINT_100' } } : {}) };
        } else if (name === 'MediaListCollection') {
            data[key] = isDemo(f, vars) ? await collection(f, vars, fragments) : { lists: [] };
        } else if (name === 'MediaList') {
            const id = argValue(f, 'mediaId', vars);
            data[key] = isDemo(f, vars) && entries.has(id) ? (await entriesField(f, vars, fragments, e => e.mediaId === id))[0] || null : null;
        } else if (name === 'Page') {
            const page = {};
            for (const s of f.selectionSet.selections) {
                const k = s.alias?.value || s.name.value;
                if (s.name.value === 'pageInfo') page[k] = { total: 0, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 50 };
                else if (s.name.value === 'mediaList') {
                    const statuses = argValue(s, 'status_in', vars) || (argValue(s, 'status', vars) ? [argValue(s, 'status', vars)] : null);
                    const mediaIds = argValue(s, 'mediaId_in', vars) || (argValue(s, 'mediaId', vars) ? [argValue(s, 'mediaId', vars)] : null);
                    // Friends' lists (isFollowing) stay empty: the demo account has no friends to show
                    page[k] = isDemo(s, vars)
                        ? (await entriesField(s, vars, fragments, e => (!statuses || statuses.includes(e.status)) && (!mediaIds || mediaIds.map(Number).includes(e.mediaId))))
                            .sort((a, b) => (b.score || 0) - (a.score || 0))
                        : [];
                } else {
                    // Feed, notifications, follows: invented, never real people
                    page[k] = mockRespond({ query: `query { Page { ${print(s)} } }\n${neededFragments(print(s), fragments)}`, variables: vars }).data.Page[k];
                }
            }
            data[key] = page;
        } else {
            data[key] = mockRespond({ query: `query { ${print(f)} }\n${neededFragments(print(f), fragments)}`, variables: vars }).data[key];
        }
    }
    return { data };
}

module.exports = { init, respond, VIEWER };
