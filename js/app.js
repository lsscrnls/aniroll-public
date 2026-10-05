import { route, startRouter, navigate } from './router.js?v=142';
import { takeSeat } from './seat.js?v=142';
import { getToken, isLoggedIn, handleOAuthCallback, getCachedUser, setCachedUser, logout, getLoginUrl, rememberReturn } from './auth.js?v=142';
import { getState, setState, applyTheme, getTheme, cycleTheme, toast, applyAccentColor, getAccentColor, esc, titlePref, statusLabel } from './store.js?v=142';
import * as api from './api.js?v=142';
import { initAnimations, refreshAnimations, stopLenis, startLenis } from './animations.js?v=142';
import { openDialog, initActivation } from './a11y.js?v=142';
import { noteVisitor, maybeShowMoveNotice, openChangelog, hasUnread } from './whatsnew.js?v=142';
import { refreshPendingStatus, refreshJellyfinStatus } from './status.js?v=142';
import { applyDesign } from './design.js?v=142';

const CLIENT_ID = '50643';
const APP_VERSION = '142';

// Report uncaught errors to our backend (api/server.js → data/client-errors.log).
// Each distinct message once per page load, at most 10 — a loop must not flood the log.
// Rate limiting and throttling are expected states, not bugs.
const reportedErrors = new Set();
function reportError(error, message, source) {
    if (error && (error.rateLimited || error.throttled || error.offline)) return;
    const text = String(message || error?.message || error || '').slice(0, 500);
    if (!text || text === 'Script error.' || reportedErrors.has(text) || reportedErrors.size >= 10) return;
    reportedErrors.add(text);
    const payload = JSON.stringify({
        message: text,
        source: source || '',
        stack: error?.stack || '',
        route: location.hash.split('?')[0] || '#/',
        version: APP_VERSION,
    });
    try {
        navigator.sendBeacon('/api/log', new Blob([payload], { type: 'application/json' }));
    } catch {}
}
window.addEventListener('error', e => reportError(e.error, e.message, e.filename ? `${e.filename}:${e.lineno}` : ''));
window.addEventListener('unhandledrejection', e => reportError(e.reason));

async function init() {
    // Before anything writes to storage: did this browser know the old layout?
    const returning = noteVisitor();
    applyTheme(getTheme());
    applyAccentColor(getAccentColor());
    initActivation();
    setupSlidePanel();

    handleOAuthCallback();
    // After the OAuth callback: a fresh login gets its chosen design right away (logged out: always AniRoll's)
    applyDesign(isLoggedIn());

    if (isLoggedIn()) {
        const cached = getCachedUser();
        if (cached) {
            setState({ user: cached, token: getToken() });
            updateUserUI(cached);
        }
        // With a cached user we render right away and refresh the viewer in the background.
        // A fresh cache skips the request entirely — it ran on every single page load before.
        const cacheAge = Date.now() - Number(localStorage.getItem('aniroll_user_ts') || 0);
        if (!cached || cacheAge > 10 * 60 * 1000) {
            const viewer = loadViewer();
            if (!cached && !(await viewer)) return;
        }
    }

    // At most 100 people at once: a seat first, or the waiting page until one is free
    if (isLoggedIn()) await takeSeat();

    setupRoutes();
    setupNav();
    setupSearch();
    startRouter();
    initAnimations();
    setupWhatsNew(returning);

    // Guests of a Watch Party keep syncing with the host on every page, not only on /watchparty
    if (isLoggedIn() && localStorage.getItem('aniroll_joined_party')) {
        import('./pages/watchparty.js?v=142').then(m => m.initGuestSync());
    }
    // Hosts get their running party back on a second device, and a pill leading back to it
    if (isLoggedIn()) {
        import('./pages/watchparty.js?v=142').then(async m => {
            if (!localStorage.getItem('aniroll_watchparty')) await m.restoreHostParty();
            m.renderPartyPill();
        });
    }
    // The Jellyfin connection belongs to the AniList account, so pull it in on this device
    if (isLoggedIn()) {
        import('./jellyfin.js?v=142').then(async m => {
            await m.loadAccountConfig();
            setupJellyfinLive();
        });
    }
    if (isLoggedIn()) setupPendingSaveRetry();
    if (isLoggedIn()) setupJellyfinPull();
    if (isLoggedIn()) import('./drift.js?v=142').then(m => m.startDrift()).catch(() => { /* not essential */ });
    import('./touches.js?v=142').then(m => m.startTouches()).catch(() => { /* not essential */ });
    watchMaintenanceMode();
}

