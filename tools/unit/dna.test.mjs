// Anime DNA: the type from the list's numbers, quirks that hold up, the picture only from what was seen often enough
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDna, matchDna } from '../../js/dna.js';

let next = 1;
// One list entry with its features; the media fields are the ones getMediaList and the taste query give
function show({ status = 'COMPLETED', score = 0, progress = 12, repeat = 0, episodes = 12, format = 'TV', year = 2020,
    started = null, completed = null, meanScore = 75, popularity = 50000, genres = ['Action'], tags = [], studio = null } = {}) {
    const id = next++;
    const media = { id, title: { romaji: `Show ${id}` }, coverImage: { color: '#3366ff' }, episodes, format, duration: 24,
        startDate: { year, month: 1, day: 1 }, meanScore };
    const entry = { id, mediaId: id, status, score, progress, repeat, startedAt: started || {}, completedAt: completed || {}, media };
    const features = { id, genres, tags: tags.map(name => ({ name, rank: 80 })), popularity,
        studios: { nodes: studio ? [{ name: studio, isAnimationStudio: true }] : [] } };
    return { entry, features };
}
const dna = (shows, own = true) => readDna([{ entries: shows.map(s => s.entry) }], new Map(shows.map(s => [s.features.id, s.features])), own);

test('too little on the list: no DNA', () => {
    assert.equal(dna([show(), show(), show({ status: 'PLANNING' })]), null);
});

test('started almost everything in its first weeks on air: the Simulcaster', () => {
    const shows = Array.from({ length: 10 }, (_, i) => show({ year: 2025, started: { year: 2025, month: 1, day: 3 + i }, score: 70 }));
    const d = dna(shows);
    assert.equal(d.type.id, 'simulcast');
    assert.match(d.type.why, /^You started 100% of your shows/);
    // On someone else's profile it speaks about them
    assert.match(dna(shows, false).type.why, /^They started 100% of their shows/);
});

test('scores far below AniList: the Critic, and the quirk says how much', () => {
    const shows = Array.from({ length: 12 }, () => show({ score: 55, meanScore: 75, genres: ['Drama'] }));
    const d = dna(shows);
    assert.equal(d.type.id, 'critic');
    assert.ok(d.quirks.some(q => q.includes('20 points stricter')), d.quirks);
});

test('drops a lot, early: the Sampler, with the usual episode', () => {
    const shows = [
        ...Array.from({ length: 6 }, () => show({ status: 'DROPPED', progress: 3 })),
        ...Array.from({ length: 6 }, () => show({ status: 'COMPLETED' })),
    ];
    const d = dna(shows);
    assert.equal(d.type.id, 'sampler');
    assert.match(d.type.why, /usually around episode 3/);
    assert.ok(d.quirks.some(q => q.includes('episode 3')));
});

test('a binge from dates set in bulk does not count; a real one does', () => {
    const shows = [
        show({ episodes: 500, year: 2010, started: { year: 2024, month: 5, day: 1 }, completed: { year: 2024, month: 5, day: 1 } }),
        show({ episodes: 12, year: 2010, started: { year: 2024, month: 6, day: 1 }, completed: { year: 2024, month: 6, day: 1 } }),
        show(), show(), show(), show(),
    ];
    const quirks = dna(shows).quirks.join(' ');
    assert.ok(!quirks.includes('500 episodes'), quirks);
    assert.ok(quirks.includes('12 episodes in 1 day'), quirks);
});

test('the studio that rarely misses, only animation studios', () => {
    const shows = [
        ...Array.from({ length: 3 }, () => show({ score: 95, studio: 'Studio A' })),
        ...Array.from({ length: 6 }, () => show({ score: 60 })),
    ];
    assert.ok(dna(shows).quirks.some(q => q.includes('Studio A')));
    const licensor = shows.map(s => ({ ...s, features: { ...s.features, studios: { nodes: (s.features.studios.nodes).map(n => ({ ...n, isAnimationStudio: false })) } } }));
    assert.ok(!dna(licensor).quirks.some(q => q.includes('Studio A')));
});

test('loves: seen on three shows at least, and never who is in the cast', () => {
    const shows = [
        ...Array.from({ length: 4 }, () => show({ score: 95, genres: ['Mystery'], tags: ['Time Loop', 'Male Protagonist'] })),
        show({ score: 95, genres: ['Sports'], tags: ['Rugby'] }),
        ...Array.from({ length: 5 }, () => show({ score: 50, genres: ['Ecchi'] })),
    ];
    const d = dna(shows);
    const names = d.loves.map(l => l.name);
    assert.ok(names.includes('Mystery') && names.includes('Time Loop'), names.join());
    assert.ok(!names.includes('Rugby') && !names.includes('Male Protagonist') && !names.includes('Ecchi'), names.join());
    // The picture: one petal per love, one star per watched show
    assert.equal((d.art.match(/class="dna-petal"/g) || []).length, d.loves.length * 2);
    const stars = d.art.match(/<g class="dna-stars">(.*?)<\/g>/s)[1];
    assert.equal((stars.match(/<circle /g) || []).length, shows.length);
});

test('match: the same taste high, opposite taste low; what both love, where they part, what to try', () => {
    const lover = (score) => show({ score, genres: ['Mystery'], tags: ['Time Loop'] });
    const other = (score) => show({ score, genres: ['Sports'], tags: ['Rugby'] });
    const list = (shows) => ({ lists: [{ entries: shows.map(s => s.entry) }], features: new Map(shows.map(s => [s.features.id, s.features])) });
    const shared = [lover(95), lover(90), lover(92), other(40), other(45)];
    const a = [...shared, lover(88)];
    const twin = [...shared.map(s => ({ ...s, entry: { ...s.entry } })), lover(91)];
    twin[0].entry.score = 50; // one show they disagree on by 45 points
    const opposite = [other(95), other(90), other(92), lover(40), lover(45), lover(42)];
    const close = matchDna(list(a), list(twin));
    const far = matchDna(list(a), list(opposite));
    assert.ok(close.match >= 80 && far.match <= 20, `${close.match} / ${far.match}`);
    assert.deepEqual(close.both, ['Mystery', 'Time Loop']);
    assert.equal(close.clash.length, 1);
    assert.equal(close.clash[0].mine - close.clash[0].theirs, 45);
    // Their 91 is not on the own list: the pick; nothing the own list already has
    assert.deepEqual(close.picks.map(p => p.id), [twin[5].entry.media.id]);
});
