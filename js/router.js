// @ts-check
import { esc, emptyIcon, SKELETON } from './store.js';
import { hasDraft, mayDiscard } from './drafts.js';

const routes = [];
let currentCleanup = null;
let navId = 0;

// The bottom tab bar has no room for every page: these pages light up another tab there
// Browse, Season and Calendar share the Discover tab
const DISCOVER_PAGES = ['search', 'season', 'calendar'];
const DISCOVER_KEY = 'aniroll_discover';

export function route(pattern, handler) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
    });
    routes.push({ pattern, regex: new RegExp(`^${regexStr}$`), paramNames, handler });
}

// Another look can bring its own version of a page: the same pattern, a handler like route()'s, null to give
// the page back. The page on screen is drawn again either way
const overrides = new Map();
let started = false;
export function overridePage(pattern, handler) {
    handler ? overrides.set(pattern, handler) : overrides.delete(pattern);
    const hash = window.location.hash.slice(1) || '/';
    if (started && routes.some(r => r.pattern === pattern && r.regex.test(hash.split('?')[0]))) return resolve();
    return Promise.resolve();
}

// The current page drawn again (a no-op before the router has started)
export function redraw() {
    return started ? resolve() : Promise.resolve();
}

export function navigate(path) {
    window.location.hash = path;
}

export async function resolve() {
    const hash = window.location.hash.slice(1) || '/';
    const [path, queryString] = hash.split('?');
    const query = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : {};
    const id = ++navId;

    if (currentCleanup) {
        currentCleanup();
        currentCleanup = null;
    }

    // Every navigation renders into its own container. A slower page that finishes after the
    // user has moved on writes into a detached node instead of over the current page.
    const main = document.getElementById('content');
    const content = document.createElement('div');
    main.replaceChildren(content);

    for (const r of routes) {
        const match = path.match(r.regex);
        if (match) {
            const params = {};
            r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });

            content.innerHTML = SKELETON.page;
            // Right away, not after loading: the calendar waits for its schedule first
            updateActiveNav(path);
            // A page may name itself (a studio, the player); otherwise its heading does, below
            document.title = 'AniRoll';
            const focusWasOnPage = !document.activeElement || document.activeElement === document.body || main.contains(document.activeElement)
                || !!document.activeElement.closest?.('.nav-links, .mobile-tabbar');

            try {
                const cleanup = await (overrides.get(r.pattern) || r.handler)({ params, query, content });
                if (id !== navId) {
                    // Superseded while loading: stop its timers right away
                    if (typeof cleanup === 'function') cleanup();
                    return;
                }
                if (typeof cleanup === 'function') currentCleanup = cleanup;
                announcePage(content, id, focusWasOnPage);
            } catch (err) {
                if (id !== navId) return;
                console.error('Route error:', err);
                content.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">${emptyIcon('alert')}</div>
                        <div class="empty-state-text">Something went wrong</div>
                        <div class="empty-state-sub">${esc(err.message)}</div>
                    </div>`;
            }
            return;
        }
    }

    content.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">${emptyIcon('search')}</div>
            <div class="empty-state-text">Page not found</div>
        </div>`;
}

// After a page change: the tab title says which page this is, and focus moves to the page's heading so a
// screen reader reads where you are and Tab continues from there (not on the first load, and not when focus
// is somewhere else on purpose, e.g. in the search box)
function announcePage(content, id, focusWasOnPage) {
    const h1 = content.querySelector('h1');
    const name = h1?.textContent.trim().replace(/\s+/g, ' ');
    if (document.title === 'AniRoll' && name && name !== 'AniRoll') document.title = `${name} · AniRoll`;
    if (id === 1 || !focusWasOnPage || !h1 || document.querySelector('[aria-modal="true"]')) return;
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
}

function updateActiveNav(path) {
    const page = path === '/' ? 'home' : path.split('/')[1];
    // A studio page is reached from a detail page, but belongs with discovering shows
    const group = DISCOVER_PAGES.includes(page) || page === 'studio' ? 'discover' : null;
    document.querySelectorAll('[data-page]').forEach((/** @type {HTMLElement} */ el) => {
        const on = el.dataset.page === page || el.dataset.page === group;
        el.classList.toggle('active', on);
        if (on) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
    });
    // The Discover tab brings you back to the view you used last
    if (group) {
        try { localStorage.setItem(DISCOVER_KEY, page); } catch { /* storage blocked */ }
    }
    let last = 'search';
    try { last = DISCOVER_PAGES.includes(localStorage.getItem(DISCOVER_KEY)) ? localStorage.getItem(DISCOVER_KEY) : 'search'; } catch { /* default */ }
    document.querySelectorAll('[data-page="discover"]').forEach((/** @type {HTMLAnchorElement} */ el) => { el.href = `#/${last}`; });
}

// Moving on with an unsent reply or post asks first: the old address goes back in place (no new
// history step) while the question is open, and on "Discard" the move happens after all
export function startRouter() {
    started = true;
    let shown = location.hash;
    window.addEventListener('hashchange', async () => {
        const target = location.hash;
        if (hasDraft()) {
            history.replaceState(history.state, '', shown || location.pathname + location.search);
            if (await mayDiscard()) location.hash = target;
            return;
        }
        shown = target;
        resolve();
    });
    resolve();
}
