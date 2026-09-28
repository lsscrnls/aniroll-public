import { getToken } from './auth.js?v=107';

// Background sync: with the user's consent the AniRoll backend keeps the AniList token
// (encrypted) and updates the list while no tab is open — Watch Party guests following the
// host, and episodes finished in Jellyfin. One consent covers both.
const URL = '/api/account/background';

async function request(method) {
    const token = getToken();
    if (!token) throw new Error('Log in first');
    const res = await fetch(URL, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Background sync request failed (${res.status})`);
    return !!body.enabled;
}

export const getBackgroundAccess = () => request('GET');
export const allowBackgroundAccess = () => request('PUT');
export const removeBackgroundAccess = () => request('DELETE');

// ===== Watch Party preference =====
// 'open': sync only while AniRoll is open on screen; 'background': also in the background and when closed
const MODE_KEY = 'aniroll_party_sync_mode';
const ASK_KEY = 'aniroll_party_sync_ask';

export function getPartySyncMode() {
    return localStorage.getItem(MODE_KEY) === 'background' ? 'background' : 'open';
}

export function setPartySyncMode(mode) {
    localStorage.setItem(MODE_KEY, mode === 'background' ? 'background' : 'open');
}

export function askOnJoin() {
    return localStorage.getItem(ASK_KEY) !== 'off';
}

export function setAskOnJoin(on) {
    localStorage.setItem(ASK_KEY, on ? 'on' : 'off');
}
