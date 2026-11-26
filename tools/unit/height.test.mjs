// A voice actor's height (AniList, changelog 23 Nov 2026): range, single value, starting height, none
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { heightText } = await import('../../js/pages/staff.js');

const v = (metric, imperial) => ({ metric, imperial });

test('equal min and max is one height, not a range', () => {
    assert.equal(heightText({ initial: null, min: v(182, `6'0"`), max: v(182, `6'0"`) }), `182 cm / 6'0"`);
});
test('different min and max is a range', () => {
    assert.equal(heightText({ min: v(160, `5'3"`), max: v(165.5, `5'5"`) }), `160–165.5 cm / 5'3"–5'5"`);
});
test('only initial is a starting height', () => {
    assert.equal(heightText({ initial: v(150, `4'11"`), min: null, max: null }), `150 cm / 4'11" at first`);
});
test('no height, or no metric value, shows nothing', () => {
    assert.equal(heightText(null), null);
    assert.equal(heightText({ initial: null, min: null, max: null }), null);
    assert.equal(heightText({ min: v(null, null), max: v(null, null) }), null);
});
