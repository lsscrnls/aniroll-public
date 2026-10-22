// @ts-check
// Several AniList accounts in one browser, and "delete my data".
//
// The signed-in account's values live under their usual keys. Switching parks them in one value of their own
// (aniroll_parked_<id>) and brings the other account's back, so nothing of one account leaks into the other:
// not its Jellyfin connection, not its synced values. Settings of the browser itself (theme, player volume,
// list view, ...) stay where they are. Lists and other answers from AniList are cached per account already
// (js/api.js), and so is the queue of saves that have not reached AniList yet.
import { getToken, setToken, getCachedUser, getLoginUrl, rememberReturn } from './auth.js';
import * as api from './api.js';
import { toast } from './store.js';

const LIST_KEY = 'aniroll_accounts';            // [{ id, name, avatar, token }]
const PARKED = 'aniroll_parked_';               // + account id
const ADDING = 'aniroll_adding_from';           // the account that was signed in when "Add account" went to AniList
const NOTE_KEY = 'aniroll_data_note';           // the one-time note where to delete your data, per account

// The browser's, not an account's: they stay when you switch
const DEVICE = new Set([LIST_KEY, ADDING, 'aniroll_theme', 'aniroll_accent', 'aniroll_title_lang', 'aniroll_design',
    'aniroll_design_v2', 'aniroll_m3_variant', 'aniroll_m3_seed', 'aniroll_m3_scheme3', 'aniroll_m3_show',
    'aniroll_player_volume', 'aniroll_player_quality', 'aniroll_sub_size', 'aniroll_subs_pref', 'aniroll_audio_pref',
    'aniroll_ambient', 'aniroll_bitrate_test', 'aniroll_list_view', 'aniroll_list_sort', 'aniroll_list_format',
    'aniroll_cal_view', 'aniroll_cal_images', 'aniroll_settings_tab', 'aniroll_discover', 'aniroll_friends_tab',
    'aniroll_discord', 'aniroll_discord_nagged', 'aniroll_discord_ext_nagged', 'aniroll_maint_seen', 'aniroll_visit_from',
    'aniroll_req_times', 'aniroll_login_started', 'aniroll_pending_saves', 'aniroll_dl_hide_done', 'aniroll_jf_device',
    'aniroll_seen_changes', 'aniroll_vip_device', 'aniroll_watch_order']);
const ownKeys = () => Object.keys(localStorage).filter(k => k.startsWith('aniroll_') && !DEVICE.has(k) && !k.startsWith(PARKED));

/** @returns {{ id: number, name: string, avatar: string, token: string }[]} */
export function accounts() {
    try {
        const list = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
        return Array.isArray(list) ? list.filter(a => a && a.id && a.token) : [];
    } catch { return []; }
}

function saveAccounts(list) {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* this visit only */ }
}

