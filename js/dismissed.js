import { accountState, saveAccountState } from './accountstate.js?v=135';

// Recommendations the user said no to ("Not interested"): kept in this browser and with the account,
// so Home and Roll never offer them again on any device. Only ids, the newest few hundred.
const KEY = 'aniroll_not_interested';
const ACCOUNT_KEY = 'notint';
const MAX = 400;

function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]').filter(Number.isInteger); } catch { return []; }
}

function writeLocal(ids) {
    try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX))); } catch { /* this tab only */ }
}

export function dismissedIds() {
    return new Set(readLocal());
}

// The account's list joins the local one once per page load
export async function syncDismissed() {
    const state = await accountState();
    const remote = Array.isArray(state[ACCOUNT_KEY]) ? state[ACCOUNT_KEY].filter(Number.isInteger) : [];
    const local = readLocal();
    const merged = [...new Set([...remote, ...local])].slice(-MAX);
    writeLocal(merged);
    if (merged.length !== remote.length) saveAccountState(ACCOUNT_KEY, merged);
    return new Set(merged);
}

export function setDismissed(id, on) {
    const ids = readLocal().filter(x => x !== id);
    if (on) ids.push(id);
    writeLocal(ids);
    saveAccountState(ACCOUNT_KEY, ids.slice(-MAX));
}
