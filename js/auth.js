const TOKEN_KEY = 'aniroll_token';
const USER_KEY = 'aniroll_user';

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
    return !!getToken();
}

export function getCachedUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function setCachedUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function handleOAuthCallback() {
    const hash = window.location.hash;
    if (!hash.includes('access_token')) return false;

    const token = new URLSearchParams(hash.substring(1)).get('access_token');
    // replaceState instead of setting location.hash keeps the token out of the browser history
    history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
    if (!token) return false;
    setToken(token);
    localStorage.removeItem(USER_KEY); // don't flash a previous account's cached user
    return true;
}

export function getLoginUrl(clientId) {
    return `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`;
}

export function logout() {
    // The seat in the app (js/seat.js) goes to the next in line at once; keepalive outlives the reload
    const token = getToken();
    if (token) fetch('/api/seat', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
    removeToken();
    window.location.hash = '/';
    window.location.reload();
}
