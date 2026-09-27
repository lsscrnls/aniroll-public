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
process.exitCode = failed ? 1 : 0;
