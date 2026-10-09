// Where Up next comes in: credits, story during them, a scene after them (js/player/ending.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endingInfo, upNextAt } from '../../js/player/ending.js';

const D = 1465; // a 24-minute episode
const ed = (start, end, length = D) => ({ type: 'ed', start, end, length });
const mixed = (start, end, length = D) => ({ type: 'mixed-ed', start, end, length });
const outro = (start, end) => ({ type: 'Outro', start, end });

test('nothing known: the last 30 s', () => {
    assert.equal(upNextAt(D), D - 30);
});

test('Jellyfin credits to the end: from the credits', () => {
    assert.equal(upNextAt(D, [outro(1375, 1464)]), 1375);
});

test('Jellyfin credits, then a next-episode preview: still from the credits', () => {
    assert.equal(upNextAt(D, [outro(1340, 1430), { type: 'Preview', start: 1430, end: 1465 }]), 1340);
});

test('Jellyfin credits, then 35 s of something that is no preview: a scene, so only at the very end', () => {
    const info = endingInfo(D, [outro(1340, 1430)]);
    assert.equal(info.sceneAfter, true);
    assert.equal(upNextAt(D, [outro(1340, 1430)]), D - 8);
});

test('AniSkip: ending to the end of the file, from where it starts', () => {
    assert.equal(upNextAt(D, [], [ed(1375, 1464)]), 1375);
});

test('AniSkip: 37 s of story after the ending (Hell\'s Paradise 13) wait for the end', () => {
    assert.equal(upNextAt(D, [outro(1353, 1428)], [ed(1353, 1428)]), D - 8);
});

test('AniSkip: story during the ending keeps Up next away until it is over, and the credits are not skippable', () => {
    const info = endingInfo(D, [outro(1300, 1400)], [mixed(1300, 1400, 1465), ed(1300, 1400)]);
    assert.equal(info.story, true);
    assert.equal(upNextAt(D, [outro(1300, 1400)], [mixed(1300, 1400), { type: 'ed', start: 1300, end: 1458, length: D }]), 1400);
});

test('AniSkip times for a file of another length are ignored', () => {
    assert.equal(upNextAt(D, [outro(1375, 1464)], [ed(1200, 1240, 1300)]), 1375);
});

test('AniSkip times from the end of a slightly longer cut still land right', () => {
    // their file is 10 s longer at the start: the ending sits the same distance from the end
    assert.equal(upNextAt(D, [], [ed(1385, 1474, D + 10)]), D - (D + 10 - 1385));
});

test('a "mixed" ending early in the episode is a misfiled opening: ignored', () => {
    assert.equal(endingInfo(D, [], [mixed(24, 114)]).story, false);
});