// Called once the viewer is known: the account joins the list (or refreshes its name, picture and token).
// Signed in again as an account that was parked (added twice, or AniList signed in the one you had), its own
// values come back; returns true when that needs a reload.
export function rememberAccount(user) {
    const token = getToken();
    if (!user?.id || !token) return false;
    const entry = { id: user.id, name: user.name, avatar: user.avatar?.medium || '', token };
    const list = accounts();
    const i = list.findIndex(a => a.id === user.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
    saveAccounts(list);
    try { localStorage.removeItem(ADDING); } catch { /* nothing pending */ }
    if (localStorage.getItem(PARKED + user.id) == null) return false;
    unpark(user.id, ['aniroll_token', 'aniroll_user']);
    return true;
}

function park(id) {
    const values = {};
    for (const k of ownKeys()) { values[k] = localStorage.getItem(k); localStorage.removeItem(k); }
    try { localStorage.setItem(PARKED + id, JSON.stringify(values)); } catch { /* full: the values are gone, the account is not */ }
}

function unpark(id, keep = []) {
    let values = {};
    try { values = JSON.parse(localStorage.getItem(PARKED + id) || '{}') || {}; } catch { /* nothing to restore */ }
    localStorage.removeItem(PARKED + id);
    for (const [k, v] of Object.entries(values)) if (!keep.includes(k) && typeof v === 'string') localStorage.setItem(k, v);
}

// The app's seat (js/seat.js) goes to the next in line at once; keepalive outlives the reload
function releaseSeat(token) {
    if (token) fetch('/api/seat', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
}

function reloadHome() {
    window.location.hash = '/';
    window.location.reload();
}

export function switchAccount(id) {
    const target = accounts().find(a => a.id === id);
    const me = getCachedUser()?.id;
    if (!target || target.id === me) return;
    releaseSeat(getToken());
    if (me != null) park(me);
    else ownKeys().forEach(k => localStorage.removeItem(k));
    unpark(target.id);
    setToken(target.token);
    reloadHome();
}

let wrongAccountNote = null;

// "Add account" in a small window of its own: AniRoll stays as it is, and if AniList shows the account you
// are already signed in with, you sign out and in with the other one right there. AniList sends the window
// back to AniRoll with the token; that page hands it over (finishInPopup) and closes. The account is checked
// with AniList, joins the list and is switched to. Resolves to 'switched' (the page reloads), 'same' or null.
export async function addAccount(clientId) {
    const w = 440, h = 680;
    const popup = window.open(getLoginUrl(clientId), 'aniroll-add-account',
        `popup,width=${w},height=${h},left=${Math.max(0, (screen.width - w) / 2)},top=${Math.max(0, (screen.height - h) / 2)}`);
    if (!popup) { addAccountHere(clientId); return null; }
    // Stays until it is dismissed or the other account is in (the page reloads then); one at a time
    if (!wrongAccountNote?.open) {
        wrongAccountNote = toast('Sign in with the other account in the new window. AniList shows the one you already have? Sign out there first, then sign in with the other one.', 'info', { stay: true });
    }
    /** @type {any} */ (window).__anirollAdding = true;
    const token = await new Promise((resolve) => {
        const done = (value) => { window.removeEventListener('message', onMessage); clearInterval(watch); /** @type {any} */ (window).__anirollAdding = false; resolve(value); };
        const onMessage = (e) => {
            if (e.origin !== location.origin || e.source !== popup || e.data?.aniroll !== 'add-account') return;
            done(typeof e.data.token === 'string' ? e.data.token : null);
        };
        const watch = setInterval(() => { if (popup.closed) done(null); }, 500);
        window.addEventListener('message', onMessage);
    });
    if (!token) return null;
    const viewer = await api.getViewer(token);
    const entry = { id: viewer.id, name: viewer.name, avatar: viewer.avatar?.medium || '', token };
    const list = accounts().filter(a => a.id !== viewer.id);
    saveAccounts([...list, entry]);
    if (viewer.id === getCachedUser()?.id) {
        setToken(token);
        return 'same';
    }
    switchAccount(viewer.id);
    return 'switched';
}

// In the window "Add account" opened, back from AniList: the token goes to the AniRoll that asked, never into
// this browser's storage (that would sign the other tab in as well), and the window closes. Only an AniRoll
// window of the same site that is waiting for it gets the token; a page anyone else opened gets nothing.
export function finishInPopup() {
    let opener = null;
    try { opener = window.opener && window.opener.location.origin === location.origin && window.opener.__anirollAdding ? window.opener : null; } catch { /* another site opened this */ }
    if (!opener) return false;
    const token = new URLSearchParams(location.hash.slice(1)).get('access_token');
    history.replaceState(null, '', location.pathname);
    opener.postMessage({ aniroll: 'add-account', token }, location.origin);
    window.close();
    return true;
}

// A blocked pop-up: the old way, AniRoll itself goes to AniList and comes back
function addAccountHere(clientId) {
    const me = getCachedUser()?.id;
    if (me != null) {
        releaseSeat(getToken());
        park(me);
        try { localStorage.setItem(ADDING, String(me)); } catch { /* no way back on cancel */ }
    }
    rememberReturn();
    window.location.href = getLoginUrl(clientId);
}

// Came back from AniList without signing in after "Add account": the account you had is still yours
export function resumeAfterCancelledAdd() {
    const from = Number(localStorage.getItem(ADDING));
    if (!from || getToken()) return false;
    localStorage.removeItem(ADDING);
    const back = accounts().find(a => a.id === from);
    if (!back) return false;
    unpark(from);
    setToken(back.token);
    return true;
}

// Leaves the browser: this account's values, cache and list entry go. Another remembered account takes over,
// or you are signed out
async function leave() {
    const me = getCachedUser()?.id;
    releaseSeat(getToken());
    await api.forgetAccountCache().catch(() => {});
    ownKeys().forEach(k => localStorage.removeItem(k));
    const rest = accounts().filter(a => a.id !== me);
    saveAccounts(rest);
    if (rest.length) {
        unpark(rest[0].id);
        setToken(rest[0].token);
    }
    reloadHome();
}

export function signOut() {
    return leave();
}

// Everything AniRoll keeps for this account: on the server (DELETE /api/me), then in this browser, also the
// changes that have not reached AniList yet. AniList itself (the list, posts) is not AniRoll's to delete.
export async function deleteMyData() {
    const token = getToken();
    const res = await fetch('/api/me', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The server answered ${res.status}`);
    api.forgetPendingSaves();
    await leave();
}

// Once per account: where your data can be deleted (new accounts and the ones from before alike)
export function dataNoteDue() {
    if (localStorage.getItem(NOTE_KEY)) return false;
    try { localStorage.setItem(NOTE_KEY, '1'); } catch { /* shown again next time */ }
    return true;
}
