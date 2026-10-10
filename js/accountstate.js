// @ts-check
import { getToken } from './auth.js?v=161';

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

// { key: value } of the account, fetched once per page load; {} when there is nothing to get
export function accountState() {
    if (!getToken()) return Promise.resolve({});
    loading ??= fetch(STATE_URL, { headers: headers(), signal: AbortSignal.timeout(4000) })
        .then(res => (res.ok ? res.json() : null))
        .then(data => (data && typeof data.state === 'object' && data.state) || {})
        .catch(() => ({}));
    return loading;
}

export function saveAccountState(key, value) {
    if (!getToken()) return;
    loading?.then(state => { state[key] = value; });
    fetch(STATE_URL, { method: 'PUT', headers: headers(true), body: JSON.stringify({ key, value }), keepalive: true })
        .catch(() => { /* the local copy stays; the next change tries again */ });
}
