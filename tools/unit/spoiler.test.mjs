// AniList spoiler syntax: inline vs block, labels, nesting up to three levels, unpaired markers
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpoilers } from '../../js/spoiler.js';

const T = (text) => ({ type: 'text', text });
const S = (children, { label = null, block = false } = {}) => ({ type: 'spoiler', label, block, children });

test('no spoiler: one text node, nothing for empty text', () => {
    assert.deepEqual(parseSpoilers('just text'), [T('just text')]);
    assert.deepEqual(parseSpoilers(''), []);
    assert.deepEqual(parseSpoilers(null), []);
});

test('inline when it shares its line, block when alone or spanning lines', () => {
    assert.deepEqual(parseSpoilers('such as ~! this one !~ here'), [T('such as '), S([T(' this one ')]), T(' here')]);
    assert.deepEqual(parseSpoilers('~!hidden!~'), [S([T('hidden')], { block: true })]);
    assert.deepEqual(parseSpoilers('intro\n  ~!hidden!~  \nafter'), [T('intro\n  '), S([T('hidden')], { block: true }), T('  \nafter')]);
    assert.deepEqual(parseSpoilers('a ~!one\ntwo!~ b'), [T('a '), S([T('one\ntwo')], { block: true }), T(' b')]);
});

test('labels: trimmed, empty is none, no braces/angle brackets/line breaks', () => {
    assert.deepEqual(parseSpoilers('x ~!{ Ending Spoiler } Bobby !~'), [T('x '), S([T(' Bobby ')], { label: 'Ending Spoiler' })]);
    assert.deepEqual(parseSpoilers('x ~!{} plain !~'), [T('x '), S([T(' plain ')])]);
    assert.deepEqual(parseSpoilers('x ~!{  } plain !~'), [T('x '), S([T(' plain ')])]);
    // Not a label: stays part of the hidden text
    assert.deepEqual(parseSpoilers('x ~!{a<b} y !~'), [T('x '), S([T('{a<b} y ')])]);
    assert.deepEqual(parseSpoilers('x ~!{a\nb} y !~'), [T('x '), S([T('{a\nb} y ')], { block: true })]);
    assert.deepEqual(parseSpoilers('x ~! {a} y !~'), [T('x '), S([T(' {a} y ')])]);
});

test('openings pair with the closest closing: nesting instead of leaking text', () => {
    assert.deepEqual(parseSpoilers('a ~! b ~!{L} c !~ d !~ e'),
        [T('a '), S([T(' b '), S([T(' c ')], { label: 'L' }), T(' d ')]), T(' e')]);
    // Two siblings stay two
    assert.deepEqual(parseSpoilers('~!a!~ and ~!b!~'), [S([T('a')]), T(' and '), S([T('b')])]);
});

test('three levels deep at most, the fourth is plain text with its markers', () => {
    assert.deepEqual(parseSpoilers('x ~!1~!2~!3~!4!~!~!~!~'),
        [T('x '), S([T('1'), S([T('2'), S([T('3~!4!~')])])])]);
});

test('unpaired markers are plain text', () => {
    assert.deepEqual(parseSpoilers('a ~! b'), [T('a ~! b')]);
    assert.deepEqual(parseSpoilers('a !~ b'), [T('a !~ b')]);
    // The extra opening has no closing left: text; the rest pairs
    assert.deepEqual(parseSpoilers('a ~! b ~! c !~'), [T('a ~! b '), S([T(' c ')])]);
});
