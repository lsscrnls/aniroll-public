// The Watch Party's "End & Post" text: what was watched, what was finished, every show of the evening
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPartyPost } from '../../js/partypost.js';

const A = { mediaId: 1, title: 'Show A' };
const B = { mediaId: 2, title: 'Show B' };

test('one show: part of it, its last episodes, all of it', () => {
    assert.equal(buildPartyPost({ shows: [{ ...A, startEp: 8, endEp: 10, episodes: 24 }], members: ['kim'] }),
        'Watched Show A · Episodes 9–10 in a Watch Party with @kim\nhttps://anilist.co/anime/1');
    assert.equal(buildPartyPost({ shows: [{ ...A, startEp: 8, endEp: 12, episodes: 12 }] }),
        'Finished Show A · Episodes 9–12 in a Watch Party\nhttps://anilist.co/anime/1');
    assert.equal(buildPartyPost({ shows: [{ ...A, startEp: 0, endEp: 12, episodes: 12 }], members: ['kim', 'lu'] }),
        'Completed Show A · all 12 episodes in a Watch Party with @kim and @lu\nhttps://anilist.co/anime/1');
    // Episode count unknown (still airing): never claims an end
    assert.match(buildPartyPost({ shows: [{ ...A, startEp: 0, endEp: 12, episodes: 0 }] }), /^Watched Show A · Episodes 1–12/);
});

test('switched to another show: both shows with what was watched, the finished one marked', () => {
    const post = buildPartyPost({ shows: [{ ...A, startEp: 8, endEp: 12, episodes: 12 }, { ...B, startEp: 0, endEp: 1, episodes: 13 }], members: ['kim'] });
    assert.equal(post, [
        'Watch Party with @kim · 2 shows, 5 episodes, 1 completed',
        '• Show A · Episodes 9–12 · completed',
        '• Show B · Episode 1',
        'https://anilist.co/anime/1',
        'https://anilist.co/anime/2',
    ].join('\n'));
    // A show switched away from before an episode was done stays out
    assert.match(buildPartyPost({ shows: [{ ...A, startEp: 3, endEp: 3, episodes: 12 }, { ...B, startEp: 0, endEp: 2, episodes: 13 }] }), /^Watched Show B · Episodes 1–2/);
});
