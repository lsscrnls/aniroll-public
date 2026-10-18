// Builds media/dna-samples.json: three made-up viewers for the landing page's Anime DNA, so the page can draw
// real DNA (js/dna.js) without asking AniList. The shows are real (looked up by title),
// the people, their scores and dates are invented.
// Run: docker run --rm -v "$PWD":/w -w /w node:24-alpine node tools/dna-samples/build.js
import fs from 'node:fs';
import { readDna } from '../../js/dna.js';

const MEDIA = `id title { userPreferred english romaji } coverImage { large } format episodes duration
    startDate { year month day } meanScore genres popularity tags { name rank }
    studios(isMain: true) { nodes { name isAnimationStudio } }`;

// [title to look up, score, status]; the order is the order they were watched, oldest first
const VIEWERS = [
    { name: 'Deep diver', shows: [
        ['Monster', 95, 'COMPLETED'], ['Serial Experiments Lain', 85, 'COMPLETED'], ['Mushishi', 90, 'COMPLETED'],
        ['Paranoia Agent', 80, 'COMPLETED'], ['Ghost in the Shell: Stand Alone Complex', 85, 'COMPLETED'],
        ['Texhnolyze', 75, 'COMPLETED'], ['Ergo Proxy', 70, 'DROPPED'], ['Steins;Gate', 90, 'COMPLETED'],
        ['Psycho-Pass', 80, 'COMPLETED'], ['Ping Pong the Animation', 95, 'COMPLETED'], ['Planetes', 85, 'COMPLETED'],
        ['Haibane Renmei', 90, 'COMPLETED'], ['Mononoke', 80, 'COMPLETED'], ['Odd Taxi', 90, 'COMPLETED'],
        ['Vinland Saga', 90, 'COMPLETED'], ['Sonny Boy', 85, 'COMPLETED'], ['Pluto', 90, 'COMPLETED'],
        ['Frieren', 95, 'COMPLETED'], ['The Tatami Galaxy', 90, 'COMPLETED'], ['Dorohedoro', 75, 'COMPLETED'],
        ['Legend of the Galactic Heroes', 0, 'CURRENT'], ['Kaiba', 0, 'PLANNING'],
    ] },
    { name: 'Soft heart', shows: [
        ['Toradora!', 85, 'COMPLETED'], ['Clannad', 80, 'COMPLETED'], ['Clannad: After Story', 95, 'COMPLETED'],
        ['Kaguya-sama: Love Is War', 90, 'COMPLETED'], ['Horimiya', 85, 'COMPLETED'], ['Fruits Basket', 80, 'COMPLETED'],
        ['Kimi ni Todoke', 85, 'COMPLETED'], ['Tsuki ga Kirei', 90, 'COMPLETED'], ['My Dress-Up Darling', 80, 'COMPLETED'],
        ['K-On!', 85, 'COMPLETED'], ['Yuru Camp', 90, 'COMPLETED'], ['Non Non Biyori', 85, 'COMPLETED'],
        ['Barakamon', 85, 'COMPLETED'], ['Skip and Loafer', 95, 'COMPLETED'], ['The Dangers in My Heart', 90, 'COMPLETED'],
        ['Komi Can’t Communicate', 75, 'DROPPED'], ['Tamako Market', 70, 'COMPLETED'], ['Lovely Complex', 80, 'COMPLETED'],
        ['A Sign of Affection', 90, 'COMPLETED'], ['Bocchi the Rock!', 90, 'COMPLETED'], ['Insomniacs After School', 85, 'CURRENT'],
        ['Nana', 0, 'PLANNING'],
    ] },
    { name: 'Full throttle', shows: [
        ['Fullmetal Alchemist: Brotherhood', 95, 'COMPLETED'], ['Attack on Titan', 90, 'COMPLETED'], ['Jujutsu Kaisen', 85, 'COMPLETED'],
        ['Kimetsu no Yaiba', 80, 'COMPLETED'], ['My Hero Academia', 75, 'COMPLETED'], ['Mob Psycho 100', 90, 'COMPLETED'],
        ['One Punch Man', 85, 'COMPLETED'], ['Chainsaw Man', 85, 'COMPLETED'], ['Hunter x Hunter (2011)', 95, 'COMPLETED'],
        ['Re:Zero', 75, 'COMPLETED'], ['That Time I Got Reincarnated as a Slime', 70, 'COMPLETED'], ['Overlord', 70, 'COMPLETED'],
        ['Mushoku Tensei', 80, 'COMPLETED'], ['Solo Leveling', 80, 'COMPLETED'], ['Kill la Kill', 85, 'COMPLETED'],
        ['Gurren Lagann', 90, 'COMPLETED'], ['Black Clover', 60, 'DROPPED'], ['Fire Force', 65, 'COMPLETED'],
        ['Dandadan', 90, 'COMPLETED'], ['Kaiju No. 8', 75, 'COMPLETED'], ['Sakamoto Days', 0, 'CURRENT'],
        ['Blue Lock', 80, 'COMPLETED'], ['The Rising of the Shield Hero', 0, 'PLANNING'],
    ] },
];

