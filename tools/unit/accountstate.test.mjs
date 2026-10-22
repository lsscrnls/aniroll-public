// Account values shared across devices: no write after a failed read, removals from another device apply
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

let n = 0;
// A fresh module (its once-per-page-load read starts over) against a fake /api/me/state
async function fresh(server) {
    const puts = [];
    globalThis.fetch = async (url, opts = {}) => {
        if (opts.method === 'PUT') { const b = JSON.parse(opts.body); puts.push(b); server.state[b.key] = b.value; return { ok: server.putOk !== false }; }
        if (server.getFails) return { ok: false, status: 502, json: async () => ({}) };
        return { ok: true, json: async () => ({ state: { ...server.state } }) };
    };
    localStorage.setItem('aniroll_token', 'x');
    const m = await import(`../../js/accountstate.js?${++n}`);
    return { m, puts };
}
const clean = (v) => (Array.isArray(v) ? v : undefined);
const union = (r, l) => [...new Set([...r, ...l])];

test('a failed read writes nothing, not even a later change', async () => {
    const server = { state: { notint: [1, 2, 3] }, getFails: true };
    const { m, puts } = await fresh(server);
    localStorage.removeItem('mark');
    assert.deepEqual(await m.syncShared('notint', 'mark', [9], clean, union), [9]);
    assert.equal(await m.saveAccountState('notint', [9]), false);
    assert.equal(puts.length, 0);
    assert.deepEqual(server.state.notint, [1, 2, 3]);
});

test('nothing unsent: the account wins, so a removal on another device applies here', async () => {
    const server = { state: { notint: [1] } };
    const { m, puts } = await fresh(server);
    localStorage.setItem('mark', '0');
    assert.deepEqual(await m.syncShared('notint', 'mark', [1, 2], clean, union), [1]);
    assert.equal(puts.length, 0);
});

test('an unsent change is joined with the account and written back', async () => {
    const server = { state: { notint: [1] } };
    const { m, puts } = await fresh(server);
    localStorage.setItem('mark', '1');
    assert.deepEqual(await m.syncShared('notint', 'mark', [2], clean, union), [1, 2]);
    assert.deepEqual(puts, [{ key: 'notint', value: [1, 2] }]);
    assert.equal(localStorage.getItem('mark'), '0');
});

test('no mark yet (older browser) counts as unsent; the account without a value takes the local one', async () => {
    const server = { state: {} };
    const { m } = await fresh(server);
    localStorage.removeItem('mark');
    assert.deepEqual(await m.syncShared('notint', 'mark', [5], clean, union), [5]);
    assert.deepEqual(server.state.notint, [5]);
});

test('saveShared keeps the mark while the account refuses', async () => {
    const server = { state: {}, putOk: false };
    const { m } = await fresh(server);
    m.saveShared('notint', 'mark', [7]);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(localStorage.getItem('mark'), '1');
    server.putOk = true;
    m.saveShared('notint', 'mark', [7]);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(localStorage.getItem('mark'), '0');
});
