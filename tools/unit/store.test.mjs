// Small helpers every page uses: escaping, titles, scores, labels, Jellyfin link keys
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, titlePref, fmtScore, fmtScoreDiff, statusLabel } from '../../js/store.js';
import { linkKey } from '../../js/jflinks.js';

test('esc: every HTML-special character, empty for nothing', () => {
    assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(0), '');
    assert.equal(esc(42), '42');
});

test('titlePref: follows the chosen language, with fallbacks', () => {
    const t = { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人', userPreferred: 'Shingeki no Kyojin' };
    localStorage.removeItem('aniroll_title_lang');
    assert.equal(titlePref(t), 'Shingeki no Kyojin');
    localStorage.setItem('aniroll_title_lang', 'english');
    assert.equal(titlePref(t), 'Attack on Titan');
    assert.equal(titlePref({ romaji: 'Only Romaji' }), 'Only Romaji');
    localStorage.setItem('aniroll_title_lang', 'native');
    assert.equal(titlePref(t), '進撃の巨人');
    assert.equal(titlePref(null), '');
    localStorage.removeItem('aniroll_title_lang');
});

test('scores: rounded, empty when unscored, signed differences', () => {
    assert.equal(fmtScore(84.6), '85');
    assert.equal(fmtScore(0), '');
    assert.deepEqual(fmtScoreDiff(90, 75), { value: 15, text: '+15' });
    assert.deepEqual(fmtScoreDiff(70, 75), { value: -5, text: '-5' });
    assert.deepEqual(fmtScoreDiff(null, 0), { value: 0, text: '0' });
});

test('statusLabel: anime and manga wording', () => {
    assert.equal(statusLabel('CURRENT'), 'Watching');
    assert.equal(statusLabel('CURRENT', 'MANGA'), 'Reading');
    assert.equal(statusLabel('REPEATING', 'MANGA'), 'Rereading');
    assert.equal(statusLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
});

test('linkKey: the same series however Jellyfin spells it', () => {
    assert.equal(linkKey('Re:ZERO (2016)', 2), 'rezero|2');
    assert.equal(linkKey('re zero', 2), 'rezero|2');
    assert.equal(linkKey('Mob Psycho 100'), 'mobpsycho100|1');
    assert.equal(linkKey(null, 0), '|0');
});
