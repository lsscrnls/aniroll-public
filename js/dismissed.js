// @ts-check
import { saveShared, syncShared } from './accountstate.js';

// Shows the user hid ("Hide" on a show's page, "Not interested" on a recommendation): kept in this browser
// and with the account, so Home, Roll, Season, Browse and the calendar leave them out on any device; a search
// still finds them, marked. Only ids, the newest few hundred.
const KEY = 'aniroll_not_interested';
const ACCOUNT_KEY = 'notint';
const MAX = 400;
const UNSENT = 'aniroll_not_interested_unsent';

function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]').filter(Number.isInteger); } catch { return []; }
}

function writeLocal(ids) {
    try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX))); } catch { /* this tab only */ }
}

export function dismissedIds() {
    return new Set(readLocal());
}

// Newest first, for Settings → Hidden anime
export function hiddenList() {
    return readLocal().reverse();
}

export const HIDDEN_EVENT = 'aniroll:hidden-changed';

// Once per page load: the account's list, or both joined while a change here has not reached it yet
export async function syncDismissed() {
    const clean = (v) => (Array.isArray(v) ? v.filter(Number.isInteger) : undefined);
    const merged = await syncShared(ACCOUNT_KEY, UNSENT, readLocal(), clean,
        (remote, local) => [...new Set([...remote, ...local])].slice(-MAX));
    writeLocal(merged);
    return new Set(merged);
}

export function setDismissed(id, on) {
    const ids = readLocal().filter(x => x !== id);
    if (on) ids.push(id);
    writeLocal(ids);
    saveShared(ACCOUNT_KEY, UNSENT, ids.slice(-MAX));
    document.dispatchEvent(new CustomEvent(HIDDEN_EVENT, { detail: { id, on } }));
}