// List changes that AniList refused while rate limiting are queued — push them out
// as soon as it answers again, and tell the user once when the pause starts.
function setupPendingSaveRetry() {
    const flush = async () => {
        const n = await api.flushPendingSaves(getToken());
        if (n) toast(`Synced ${n} saved change${n > 1 ? 's' : ''} to AniList`, 'success');
    };

    if (api.pendingSaveCount()) setTimeout(flush, 3000);
    setInterval(flush, 5 * 60 * 1000);
    // Back online: what was saved offline goes out now, not in up to 5 minutes
    window.addEventListener('online', () => { refreshPendingStatus(); setTimeout(flush, 1500); });
    window.addEventListener('offline', refreshPendingStatus);

    let noticeAt = 0;
    window.addEventListener('aniroll:rate-limited', () => {
        if (Date.now() - noticeAt < 5 * 60 * 1000) return;
        noticeAt = Date.now();
        const queued = api.pendingSaveCount();
        toast(queued
            ? `AniList is rate limiting — ${queued} change${queued > 1 ? 's' : ''} queued, retrying in 5 min`
            : 'AniList is rate limiting — background syncing pauses for 5 min', 'error');
    });
}

// Maintenance mode is decided on the server, so one switch quiets every open tab and device
const MAINT_SEEN_KEY = 'aniroll_maint_seen';
const MAINT_NOTICE_WINDOW = 60 * 60 * 1000;

