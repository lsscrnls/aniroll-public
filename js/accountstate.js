// @ts-check
import { getToken } from './auth.js';

// Small values that belong to the AniList account, not to one browser (api/server.js "/api/me/state"),
// so a second device knows them too. Each feature merges its own value with the local one (newest
// confirmed, the union of a set, ...) and writes back what it changed. Logged out, or the server
// unreachable: everything stays local, nothing waits long.
const STATE_URL = '/api/me/state';
let loading = null;

const headers = (json = false) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${getToken()}`,
});

// Set once the account's values were read on this page load. Until then, or when reading failed, nothing
// is written: a merge with an empty state would replace what another device saved with this browser's copy.
let loaded = false;

// { key: value } of the account, fetched once per page load; {} when there is nothing to get
export function accountState() {
    if (!getToken()) return Promise.resolve({});
    loading ??= fetch(STATE_URL, { headers: headers(), signal: AbortSignal.timeout(4000) })
        .then(res => { if (!res.ok) throw new Error(`state ${res.status}`); return res.json(); })
        .then(data => { loaded = true; return (data && typeof data.state === 'object' && data.state) || {}; })
        .catch(() => ({}));
    return loading;
}

// Resolves true when the account took the value
export async function saveAccountState(key, value) {
    if (!getToken()) return false;
    const state = await accountState();
    if (!loaded) return false;
    state[key] = value;
    return fetch(STATE_URL, { method: 'PUT', headers: headers(true), body: JSON.stringify({ key, value }), keepalive: true })
        .then(res => res.ok)
        .catch(() => false); // the local copy stays; the next change or page load tries again
}

// A value kept in this browser and with the account, where removing counts too (a list, links). A local
// change is marked unsent until the account has it; the next sync then joins both with merge() and writes
// the result back. Otherwise the account's value wins, so what another device removed goes here too.
// No mark at all (a browser from before the mark existed) counts as unsent.
const isUnsent = (mark) => { try { return localStorage.getItem(mark) !== '0'; } catch { return true; } };
const setUnsent = (mark, on) => { try { localStorage.setItem(mark, on ? '1' : '0'); } catch { /* asked again next time */ } };

// clean(remote) -> the account's value checked, or undefined when it has none
export async function syncShared(key, mark, local, clean, merge) {
    const state = await accountState();
    if (!loaded) return local;
    const remote = state[key] === undefined ? undefined : clean(state[key]);
    if (remote !== undefined && !isUnsent(mark)) return remote;
    const merged = remote === undefined ? local : merge(remote, local);
    if (await saveAccountState(key, merged)) setUnsent(mark, false);
    return merged;
}

export function saveShared(key, mark, value) {
    setUnsent(mark, true);
    saveAccountState(key, value).then(ok => { if (ok) setUnsent(mark, false); });
}
