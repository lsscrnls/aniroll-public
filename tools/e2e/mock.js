// A stand-in for the AniList GraphQL API: parses each query and answers exactly the fields it
// asks for, with plausible values derived from the field names. No hand-written response per
// query, so new queries in js/api.js are covered without touching this file.
// Deterministic: the same query and variables always get the same answer.
const { parse } = require('graphql');

const VIEWER = { id: 6649000, name: 'tester' };
const COVER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="46" height="65"><rect width="46" height="65" fill="#888"/></svg>');
const NOW = Math.floor(Date.now() / 1000);

// Fields that hold lists, and how many items to return
const LISTS = {
    media: 6, entries: 5, lists: 3, activities: 4, notifications: 4, airingSchedules: 8, nodes: 3, edges: 3,
    following: 3, followers: 3, genres: 3, tags: 3, replies: 2, likes: 2, studios: 1, characters: 2, recommendations: 3,
    rankings: 1, scores: 3, statuses: 3, synonyms: 1, externalLinks: 1, streamingEpisodes: 0, reviews: 0,
    stats: 1, scoreDistribution: 5, statusDistribution: 4, formats: 2, countries: 1, releaseYears: 2, voiceActors: 1,
    customLists: 0, advancedScores: 0, favourites: 1, users: 2, threads: 0, mediaRecommendations: 0,
    mediaList: 5, GenreCollection: 4, results: 3,
};

const LIST_STATUSES = ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'REPEATING'];
const ACTIVITY_TYPES = ['ANIME_LIST', 'TEXT', 'ANIME_LIST', 'MANGA_LIST'];
const NOTIFICATION_TYPES = ['AIRING', 'FOLLOWING', 'RELATED_MEDIA_ADDITION', 'ACTIVITY_REPLY'];
const TEXT = 'A post with **bold**, a list:\n- one\n- two\nand https://anilist.co/anime/21 as a card.';

function scalar(name, parent, index, path) {
    const n = name.toLowerCase();
    // Shows share a small set of ids, so the same show turns up in lists, schedules and posts
    if (name === 'id' && parent === 'media') return 101 + ((hash(path) + index) % 6);
    if (name === 'id') return (hash(path) % 90000) + 1000 + index;
    if (n.endsWith('id')) return 100 + index;
    if (name === 'name' && parent === 'Viewer') return VIEWER.name;
    if (['romaji', 'english', 'userpreferred', 'native', 'full'].includes(n)) return `Show ${index + 1}`;
    if (name === 'name') return `user${index + 1}`;
    if (['large', 'extralarge', 'medium', 'bannerimage', 'banner', 'avatar'].includes(n)) return COVER;
    if (n === 'color') return '#d13438';
    if (n === 'status') return parent === 'lists' || parent === 'entries' || parent === 'mediaListEntry'
        ? LIST_STATUSES[index % LIST_STATUSES.length] : 'RELEASING';
    if (n === 'type') {
        if (parent === 'activities') return ACTIVITY_TYPES[index % ACTIVITY_TYPES.length];
        if (parent === 'notifications') return NOTIFICATION_TYPES[index % NOTIFICATION_TYPES.length];
        return 'ANIME';
    }
    if (n === 'format') return 'TV';
    if (n === 'season') return 'FALL';
    if (n === 'relationtype') return 'SEQUEL';
    if (n === 'role') return 'MAIN';
    if (n === 'source') return 'MANGA';
    if (n === 'countryoforigin') return 'JP';
    if (n === 'scoreformat') return 'POINT_100';
    if (n === 'titlelanguage') return 'ROMAJI';
    if (n === 'text' || n === 'description' || n === 'about') return TEXT;
    if (n === 'context' || n === 'reason') return ' aired';
    if (n === 'siteurl' || n === 'url') return 'https://anilist.co/anime/21';
    if (n === 'site') return 'Crunchyroll';
    if (n.endsWith('at') || n === 'airingat' || n === 'timeuntilairing') return n === 'timeuntilairing' ? 3600 * (index + 1) : n === 'airingat' ? NOW + 3600 * (index * 7 + 1) : NOW - 3600 * (index + 1);
    if (n === 'year' || n === 'seasonyear') return 2026;
    if (n === 'month') return 9;
    if (n === 'day') return 22;
    if (n === 'episodes') return 12;
    if (n === 'chapters' || n === 'volumes') return null;
    if (n === 'episode') return 3 + index;
    if (n === 'progress') return (index % 4) + 1;
    if (n === 'score' || n === 'meanscore' || n === 'averagescore') return 70 + (index % 20);
    if (n === 'rank' || n.startsWith('is') || n.startsWith('has')) return n.startsWith('is') || n.startsWith('has') ? false : 1;
    if (n === 'lastpage' || n === 'currentpage' || n === 'total' || n === 'perpage') return 1;
    return 1 + index; // counts, amounts, durations, repeat, likeCount, replyCount, ...
}

function hash(s) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
}

// Builds the value of one selection set; inline fragments (unions) are merged in
function build(selections, parent, index, path, fragments) {
    const out = {};
    for (const sel of selections) {
        if (sel.kind === 'InlineFragment') {
            Object.assign(out, build(sel.selectionSet.selections, parent, index, path, fragments));
            continue;
        }
        if (sel.kind === 'FragmentSpread') {
            Object.assign(out, build(fragments[sel.name.value].selectionSet.selections, parent, index, path, fragments));
            continue;
        }
        const name = sel.name.value;
        const key = sel.alias ? sel.alias.value : name;
        if (name === '__typename') { out[key] = parent; continue; }
        const childPath = `${path}.${key}`;
        if (!sel.selectionSet) {
            out[key] = name in LISTS
                ? Array.from({ length: LISTS[name] }, (_, i) => (name === 'GenreCollection' ? ['Action', 'Drama', 'Comedy', 'Fantasy'][i] : `${name} ${i + 1}`))
                : scalar(name, parent, index, childPath);
            continue;
        }
        const children = sel.selectionSet.selections;
        // `media` is a list only on Page; on entries, schedules and notifications it is one object
        // A field that selects nodes/edges is a connection object, not a list (Media.recommendations)
        const isConnection = children.some(c => ['nodes', 'edges', 'pageInfo'].includes(c.name?.value));
        const isList = name === 'media' ? parent === 'Page' : name in LISTS && !isConnection;
        if (isList) {
            out[key] = Array.from({ length: LISTS[name] }, (_, i) => build(children, name, i, `${childPath}[${i}]`, fragments));
        } else if (name === 'nextAiringEpisode' && index % 2) {
            out[key] = null;
        } else if (name === 'mediaListEntry' && parent === 'mediaRecommendation') {
            out[key] = null; // recommended shows are not on the list yet, or nothing would be recommended
        } else {
            out[key] = build(children, name, index, childPath, fragments);
        }
    }
    // The viewer is always the same test account
    if (parent === 'Viewer') Object.assign(out, 'id' in out ? { id: VIEWER.id } : {}, 'name' in out ? { name: VIEWER.name } : {});
    return out;
}

function respond(body) {
    const doc = parse(body.query);
    const fragments = Object.fromEntries(doc.definitions.filter(d => d.kind === 'FragmentDefinition').map(d => [d.name.value, d]));
    const op = doc.definitions.find(d => d.kind === 'OperationDefinition');
    const data = build(op.selectionSet.selections, op.operation === 'mutation' ? 'Mutation' : 'Query', 0,
        JSON.stringify(body.variables || {}), fragments);
    return { data };
}

module.exports = { respond, VIEWER };
