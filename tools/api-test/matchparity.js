// The Jellyfin matcher exists twice: api/server.js (webhook) and js/jellyfin.js (pull).
// Rule: same weights in both, always change both. This runs the same cases through
// both copies, taken straight from the source, so a change to only one of them fails CI.
const { loadFunctions } = require('./source');

const extract = (file, names) => loadFunctions(file, names).matchFit;

const server = extract('api/server.js', ['splitYear', 'nearYear', 'mediaYear', 'matchFit']);
const client = extract('js/jellyfin.js', ['splitYear', 'nearYear', 'matchFit']);

// media: AniList entry; series/year/episode: what Jellyfin reports
const cases = [
    ['fits both', { episodes: 12, seasonYear: 2024 }, 'Frieren', 2024, 5],
    ['episode too high', { episodes: 1, seasonYear: 2020 }, 'False Memory', 2020, 3],
    ['year in the title', { episodes: 7, seasonYear: 2026 }, 'False Memory (2026)', null, 1],
    ['wrong year in the title', { episodes: 7, seasonYear: 2020 }, 'False Memory (2026)', null, 1],
    ['both wrong', { episodes: 1, seasonYear: 2020 }, 'False Memory (2026)', null, 3],
    ['year off by one', { episodes: 12, seasonYear: 2023 }, 'Show', 2024, 2],
    ['long runner, old start', { episodes: 1100, startDate: { year: 1999 } }, 'One Piece', 2024, 1090],
    ['unknown episode count', { episodes: null, seasonYear: 2024 }, 'Show', 2024, 30],
    ['no years anywhere', { episodes: 12 }, 'Show', null, 13],
];

let failed = 0;
for (const [name, media, series, year, episode] of cases) {
    const a = server(media, { type: 'Episode', series, year, episode });
    const b = client(media, { seriesName: series, year, maxEpisode: episode });
    const ok = a === b;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: server ${a}, client ${b}`);
}
// How a title splits into series and season, the same in both copies and as expected
const seasonOf = (file) => loadFunctions(file, ['normTitle', 'ROMAN_SEASONS', 'splitSeason']).splitSeason;
const serverSeason = seasonOf('api/server.js');
const clientSeason = seasonOf('js/jellyfin.js');
const seasons = [
    ['Jujutsu Kaisen 2nd Season', 'jujutsukaisen', 2],
    ['Spy x Family Season 2', 'spyxfamily', 2],
    ['Mob Psycho 100 II', 'mobpsycho100', 2],
    ['Mob Psycho 100 III', 'mobpsycho100', 3],
    ['Mob Psycho 100', 'mobpsycho100', 1],
    ['Overlord IV', 'overlord', 4],
    ['Kaguya-sama wa Kokurasetai? Tensai-tachi no Renai Zunousen', 'kaguyasamawakokurasetaitensaitachinorenaizunousen', 1],
    ['Sword Art Online: Alicization', 'swordartonlinealicization', 1],
    ['Persona 5 the Animation', 'persona5theanimation', 1],
];
for (const [title, base, season] of seasons) {
    const a = serverSeason(title);
    const b = clientSeason(title);
    const ok = a.base === base && a.season === season && b.base === a.base && b.season === a.season;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  season of "${title}": server ${a.base}/${a.season}, client ${b.base}/${b.season}`);
}
// The webhook's whole title check with AniList's real entries: Jellyfin keeps "Mob Psycho 100" with seasons,
// AniList has one entry per season, the sequels named with Roman numerals
const { mediaMatches } = loadFunctions('api/server.js', ['normTitle', 'ROMAN_SEASONS', 'splitSeason', 'splitYear', 'nearYear', 'mediaMatches']);
const mob = (id, title, seasonYear) => ({ id, format: 'TV', seasonYear, title: { romaji: title, english: title, userPreferred: title }, synonyms: [] });
const mobs = [mob(21507, 'Mob Psycho 100', 2016), mob(101338, 'Mob Psycho 100 II', 2019), mob(140439, 'Mob Psycho 100 III', 2022)];
for (const [season, id] of [[1, 21507], [2, 101338], [3, 140439]]) {
    const hits = mobs.filter(m => mediaMatches(m, { type: 'Episode', series: 'Mob Psycho 100', season, year: 2016, episode: 5 })).map(m => m.id);
    const ok = hits.length === 1 && hits[0] === id;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  Jellyfin "Mob Psycho 100" season ${season} -> AniList ${hits.join(', ') || 'nothing'}`);
}
process.exitCode = failed ? 1 : 0;