const DAY = 86400000;
// js/store.js reads the title language from the browser
globalThis.localStorage = { getItem: () => null };
const fuzzy = (t) => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };

// AniList caps a query's complexity: eight shows per request
async function lookUp(titles) {
    const found = [];
    for (let i = 0; i < titles.length; i += 8) {
        // Slowly, and once AniList says "too many", a minute's wait
        await new Promise(r => setTimeout(r, 2500));
        found.push(...await lookUpSome(titles.slice(i, i + 8)).catch(async (e) => {
            if (!/429/.test(e.message)) throw e;
            await new Promise(r => setTimeout(r, 65000));
            return lookUpSome(titles.slice(i, i + 8));
        }));
    }
    return found;
}
async function lookUpSome(titles) {
    const query = `query { ${titles.map((t, i) => `m${i}: Media(search: ${JSON.stringify(t)}, type: ANIME) { ${MEDIA} }`).join('\n')} }`;
    const res = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (!body.data) throw new Error(JSON.stringify(body.errors || body).slice(0, 400));
    return titles.map((_, i) => body.data[`m${i}`]);
}

const out = [];
for (const v of VIEWERS) {
    const media = await lookUp(v.shows.map(s => s[0]));
    // Watched over about three years, up to last month; each show took its episodes at roughly two a day
    let at = Date.now() - 3 * 365 * DAY;
    const step = (3 * 365 - 30) * DAY / v.shows.length;
    const entries = v.shows.map(([title, score, status], i) => {
        const m = media[i];
        if (!m) throw new Error(`not found: ${title}`);
        // Only tags that clearly fit the show: the weakest ones say little and only make the file bigger
        m.tags = (m.tags || []).filter(t => t.rank > 35);
        console.log(`${v.name}: ${title} -> ${m.title.userPreferred}`);
        const start = at;
        at += step;
        const eps = m.episodes || 12;
        const done = status === 'COMPLETED';
        const progress = done ? eps : status === 'PLANNING' ? 0 : Math.max(1, Math.round(eps / 3));
        return {
            status, score, repeat: done && score >= 95 ? 1 : 0, progress,
            startedAt: status === 'PLANNING' ? {} : fuzzy(start),
            completedAt: done ? fuzzy(start + Math.ceil(eps / 2) * DAY) : {},
            media: m,
        };
    });
    const lists = [{ entries }];
    const features = new Map(entries.map(e => [e.media.id, e.media]));
    const dna = readDna(lists, features, false);
    console.log(`  -> ${dna?.type.name} / ${dna?.streak} / ${dna?.loves.map(l => l.name).join(', ')}`);
    out.push({ name: v.name, lists });
}
fs.writeFileSync(new URL('../../media/dna-samples.json', import.meta.url), JSON.stringify(out));
console.log('media/dna-samples.json', fs.statSync(new URL('../../media/dna-samples.json', import.meta.url)).size, 'bytes');
