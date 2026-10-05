// @ts-check
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

// Where the visitor was when they pressed Log in (a party invite, a shared show): AniList sends
// everyone back to the start, so the page is kept for the moment the login comes back
const RETURN_KEY = 'aniroll_login_return';

export function rememberReturn() {
    const hash = window.location.hash;
    // Only an app route, never a token or anything that is not one of our pages
    if (/^#\/[\w\-/?=&%.,]*$/.test(hash) && hash.length < 300 && hash !== '#/') {
        try { sessionStorage.setItem(RETURN_KEY, hash); } catch { /* back to Home */ }
    }
}

function takeReturn() {
    try {
        const hash = sessionStorage.getItem(RETURN_KEY);
        sessionStorage.removeItem(RETURN_KEY);
        return hash && /^#\/[\w\-/?=&%.,]*$/.test(hash) ? hash : '#/';
    } catch { return '#/'; }
}

export function handleOAuthCallback() {
    const hash = window.location.hash;
    if (!hash.includes('access_token')) return false;

    const token = new URLSearchParams(hash.substring(1)).get('access_token');
    // replaceState instead of setting location.hash keeps the token out of the browser history
    history.replaceState(null, '', window.location.pathname + window.location.search + (token ? takeReturn() : '#/'));
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