function watchMaintenanceMode() {
    let active = null;

    const apply = (on, note) => {
        if (on === active) return;
        active = on;
        api.setBackgroundPaused(on);

        const banner = document.getElementById('maintenance-banner');
        if (banner) {
            banner.hidden = !on;
            banner.textContent = on
                ? `Maintenance mode — background syncing is paused${note ? `: ${note}` : ''}`
                : '';
        }

        if (on) {
            try { localStorage.setItem(MAINT_SEEN_KEY, String(Date.now())); } catch { /* storage blocked */ }
            return;
        }

        // Only for browsers that actually sat through the maintenance, and only while it is
        // still recent — otherwise every single page load announced the end of something
        // that was long over (the first check has no previous state to compare against)
        const seen = Number(localStorage.getItem(MAINT_SEEN_KEY) || 0);
        if (!seen) return;
        if (Date.now() - seen < MAINT_NOTICE_WINDOW) {
            toast('Maintenance mode over — syncing runs again', 'success');
        }
        try { localStorage.removeItem(MAINT_SEEN_KEY); } catch { /* storage blocked */ }
    };

    const check = async () => {
        try {
            const res = await fetch('/api/maintenance', { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return;
            const state = await res.json();
            apply(!!state.maintenance, state.note);
        } catch { /* backend unreachable: leave things as they are */ }
    };

    // Logged in, the seat heartbeat (js/seat.js) brings the state every 30 s; asking here as well is only
    // for visitors, and until the first heartbeat has answered
    let viaSeat = false;
    window.addEventListener('aniroll:seat', (e) => { viaSeat = true; apply(!!e.detail.maintenance, e.detail.note); });
    check();
    setInterval(() => { if (!viaSeat) check(); }, 60000);
}

// Jellyfin -> AniList: what you watched on your own server moves your list forward
function setupJellyfinPull() {
    const pull = async () => {
        if (api.shouldHoldBackground()) return;
        const { getConfig, isPullEnabled, pullFromJellyfin } = await import('./jellyfin.js?v=142');
        if (!getConfig() || !isPullEnabled()) return;
        const user = getState().user;
        if (!user) return;
        try {
            // Series linked by hand on another device first
            await import('./jflinks.js?v=142').then(m => m.syncLinks()).catch(() => {});
            const res = await pullFromJellyfin(user, getToken());
            for (const c of res.changes || []) {
                toast(`Jellyfin: ${c.title} moved to episode ${c.to}`, 'success');
            }
        } catch (err) {
            console.warn('Jellyfin pull failed:', err.message);
        }
    };
    setTimeout(pull, 6000);
    setInterval(pull, 15 * 60 * 1000);
}

// Jellyfin webhook -> AniRoll backend: the chip in the navbar, toasts for tracked episodes,
// and episodes the backend could not write (no access, AniList blocking it) applied from here
async function setupJellyfinLive() {
    const jf = await import('./jellyfin.js?v=142');
    // Set up on another device: fetch the link once, only for people who use Jellyfin at all
    if (!jf.getHookSecret() && jf.getConfig()) await jf.loadHook().catch(() => null);
    const np = await import('./nowplaying.js?v=142');
    window.addEventListener(jf.NOW_EVENT, (e) => np.renderNowChip(document.getElementById('jf-now-chip'), e.detail));
    jf.startNowPlaying({
        onTracked: (item) => {
            if (item.status === 'saved') {
                api.clearCache('MediaListCollection');
                api.clearCache('Media(id');
                // The server wrote it, so nothing here knew: the feed and friends' progress go stale
                api.expireCache('activities(');
                api.expireCache('mediaList(mediaId');
                api.expireCache('mediaList(userId_in');
                const text = item.type === 'Movie'
                    ? (item.rewatch ? `Jellyfin: ${item.title} counted as a rewatch` : `Jellyfin: ${item.title} saved to AniList as watched`)
                    : `Jellyfin: ${item.title} · ${item.rewatch ? 'rewatch ' : ''}episode ${item.episode} saved to AniList`;
                toast(text, 'success');
            } else if (item.status === 'unmatched') {
                toast(`Jellyfin: ${item.title} was not found on AniList, so it was not tracked`, 'info');
            }
        },
        onPending: (items, state) => applyJellyfinPending(jf, items, state),
    });
}

let jfPendingAt = 0;

async function applyJellyfinPending(jf, items, state) {
    // With background access the backend retries on its own; step in only when it cannot
    const due = items.filter(p => !state.background || Date.now() - p.at > 3 * 60 * 1000);
    const user = getState().user;
    const token = getToken();
    if (!due.length || !user || !token || api.shouldHoldBackground() || Date.now() - jfPendingAt < 60000) return;
    jfPendingAt = Date.now();

    const entries = (await api.getMediaList(user.id, 'ANIME', token).catch(() => [])).flatMap(l => l.entries);
    const done = [];
    for (const p of due) {
        const entry = entries.find(e => e.mediaId === p.mediaId);
        try {
            const max = entry?.media?.episodes;
            const target = max ? Math.min(p.target, max) : p.target;
            let vars = null;
            if (!entry) {
                vars = { mediaId: p.mediaId, progress: target, status: 'CURRENT', startedAt: api.fuzzyToday() };
            } else if (entry.status === 'COMPLETED') {
                // Same rule as the backend: episode 1 of a completed show starts a rewatch. A movie
                // watched again is left to the backend, which guards against counting it twice
                if (target === 1 && max !== 1) vars = { id: entry.id, status: 'REPEATING', progress: 1 };
            } else if ((entry.progress || 0) < target) {
                vars = api.progressVars(entry, target, max); // a REPEATING finish counts the rewatch
            }
            if (vars) {
                await api.saveMediaListEntry(vars, token);
                toast(`Jellyfin: ${p.title} · episode ${target} saved to AniList`, 'success');
            }
            done.push(p.id);
        } catch (err) {
            if (err.rateLimited || err.throttled || err.offline) break;
        }
    }
    await jf.ackPending(done);
}

// Logging out also forgets what AniRoll cached for this account on this browser
function signOut() {
    api.forgetAccountCache().catch(() => {}).finally(logout);
}

// Returns false when the session is invalid (logout already triggered)
async function loadViewer() {
    try {
        const user = await api.getViewer(getToken());
        setState({ user, token: getToken() });
        setCachedUser(user);
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        updateUserUI(user);
        if (user.unreadNotificationCount > 0) {
            const badge = document.getElementById('notif-badge');
            if (badge) {
                badge.textContent = user.unreadNotificationCount > 9 ? '9+' : user.unreadNotificationCount;
                badge.hidden = false;
            }
        }
    } catch (err) {
        console.error('Failed to fetch user:', err);
        if (err.message?.includes('Invalid token')) {
            toast('Session expired, please log in again', 'error');
            signOut();
            return false;
        }
    }
    return true;
}

function setupRoutes() {
    route('/', async (ctx) => {
        const { render, loadLandingTrending } = await import('./pages/home.js?v=142');
        const cleanup = await render(ctx);
        if (!isLoggedIn()) loadLandingTrending();
        refreshAnimations();
        return cleanup;
    });

    route('/studio/:id', async (ctx) => {
        const { render } = await import('./pages/studio.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/staff/:id', async (ctx) => {
        const { render } = await import('./pages/staff.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    // The owner's view of how busy AniRoll is (the server checks who asks)
    route('/admin', async (ctx) => {
        const { render } = await import('./pages/admin.js?v=142');
        return render(ctx);
    });

    route('/shelf', async (ctx) => {
        const { render } = await import('./pages/shelf.js?v=142');
        return render(ctx);
    });

    route('/search', async (ctx) => {
        const { render } = await import('./pages/search.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/anime/:id', async (ctx) => {
        openDetailPanel(parseInt(ctx.params.id));
    });

    route('/anime/:id/full', async (ctx) => {
        const { render } = await import('./pages/detail.js?v=142');
        await render({ params: { id: ctx.params.id }, content: ctx.content });
        refreshAnimations();
    });

    // The player loads only when something is played
    route('/play/:id/:episode', async (ctx) => {
        const { render } = await import('./pages/play.js?v=142');
        return render(ctx);
    });

    route('/manga/:id', async (ctx) => {
        openDetailPanel(parseInt(ctx.params.id));
    });

    route('/manga/:id/full', async (ctx) => {
        const { render } = await import('./pages/detail.js?v=142');
        await render({ params: { id: ctx.params.id }, content: ctx.content });
        refreshAnimations();
    });

    route('/list', async (ctx) => {
        const { render } = await import('./pages/list.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/list/:username', async (ctx) => {
        const { render } = await import('./pages/list.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/social', async (ctx) => {
        const { render } = await import('./pages/social.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/profile', async (ctx) => {
        const { render } = await import('./pages/profile.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/user/:username', async (ctx) => {
        const { render } = await import('./pages/profile.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/season', async (ctx) => {
        const { render } = await import('./pages/season.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/season/:year/:season', async (ctx) => {
        const { render } = await import('./pages/season.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/roll', async (ctx) => {
        const { render } = await import('./pages/roll.js?v=142');
        const cleanup = await render(ctx);
        refreshAnimations();
        return cleanup;
    });

    route('/calendar', async (ctx) => {
        const { render } = await import('./pages/calendar.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/notifications', async (ctx) => {
        const { render } = await import('./pages/notifications.js?v=142');
        await render(ctx);
        refreshAnimations();
    });

    route('/watchparty', async (ctx) => {
        const { render } = await import('./pages/watchparty.js?v=142');
        const cleanup = await render(ctx);
        refreshAnimations();
        return cleanup;
    });

    route('/settings', async (ctx) => {
        const { render } = await import('./pages/settings.js?v=142');
        await render(ctx);
    });


}

// Frosted nav once the page has scrolled (CSS .glass-nav.is-scrolled); Lenis scrolls natively, so `scroll` fires
function setupNavBackdrop() {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    let on = null;
    const update = () => {
        const next = window.scrollY > 8;
        if (next !== on) nav.classList.toggle('is-scrolled', (on = next));
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('hashchange', () => requestAnimationFrame(update));
    update();
}

function setupNav() {
    setupNavBackdrop();
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userBtn = document.getElementById('user-btn');
    const userDropdown = document.getElementById('user-dropdown');
    const themeToggle = document.getElementById('theme-toggle');
    const notifBtn = document.getElementById('notif-btn');

    if (isLoggedIn()) {
        loginBtn.hidden = true;
    } else {
        loginBtn.hidden = false;
        document.getElementById('user-menu').style.display = 'none';
        loginBtn.addEventListener('click', () => {
            rememberReturn();
            window.location.href = getLoginUrl(CLIENT_ID);
        });
    }

    // The profile menu: says whether it is open, takes focus to its first item, Escape closes it and
    // gives focus back to the button
    const setMenu = (open, { focus = false } = {}) => {
        if (!userDropdown) return;
        userDropdown.hidden = !open;
        userBtn?.setAttribute('aria-expanded', String(open));
        if (open) {
            refreshJellyfinStatus();
            if (focus) userDropdown.querySelector('a:not([hidden]), button:not([hidden])')?.focus();
        }
    };
    userBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        // A click from the keyboard (detail 0) moves focus into the menu; a mouse click leaves it
        setMenu(userDropdown.hidden, { focus: e.detail === 0 });
    });
    userDropdown?.addEventListener('keydown', (e) => {
        const items = [...userDropdown.querySelectorAll('a:not([hidden]), button:not([hidden])')];
        const i = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); setMenu(false); userBtn?.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    });

    document.addEventListener('click', () => setMenu(false));

    logoutBtn?.addEventListener('click', signOut);

    themeToggle?.addEventListener('click', () => {
        const next = cycleTheme();
        const names = { system: 'System', dark: 'Dark', light: 'Light' };
        toast(`Theme: ${names[next]}`, 'success');
    });

    notifBtn?.addEventListener('click', () => navigate('/notifications'));

}

// "What's new": a quiet entry in the profile menu (and under the landing page), marked while
// something is unread; the one-time notice about the moved tabs for returning visitors
function setupWhatsNew(returning) {
    // On <html>, so links rendered later (the landing page) are marked too
    document.documentElement.classList.toggle('whatsnew-unread', hasUnread());
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.whatsnew-link')) return;
        e.preventDefault();
        document.getElementById('user-dropdown')?.setAttribute('hidden', '');
        openChangelog();
    });
    maybeShowMoveNotice(returning);
}

function setupSearch() {
    const overlay = document.getElementById('search-overlay');
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    const closeBtn = document.getElementById('search-close');

    let releaseDialog = null;

    function openSearch() {
        overlay.hidden = false;
        input.value = '';
        results.innerHTML = '';
        releaseDialog = openDialog(overlay.querySelector('.search-container'), { label: 'Search', onClose: closeSearch, focus: '#search-input' });
    }

    function closeSearch() {
        overlay.hidden = true;
        releaseDialog?.();
        releaseDialog = null;
    }

    // A result opens the detail panel (js/a11y.js); the search closes first, so Escape and
    // focus belong to the panel. These run before the document-wide handler.
    results?.addEventListener('click', (e) => { if (e.target.closest('[data-open]')) closeSearch(); });
    results?.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) closeSearch();
    });

    closeBtn?.addEventListener('click', closeSearch);

    document.getElementById('search-btn')?.addEventListener('click', openSearch);

    overlay?.querySelector('.overlay-backdrop')?.addEventListener('click', closeSearch);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            overlay.hidden ? openSearch() : closeSearch();
        }
    });

    let timeout;
    input?.addEventListener('input', () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (!q) { results.innerHTML = ''; return; }
        // Something else on the page may answer a query itself by cancelling this event; a query marked
        // "literal" (data-literal on the input) is always searched
        const literal = input.dataset.literal === q;
        delete input.dataset.literal;
        if (!literal && !document.dispatchEvent(new CustomEvent('aniroll:search-typed', { cancelable: true, detail: { query: q, input, results } }))) return;
        // Your own shows first, at once and from the list this tab already has: no request, from the first letter
        const own = ownMatches(q);
        const ownHtml = own.length ? `<div class="search-group-title">On your list</div>${own.map(e => searchRow(e.media, e)).join('')}` : '';
        if (q.length < 4) {
            results.innerHTML = ownHtml || '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub" style="color:var(--text-secondary)">Type at least 4 characters…</div></div>';
            return;
        }
        results.innerHTML = ownHtml;

        timeout = setTimeout(async () => {
            try {
                const data = await api.searchMedia(q, null, 1, 8, getToken());
                const ownIds = new Set(own.map(e => e.media.id));
                const rest = (data.media || []).filter(m => !ownIds.has(m.id));
                results.innerHTML = ownHtml + (rest.length ? `${ownHtml ? '<div class="search-group-title">On AniList</div>' : ''}${rest.map(m => searchRow(m, m.mediaListEntry)).join('')}` : '')
                    || '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">No results found</div></div>';
            } catch (err) {
                results.innerHTML = `<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
            }
        }, 300);
    });
}

// One search result; entry: your list entry for it, if any (shown as its status and progress)
function searchRow(m, entry) {
    const status = entry?.status ? `<span class="search-result-status">${esc(statusLabel(entry.status, m.type))}${entry.progress ? ` · ${entry.progress}${m.episodes ? `/${m.episodes}` : ''}` : ''}</span>` : '';
    return `
        <div class="search-result-item" data-open="${m.id}" role="button" tabindex="0">
            <img class="search-result-img" src="${esc(m.coverImage?.large || '')}" alt="" loading="lazy">
            <div class="search-result-info">
                <div class="search-result-title">${esc(titlePref(m.title))}</div>
                <div class="search-result-meta">${[api.formatFormat(m.format) || '', m.meanScore ? m.meanScore + '%' : '', m.episodes ? `${m.episodes} Ep` : '', m.chapters ? `${m.chapters} Ch` : ''].filter(Boolean).join(' · ')}${status}</div>
            </div>
        </div>`;
}

// Entries of your anime and manga lists whose title has the query in it, best first (title start, then anywhere)
function ownMatches(q) {
    const user = getState().user;
    if (!user?.id) return [];
    const needle = q.toLowerCase();
    const seen = new Set();
    const hits = [];
    for (const type of ['ANIME', 'MANGA']) {
        for (const list of api.knownMediaList(user.id, type) || []) {
            for (const e of list.entries) {
                if (seen.has(e.id)) continue;
                const t = e.media.title || {};
                const names = [t.userPreferred, t.english, t.romaji, t.native].filter(Boolean).map(x => x.toLowerCase());
                const at = Math.min(...names.map(n => (n.startsWith(needle) ? 0 : n.includes(needle) ? 1 : 9)));
                if (at < 9) { seen.add(e.id); hits.push({ ...e, media: { ...e.media, type }, at }); }
            }
        }
    }
    return hits.sort((a, b) => a.at - b.at || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
}

function updateUserUI(user) {
    const loginBtn = document.getElementById('login-btn');
    const userMenu = document.getElementById('user-menu');
    const avatar = document.getElementById('user-avatar');
    const defaultIcon = document.getElementById('user-icon-default');

    if (loginBtn) loginBtn.hidden = true;
    if (userMenu) userMenu.style.display = '';
    // Admin: only for AniRoll's owner (hexlux); the server refuses everyone else anyway
    const adminLink = document.getElementById('admin-link');
    if (adminLink) adminLink.hidden = user.id !== 6649000;

    if (user.avatar?.medium || user.avatar?.large) {
        if (avatar) {
            avatar.src = user.avatar.medium || user.avatar.large;
            avatar.hidden = false;
        }
        if (defaultIcon) defaultIcon.hidden = true;
    }
}

function setupSlidePanel() {
    const overlay = document.getElementById('detail-panel-overlay');
    const closeBtn = document.getElementById('detail-panel-close-btn');
    const fullscreenBtn = document.getElementById('detail-panel-fullscreen-btn');
    const backdrop = overlay?.querySelector('.detail-panel-backdrop');

    function shut() {
        overlay?.classList.remove('open');
        overlay?.setAttribute('inert', '');
        releasePanel?.();
        releasePanel = null;
        startLenis();
    }
    // Material 3 morphs the cover back into the card it came from (js/m3.js sets the hook)
    function close() {
        if (window.__m3MorphBack && overlay?.classList.contains('open')) return window.__m3MorphBack(shut);
        shut();
    }
    closeDetailPanel = close;

    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    // A link to another page (a studio, a genre) leaves the panel behind instead of opening under it
    overlay?.addEventListener('click', (e) => {
        if (e.target.closest('a[href^="#/"]') && overlay.classList.contains('open')) close();
    });

    fullscreenBtn?.addEventListener('click', () => {
        const id = overlay?.dataset.mediaId;
        const type = overlay?.dataset.mediaType || 'anime';
        if (id) {
            const go = () => { shut(); window.location.hash = `/${type}/${id}/full`; };
            // Material 3: the panel's cover grows into the page's (container transform)
            if (window.__m3ToPage) window.__m3ToPage(go);
            else go();
        }
    });

    window.__openDetailPanel = openDetailPanel;
}

// Set by setupSlidePanel; the panel is one dialog however often a related title is opened in it
let closeDetailPanel = null;
let releasePanel = null;

async function openDetailPanel(id) {
    const overlay = document.getElementById('detail-panel-overlay');
    const body = document.getElementById('detail-panel-body');
    if (!overlay || !body) return;

    overlay.dataset.mediaId = id;
    overlay.classList.add('open');
    overlay.removeAttribute('inert');
    releasePanel = openDialog(overlay.querySelector('.detail-panel'), { label: 'Details', onClose: closeDetailPanel });
    stopLenis();
    body.scrollTop = 0;
    body.innerHTML = '<div class="page-loader" style="padding:var(--space-3xl)"><div class="loader-spinner"></div></div>';

    const { renderPanel } = await import('./pages/detail.js?v=142');
    await renderPanel(id, body);
    overlay.dataset.mediaType = body.querySelector('.detail-fullscreen-btn')?.dataset.type || 'anime';
}

init();
