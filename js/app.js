import { route, startRouter, navigate } from './router.js?v=119';
import { takeSeat } from './seat.js?v=119';
import { getToken, isLoggedIn, handleOAuthCallback, getCachedUser, setCachedUser, logout, getLoginUrl } from './auth.js?v=119';
import { getState, setState, applyTheme, getTheme, cycleTheme, toast, applyAccentColor, getAccentColor, setAccentColor, getAccentColors, esc, titlePref } from './store.js?v=119';
import * as api from './api.js?v=119';
import { initAnimations, refreshAnimations, stopLenis, startLenis } from './animations.js?v=119';
import { openDialog, initActivation, showConfirm } from './a11y.js?v=119';
import { noteVisitor, maybeShowMoveNotice, openChangelog, hasUnread } from './whatsnew.js?v=119';
import { applyDesign, getDesign, getVariant, setDesign, switchDesign, setVariant, VARIANTS, SEEDS, SHOW_SEED, getShowTheme, getSeed, setSeed } from './design.js?v=119';

const CLIENT_ID = '50643';
const APP_VERSION = '119';

// Report uncaught errors to our backend (api/server.js → data/client-errors.log).
// Each distinct message once per page load, at most 10 — a loop must not flood the log.
// Rate limiting and throttling are expected states, not bugs.
const reportedErrors = new Set();
function reportError(error, message, source) {
    if (error && (error.rateLimited || error.throttled)) return;
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
        import('./pages/watchparty.js?v=119').then(m => m.initGuestSync());
    }
    // Hosts get their running party back on a second device, and a pill leading back to it
    if (isLoggedIn()) {
        import('./pages/watchparty.js?v=119').then(async m => {
            if (!localStorage.getItem('aniroll_watchparty')) await m.restoreHostParty();
            m.renderPartyPill();
        });
    }
    // The Jellyfin connection belongs to the AniList account, so pull it in on this device
    if (isLoggedIn()) {
        import('./jellyfin.js?v=119').then(async m => {
            await m.loadAccountConfig();
            setupJellyfinLive();
        });
    }
    if (isLoggedIn()) setupPendingSaveRetry();
    if (isLoggedIn()) setupJellyfinPull();
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

    check();
    setInterval(check, 60000);
}

// Jellyfin -> AniList: what you watched on your own server moves your list forward
function setupJellyfinPull() {
    const pull = async () => {
        if (api.shouldHoldBackground()) return;
        const { getConfig, isPullEnabled, pullFromJellyfin } = await import('./jellyfin.js?v=119');
        if (!getConfig() || !isPullEnabled()) return;
        const user = getState().user;
        if (!user) return;
        try {
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
    const jf = await import('./jellyfin.js?v=119');
    // Set up on another device: fetch the link once, only for people who use Jellyfin at all
    if (!jf.getHookSecret() && jf.getConfig()) await jf.loadHook().catch(() => null);
    const np = await import('./nowplaying.js?v=119');
    window.addEventListener(jf.NOW_EVENT, (e) => np.renderNowChip(document.getElementById('jf-now-chip'), e.detail));
    jf.startNowPlaying({
        onTracked: (item) => {
            if (item.status === 'saved') {
                api.clearCache('MediaListCollection');
                api.clearCache('Media(id');
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
            if (err.rateLimited || err.throttled) break;
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
        const { render, loadLandingTrending } = await import('./pages/home.js?v=119');
        const cleanup = await render(ctx);
        if (!isLoggedIn()) loadLandingTrending();
        refreshAnimations();
        return cleanup;
    });

    route('/studio/:id', async (ctx) => {
        const { render } = await import('./pages/studio.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/staff/:id', async (ctx) => {
        const { render } = await import('./pages/staff.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    // The owner's view of how busy AniRoll is (the server checks who asks)
    route('/admin', async (ctx) => {
        const { render } = await import('./pages/admin.js?v=119');
        return render(ctx);
    });

    route('/search', async (ctx) => {
        const { render } = await import('./pages/search.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/anime/:id', async (ctx) => {
        openDetailPanel(parseInt(ctx.params.id));
    });

    route('/anime/:id/full', async (ctx) => {
        const { render } = await import('./pages/detail.js?v=119');
        await render({ params: { id: ctx.params.id }, content: ctx.content });
        refreshAnimations();
    });

    // The player loads only when something is played
    route('/play/:id/:episode', async (ctx) => {
        const { render } = await import('./pages/play.js?v=119');
        return render(ctx);
    });

    route('/manga/:id', async (ctx) => {
        openDetailPanel(parseInt(ctx.params.id));
    });

    route('/manga/:id/full', async (ctx) => {
        const { render } = await import('./pages/detail.js?v=119');
        await render({ params: { id: ctx.params.id }, content: ctx.content });
        refreshAnimations();
    });

    route('/list', async (ctx) => {
        const { render } = await import('./pages/list.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/list/:username', async (ctx) => {
        const { render } = await import('./pages/list.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/social', async (ctx) => {
        const { render } = await import('./pages/social.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/profile', async (ctx) => {
        const { render } = await import('./pages/profile.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/user/:username', async (ctx) => {
        const { render } = await import('./pages/profile.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/season', async (ctx) => {
        const { render } = await import('./pages/season.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/season/:year/:season', async (ctx) => {
        const { render } = await import('./pages/season.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/roll', async (ctx) => {
        const { render } = await import('./pages/roll.js?v=119');
        const cleanup = await render(ctx);
        refreshAnimations();
        return cleanup;
    });

    route('/calendar', async (ctx) => {
        const { render } = await import('./pages/calendar.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/notifications', async (ctx) => {
        const { render } = await import('./pages/notifications.js?v=119');
        await render(ctx);
        refreshAnimations();
    });

    route('/watchparty', async (ctx) => {
        const { render } = await import('./pages/watchparty.js?v=119');
        const cleanup = await render(ctx);
        refreshAnimations();
        return cleanup;
    });

    route('/settings', async (ctx) => {
        await renderSettings(ctx);
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
            window.location.href = getLoginUrl(CLIENT_ID);
        });
    }

    userBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.hidden = !userDropdown.hidden;
        if (!userDropdown.hidden) refreshJellyfinStatus();
    });

    document.addEventListener('click', () => {
        if (userDropdown) userDropdown.hidden = true;
    });

    logoutBtn?.addEventListener('click', signOut);

    themeToggle?.addEventListener('click', () => {
        const next = cycleTheme();
        const names = { system: 'System', dark: 'Dark', light: 'Light' };
        toast(`Theme: ${names[next]}`, 'success');
    });

    notifBtn?.addEventListener('click', () => navigate('/notifications'));

    updateActiveNavLink();
    window.addEventListener('hashchange', updateActiveNavLink);
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

function updateActiveNavLink() {
    const hash = window.location.hash || '#/';
    const path = hash.replace('#', '').split('/')[1] || '';
    document.querySelectorAll('.nav-link, .mobile-tab').forEach(link => {
        const page = link.dataset.page;
        const isActive = (page === 'home' && path === '') || page === path;
        link.classList.toggle('active', isActive);
    });
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
        if (q.length < 4) {
            results.innerHTML = '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub" style="color:var(--text-secondary)">Type at least 4 characters…</div></div>';
            return;
        }

        timeout = setTimeout(async () => {
            try {
                const data = await api.searchMedia(q, null, 1, 8, getToken());
                results.innerHTML = (data.media || []).map(m => `
                    <div class="search-result-item" data-open="${m.id}" role="button" tabindex="0">
                        <img class="search-result-img" src="${m.coverImage?.large || ''}" alt="${esc(titlePref(m.title))}" loading="lazy">
                        <div class="search-result-info">
                            <div class="search-result-title">${esc(titlePref(m.title))}</div>
                            <div class="search-result-meta">${m.format || ''} · ${m.meanScore ? m.meanScore + '%' : ''}${m.episodes ? ` · ${m.episodes} Ep` : ''}${m.chapters ? ` · ${m.chapters} Ch` : ''}</div>
                        </div>
                    </div>
                `).join('') || '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">No results found</div></div>';
            } catch (err) {
                results.innerHTML = `<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
            }
        }, 300);
    });
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

const SETTINGS_TABS = [
    { key: 'appearance', label: 'Appearance' },
    { key: 'lists', label: 'Lists' },
    { key: 'party', label: 'Watch Party' },
    { key: 'jellyfin', label: 'Jellyfin' },
];

async function renderSettings({ content, query }) {
    const theme = getTheme();

    const accentColor = getAccentColor();
    const accentColors = getAccentColors();

    const loggedIn = isLoggedIn();
    const design = getDesign();
    const variant = getVariant();
    const titleLang = localStorage.getItem('aniroll_title_lang') || 'romaji';
    const choice = (attr, value, current, label) =>
        `<button class="glass-btn ${value === current ? 'glass-btn-primary' : 'glass-btn-secondary'}" data-${attr}="${value}">${label}</button>`;
    const card = (title, sub, body, extra = '') => `<section class="settings-card"${extra}>
            <h3 class="settings-card-title">${title}</h3>
            ${sub ? `<p class="dot-label settings-card-sub">${sub}</p>` : ''}
            ${body}
        </section>`;

    // Grouped into tabs (last one remembered, ?tab= links straight to one)
    const tab = SETTINGS_TABS.some(t => t.key === query?.tab) ? query.tab
        : SETTINGS_TABS.some(t => t.key === localStorage.getItem('aniroll_settings_tab')) ? localStorage.getItem('aniroll_settings_tab') : 'appearance';

    content.innerHTML = `<div class="page-enter settings-page">
        <h1 class="section-title settings-title">Settings</h1>
        <div class="list-tabs settings-tabs" role="tablist" aria-label="Settings">
            ${SETTINGS_TABS.map(t => `<button class="list-tab${t.key === tab ? ' active' : ''}" role="tab" id="settings-tab-${t.key}" aria-controls="settings-${t.key}" aria-selected="${t.key === tab}" tabindex="${t.key === tab ? 0 : -1}" data-settings-tab="${t.key}">${t.label}</button>`).join('')}
        </div>

        <div class="settings-panel" id="settings-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" ${tab === 'appearance' ? '' : 'hidden'}>
            ${loggedIn ? card('Design', 'How AniRoll looks and moves', `
                <div class="design-options" role="radiogroup" aria-label="Design">
                    <button class="design-option${design === 'aniroll' ? ' active' : ''}" role="radio" aria-checked="${design === 'aniroll'}" data-design="aniroll">
                        <span class="design-preview design-preview-aniroll" aria-hidden="true"><i></i><i></i><i></i></span>
                        <span class="design-option-name">AniRoll</span>
                        <span class="design-option-text">Monochrome, cinematic, your accent colour as a highlight</span>
                    </button>
                    <button class="design-option${design === 'm3' ? ' active' : ''}" role="radio" aria-checked="${design === 'm3'}" data-design="m3">
                        <span class="design-preview design-preview-m3" aria-hidden="true"><i></i><i></i><i></i></span>
                        <span class="design-option-name">Material 3 Expressive</span>
                        <span class="design-option-text">Google's design language as its own app: bold palettes, the Material shape library, big type, springy motion</span>
                    </button>
                </div>
                <div class="settings-sub-block" id="m3-variant" ${design === 'm3' ? '' : 'hidden'}>
                    <div class="settings-sub-label">Palette</div>
                    <p class="settings-hint">“From your show” takes its colours from the show you watched last. Or pick your own.</p>
                    <div class="m3-seeds" role="radiogroup" aria-label="Palette">${SEEDS.map(x => `<button class="m3-seed${x.hex === SHOW_SEED ? ' m3-seed-show' : ''}${x.hex === getSeed() ? ' active' : ''}" role="radio" aria-checked="${x.hex === getSeed()}" data-seed="${x.hex}" style="${x.hex === SHOW_SEED ? `--cover:url('${esc(getShowTheme()?.cover || '')}')` : `--seed:${x.hex}`}" title="${x.name}" aria-label="${x.name}"></button>`).join('')}</div>
                    ${hexField('m3-hex', getSeed() === SHOW_SEED ? '' : getSeed())}
                    <div class="settings-sub-label" style="margin-top:var(--space-md)">Colour style</div>
                    <div class="settings-choices">${VARIANTS.map(v => choice('variant', v.key, variant, v.label)).join('')}</div>
                </div>`) : ''}
            ${card('Theme', '', `<div class="settings-choices">${choice('theme', 'system', theme, 'System')}${choice('theme', 'light', theme, 'Light')}${choice('theme', 'dark', theme, 'Dark')}</div>`)}
            ${card('Accent Color', 'Personalise your interface', `
                <div class="accent-picker">
                    ${accentColors.map(c => `<button class="accent-swatch ${c.hex === accentColor ? 'active' : ''}" data-color="${c.hex}" style="background:${c.hex}" title="${c.name}" aria-label="${c.name}"></button>`).join('')}
                </div>
                ${hexField('accent-hex', accentColor)}`, ` id="accent-card"${design === 'm3' && loggedIn ? ' hidden' : ''}`)}
            ${card('Title Language', 'Choose how anime and manga titles are displayed', `
                <div class="settings-choices">${choice('titlelang', 'romaji', titleLang, 'Romaji')}${choice('titlelang', 'english', titleLang, 'English')}${choice('titlelang', 'native', titleLang, 'Native')}</div>`)}
        </div>

        <div class="settings-panel" id="settings-lists" role="tabpanel" aria-labelledby="settings-tab-lists" ${tab === 'lists' ? '' : 'hidden'}>
            ${card('Friends Status', "Show friends' progress and scores on anime/manga detail pages", `
                <label class="settings-choice"><input type="checkbox" id="toggle-friends-status" ${localStorage.getItem('aniroll_friends_status') !== 'off' ? 'checked' : ''}>
                    <span>Show friends' status in detail view</span></label>`)}
            ${card('MAL Import', 'Import your MyAnimeList export to AniList', `
                <div class="settings-choices">
                    <label class="glass-btn glass-btn-primary glass-btn-sm" style="cursor:pointer">
                        Upload MAL export (.xml / .gz)
                        <input type="file" id="mal-xml-upload" accept=".xml,.gz" hidden>
                    </label>
                    <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noopener" class="settings-link">Get it at myanimelist.net &rarr; Export</a>
                </div>
                <div id="mal-content" style="margin-top:var(--space-md)"></div>`)}
        </div>

        <div class="settings-panel" id="settings-party" role="tabpanel" aria-labelledby="settings-tab-party" ${tab === 'party' ? '' : 'hidden'}>
            ${card('Watch Party', 'How your episode counter follows the host after you join a party', '<div id="party-sync-settings"></div>')}
        </div>

        <div class="settings-panel" id="settings-jellyfin" role="tabpanel" aria-labelledby="settings-tab-jellyfin" ${tab === 'jellyfin' ? '' : 'hidden'}>
            ${card('Jellyfin', 'Plays episodes from your own Jellyfin server and keeps it in step with AniList', '<div id="jf-settings"></div><div id="jf-live"></div>')}
        </div>
    </div>`;

    // Tabs: click, arrow keys
    const tabs = [...content.querySelectorAll('[data-settings-tab]')];
    const showTab = (key, focus = false) => {
        tabs.forEach(b => {
            const on = b.dataset.settingsTab === key;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
            if (on && focus) b.focus();
        });
        content.querySelectorAll('.settings-panel').forEach(p => { p.hidden = p.id !== `settings-${key}`; });
        try { localStorage.setItem('aniroll_settings_tab', key); } catch { /* storage blocked */ }
    };
    tabs.forEach((b, i) => {
        b.addEventListener('click', () => showTab(b.dataset.settingsTab));
        b.addEventListener('keydown', (e) => {
            const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            showTab(tabs[(i + d + tabs.length) % tabs.length].dataset.settingsTab, true);
        });
    });

    content.querySelectorAll('.design-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            const d = btn.dataset.design;
            content.querySelectorAll('.design-option').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-checked', String(b === btn));
            });
            content.querySelector('#m3-variant').hidden = d !== 'm3';
            content.querySelector('#accent-card').hidden = d === 'm3';
            const r = btn.getBoundingClientRect();
            await switchDesign(d, isLoggedIn(), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            toast(d === 'm3' ? 'Material 3 Expressive on' : 'AniRoll design on', 'success');
        });
    });

    const markSeed = (hex) => content.querySelectorAll('.m3-seed').forEach(b => {
        b.classList.toggle('active', b.dataset.seed === hex);
        b.setAttribute('aria-checked', String(b.dataset.seed === hex));
    });
    content.querySelectorAll('.m3-seed').forEach(btn => {
        btn.addEventListener('click', async () => {
            markSeed(btn.dataset.seed);
            setHexField(content.querySelector('#m3-hex'), btn.dataset.seed === SHOW_SEED ? '' : btn.dataset.seed);
            await setSeed(btn.dataset.seed, isLoggedIn());
        });
    });
    // Own colour: the scheme is generated per colour, so wait until the picker settles
    let seedTimer = 0;
    bindHexField(content.querySelector('#m3-hex'), (hex) => {
        markSeed(hex);
        clearTimeout(seedTimer);
        seedTimer = setTimeout(() => setSeed(hex, isLoggedIn()), 120);
    });
    bindHexField(content.querySelector('#accent-hex'), (hex) => {
        setAccentColor(hex);
        applyDesign(isLoggedIn());
        content.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b.dataset.color.toLowerCase() === hex));
    });

    content.querySelectorAll('[data-variant]').forEach(btn => {
        btn.addEventListener('click', async () => {
            content.querySelectorAll('[data-variant]').forEach(b => {
                b.className = `glass-btn ${b === btn ? 'glass-btn-primary' : 'glass-btn-secondary'}`;
            });
            await setVariant(btn.dataset.variant, isLoggedIn());
        });
    });

    content.querySelectorAll('[data-theme]').forEach(btn => {
        btn.addEventListener('click', () => {
            const t = btn.dataset.theme;
            applyTheme(t);
            localStorage.setItem('aniroll_theme', t);
            setState({ theme: t });
            content.querySelectorAll('[data-theme]').forEach(b => {
                b.className = `glass-btn ${b.dataset.theme === t ? 'glass-btn-primary' : 'glass-btn-secondary'}`;
            });
            toast('Theme saved', 'success');
        });
    });

    content.querySelectorAll('.accent-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            const hex = btn.dataset.color;
            setAccentColor(hex);
            applyDesign(isLoggedIn());
            setHexField(content.querySelector('#accent-hex'), hex);
            content.querySelectorAll('.accent-swatch').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            toast('Accent color saved', 'success');
        });
    });

    content.querySelectorAll('[data-titlelang]').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.titlelang;
            localStorage.setItem('aniroll_title_lang', lang);
            content.querySelectorAll('[data-titlelang]').forEach(b => {
                b.className = `glass-btn ${b.dataset.titlelang === lang ? 'glass-btn-primary' : 'glass-btn-secondary'}`;
            });
            toast(`Titles set to ${btn.textContent}`, 'success');
        });
    });

    document.getElementById('toggle-friends-status')?.addEventListener('change', (e) => {
        localStorage.setItem('aniroll_friends_status', e.target.checked ? 'on' : 'off');
        toast(e.target.checked ? 'Friends status enabled' : 'Friends status disabled', 'success');
    });

    document.getElementById('mal-xml-upload')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        import('./pages/mal-import.js?v=119').then(m => m.startXMLImport(file));
    });

    renderJellyfinSettings();
    renderPartySyncSettings();
    renderJellyfinLive();
}

// ===== Watch Party sync preference =====
async function renderPartySyncSettings() {
    const box = document.getElementById('party-sync-settings');
    if (!box) return;
    if (!isLoggedIn()) {
        box.innerHTML = '<p class="dot-label">Log in to change this.</p>';
        return;
    }
    const bg = await import('./background.js?v=119');
    const mode = bg.getPartySyncMode();
    box.innerHTML = `
        <label class="settings-choice"><input type="radio" name="party-sync" value="open" ${mode === 'open' ? 'checked' : ''}>
            <span>Sync only while AniRoll is open<small>Your counter follows the host while AniRoll is on screen and catches up when you come back.</small></span></label>
        <label class="settings-choice"><input type="radio" name="party-sync" value="background" ${mode === 'background' ? 'checked' : ''}>
            <span>Keep syncing in the background and when closed<small>AniRoll updates your AniList for you until you leave the party.</small></span></label>
        <label class="settings-choice"><input type="checkbox" id="party-sync-ask" ${bg.askOnJoin() ? 'checked' : ''}>
            <span>Ask every time I join a party</span></label>
        <div class="bg-access" id="bg-access"></div>`;

    const paintAccess = async () => {
        const line = box.querySelector('#bg-access');
        if (!line) return;
        let enabled;
        try {
            enabled = await bg.getBackgroundAccess();
        } catch {
            line.innerHTML = '<span class="jf-meta">Background access could not be checked right now</span>';
            return;
        }
        line.innerHTML = enabled
            ? `<span class="jf-meta">AniRoll may update your AniList while it is closed (Watch Party and Jellyfin live tracking).</span>
               <button class="glass-btn glass-btn-secondary glass-btn-sm" id="bg-remove">Remove access</button>`
            : '<span class="jf-meta">AniRoll has no access to your AniList while it is closed.</span>';
        line.querySelector('#bg-remove')?.addEventListener('click', async () => {
            const ok = await showConfirm({
                title: 'Remove background access',
                message: 'AniRoll forgets its access to your AniList. Watch Parties then sync only while AniRoll is open, and Jellyfin episodes are saved the next time you open it.',
                confirmText: 'Remove access',
                danger: true,
            });
            if (!ok) return;
            try {
                await bg.removeBackgroundAccess();
                bg.setPartySyncMode('open');
                toast('Background access removed', 'success');
            } catch (err) {
                toast(err.message, 'error');
            }
            renderPartySyncSettings();
            renderJellyfinLive();
        });
    };

    box.querySelectorAll('input[name="party-sync"]').forEach(radio => radio.addEventListener('change', async () => {
        if (radio.value === 'open') {
            bg.setPartySyncMode('open');
            toast('Watch Parties sync only while AniRoll is open', 'success');
            return;
        }
        try {
            await bg.allowBackgroundAccess();
            bg.setPartySyncMode('background');
            toast('Watch Parties keep syncing when AniRoll is closed', 'success');
        } catch (err) {
            box.querySelector('input[value="open"]').checked = true;
            toast(`Could not turn this on: ${err.message}`, 'error');
        }
        paintAccess();
    }));
    box.querySelector('#party-sync-ask').addEventListener('change', (e) => bg.setAskOnJoin(e.target.checked));
    paintAccess();
}

// ===== Jellyfin live tracking (webhook) =====
async function renderJellyfinLive() {
    const box = document.getElementById('jf-live');
    if (!box) return;
    if (!isLoggedIn()) {
        box.innerHTML = '';
        return;
    }
    const [jf, bg, np] = await Promise.all([
        import('./jellyfin.js?v=119'), import('./background.js?v=119'), import('./nowplaying.js?v=119'),
    ]);
    const head = `<h4 class="jf-live-title">Live tracking</h4>
        <p class="dot-label">See what you are watching right in AniRoll, and finished episodes and movies land on your AniList within seconds, even when AniRoll is closed. Uses the Webhook plugin of your Jellyfin server.</p>`;

    let hook;
    try {
        hook = await jf.loadHook();
    } catch (err) {
        box.innerHTML = `<div class="jf-live">${head}<p class="jf-meta">${esc(err.message)}</p></div>`;
        return;
    }

    if (!hook.enabled) {
        box.innerHTML = `<div class="jf-live">${head}
            <button class="glass-btn glass-btn-primary glass-btn-sm" id="jf-live-setup">Set up live tracking</button>
            <p class="dot-label jf-hint">This allows AniRoll to update your AniList while it is closed. You can remove that access in the Watch Party section at any time.</p>
        </div>`;
        box.querySelector('#jf-live-setup').addEventListener('click', async (ev) => {
            ev.target.disabled = true;
            try {
                await bg.allowBackgroundAccess();
                await jf.createHook();
                jf.startNowPlaying();
                renderJellyfinLive();
                renderPartySyncSettings();
            } catch (err) {
                toast(err.message, 'error');
                ev.target.disabled = false;
            }
        });
        return;
    }

    box.innerHTML = `<div class="jf-live">${head}
        <div class="jf-row"><span class="jf-dot jf-dot-checking" id="jf-live-dot"></span><span id="jf-live-state"></span></div>
        <div class="jf-meta jf-live-now" id="jf-live-now" hidden></div>
        ${hook.background ? '' : `<div class="bg-access"><span class="jf-meta">AniRoll has no access to your AniList while it is closed, so episodes are saved the next time you open it.</span>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-live-allow">Allow</button></div>`}
        <ol class="jf-steps">
            <li>In Jellyfin open <b>Dashboard → Plugins → Catalog</b>, install <b>Webhook</b> and restart the server.</li>
            <li>Open <b>Dashboard → Plugins → Webhook</b> and click <b>Add Generic Destination</b>.</li>
            <li>Paste this as <b>Webhook Url</b>:
                <div class="jf-copy"><input class="glass-input" id="jf-live-url" value="${esc(hook.url)}" readonly><button class="glass-btn glass-btn-secondary glass-btn-sm" data-copy="jf-live-url">Copy</button></div></li>
            <li>Tick the notification types <b>Playback Start</b>, <b>Playback Progress</b> and <b>Playback Stop</b>, the item types <b>Episodes</b> and <b>Movies</b>, and select your user. Leave <b>Send All Properties</b> off.</li>
            <li>Paste this as <b>Template</b>:
                <div class="jf-copy"><textarea id="jf-live-template" readonly rows="4">${esc(hook.template)}</textarea><button class="glass-btn glass-btn-secondary glass-btn-sm" data-copy="jf-live-template">Copy</button></div></li>
            <li>Add a request header <b>Content-Type</b> with the value <b>application/json</b>, save, and play something to test.</li>
        </ol>
        <p class="dot-label jf-hint">The link works like a password for your watch activity: anyone who has it can report episodes to your account. Keep it private and create a new one if it leaks.</p>
        <div class="jf-actions">
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-live-renew">New link</button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-live-off" style="color:var(--danger)">Turn off</button>
        </div>
    </div>`;

    const paint = (state) => {
        const dot = box.querySelector('#jf-live-dot');
        const label = box.querySelector('#jf-live-state');
        const nowLine = box.querySelector('#jf-live-now');
        if (!dot || !label) return;
        const last = state?.lastEventAt || hook.lastEventAt;
        dot.className = `jf-dot ${last ? 'jf-dot-on' : 'jf-dot-checking'}`;
        label.textContent = last
            ? `Receiving events from Jellyfin · last one ${api.timeAgo(Math.floor(last / 1000))}`
            : 'Waiting for the first event from Jellyfin';
        const playing = state?.sessions?.find(s => !s.stopped);
        nowLine.hidden = !playing;
        if (playing) nowLine.textContent = `${playing.paused ? 'Paused' : 'Now watching'}: ${np.nowLabel(playing)} on ${playing.device || 'Jellyfin'}`;
    };
    paint(jf.getNowState());
    const onNow = (e) => {
        if (!document.body.contains(box)) return window.removeEventListener(jf.NOW_EVENT, onNow);
        paint(e.detail);
    };
    window.addEventListener(jf.NOW_EVENT, onNow);

    box.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
        const field = box.querySelector(`#${btn.dataset.copy}`);
        try {
            await navigator.clipboard.writeText(field.value);
            toast('Copied', 'success');
        } catch {
            field.select();
            toast('Press Ctrl+C to copy', 'info');
        }
    }));

    box.querySelector('#jf-live-allow')?.addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try {
            await bg.allowBackgroundAccess();
            toast('AniRoll now saves Jellyfin episodes while it is closed', 'success');
            renderJellyfinLive();
            renderPartySyncSettings();
        } catch (err) {
            toast(err.message, 'error');
            ev.target.disabled = false;
        }
    });

    box.querySelector('#jf-live-renew').addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Create a new link',
            message: 'The current link stops working right away. Paste the new one into the Webhook plugin afterwards.',
            confirmText: 'New link',
        });
        if (!ok) return;
        try {
            await jf.createHook();
            jf.startNowPlaying();
            toast('New link created, update it in Jellyfin', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
        renderJellyfinLive();
    });
    box.querySelector('#jf-live-off').addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Turn off live tracking',
            message: 'The link stops working and AniRoll no longer shows or saves what you watch in Jellyfin. You can remove the destination in the Webhook plugin.',
            confirmText: 'Turn off',
            danger: true,
        });
        if (!ok) return;
        try {
            await jf.removeHook();
            jf.startNowPlaying();
            toast('Live tracking turned off', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
        renderJellyfinLive();
    });
}

// ===== Jellyfin =====
async function renderJellyfinSettings() {
    const box = document.getElementById('jf-settings');
    if (!box) return;
    const jf = await import('./jellyfin.js?v=119');
    await jf.loadAccountConfig();
    const cfg = jf.getConfig();

    if (!cfg) {
        // Most people have a Jellyfin account, not an API key: Quick Connect is the usual way
        const mode = box.dataset.mode === 'key' ? 'key' : 'code';
        box.innerHTML = `
            <div class="jf-form">
                <input type="text" class="glass-input" id="jf-url" placeholder="Server URL, e.g. https://jellyfin.example.com" autocomplete="url">
                ${mode === 'key' ? `
                <input type="password" class="glass-input" id="jf-apikey" placeholder="API key (Jellyfin: Dashboard, API Keys)" autocomplete="off">
                <input type="text" class="glass-input" id="jf-user" placeholder="Jellyfin username" autocomplete="username">` : ''}
                <button class="glass-btn glass-btn-primary" id="jf-connect">${mode === 'key' ? 'Connect' : 'Get a Quick Connect code'}</button>
                <div class="jf-qc" id="jf-qc" hidden></div>
                <button type="button" class="jf-mode" id="jf-mode">${mode === 'key' ? 'Connect with a Quick Connect code instead' : 'Server admin? Use an API key instead'}</button>
            </div>
            <p class="dot-label jf-hint">${mode === 'key'
                ? 'Needs a Jellyfin this browser can reach. A plain http server on your home network cannot be used from the https page.'
                : 'You confirm the code in a Jellyfin app you are signed in to. AniRoll never sees your password.'}</p>`;

        let polling = null;
        const stopPolling = () => { clearTimeout(polling); polling = null; };
        box.querySelector('#jf-mode').addEventListener('click', () => {
            stopPolling();
            box.dataset.mode = mode === 'key' ? 'code' : 'key';
            renderJellyfinSettings();
        });
        const connected = (info) => {
            toast(`Connected to ${info.serverName}`, 'success');
            if (info.scope === 'device') toast('Stored in this browser only — could not save it for your account', 'error');
            renderJellyfinSettings();
            refreshJellyfinStatus(true);
        };
        const btn = box.querySelector('#jf-connect');

        btn.addEventListener('click', async () => {
            stopPolling();
            btn.disabled = true;
            btn.textContent = mode === 'key' ? 'Connecting...' : 'Asking Jellyfin...';
            try {
                if (mode === 'key') {
                    connected(await jf.connect(box.querySelector('#jf-url').value, box.querySelector('#jf-apikey').value, box.querySelector('#jf-user').value));
                    return;
                }
                const qc = await jf.startQuickConnect(box.querySelector('#jf-url').value);
                const panel = box.querySelector('#jf-qc');
                panel.hidden = false;
                panel.innerHTML = `
                    <div class="jf-qc-code" aria-label="Quick Connect code">${esc(qc.code)}</div>
                    <p class="jf-qc-how">In a Jellyfin app where you are signed in: your profile, <strong>Quick Connect</strong>, enter this code.</p>
                    <p class="jf-qc-wait" role="status"><span class="jf-dot jf-dot-checking"></span> Waiting for Jellyfin...</p>`;
                btn.disabled = false;
                btn.textContent = 'New code';
                const started = Date.now();
                const poll = async () => {
                    if (!box.isConnected || !panel.isConnected) return stopPolling();
                    try {
                        if (await jf.quickConnectApproved(qc.url, qc.secret)) {
                            stopPolling();
                            connected(await jf.finishQuickConnect(qc.url, qc.secret));
                            return;
                        }
                    } catch (err) {
                        stopPolling();
                        panel.querySelector('.jf-qc-wait').textContent = err.message;
                        return;
                    }
                    // Jellyfin keeps a code for a few minutes; stop asking before that
                    if (Date.now() - started > 5 * 60 * 1000) {
                        panel.querySelector('.jf-qc-wait').textContent = 'The code expired — get a new one';
                        return stopPolling();
                    }
                    polling = setTimeout(poll, 2500);
                };
                polling = setTimeout(poll, 2500);
            } catch (err) {
                toast(err.message, 'error');
                btn.disabled = false;
                btn.textContent = mode === 'key' ? 'Connect' : 'Get a Quick Connect code';
            }
        });
        return;
    }

    const scope = jf.getScope();
    const player = await import('./player/availability.js?v=119');
    const localUrl = player.getLocalUrl();
    box.innerHTML = `
        <div class="jf-row"><span class="jf-dot jf-dot-checking" id="jf-settings-dot"></span><span id="jf-settings-state">Checking...</span></div>
        <div class="jf-meta">${esc(cfg.serverName)} · ${esc(cfg.url)}${cfg.userName ? ` · ${esc(cfg.userName)}` : ''}</div>
        <div class="jf-meta">${scope === 'account'
            ? 'Saved for your AniList account, so it works on all your devices'
            : 'Saved in this browser only — the copy for your account could not be written'}</div>
        <label class="roll-check jf-pull-toggle"><input type="checkbox" id="jf-pull" ${jf.isPullEnabled() ? 'checked' : ''}> Also take watched episodes from Jellyfin into AniList</label>
        <div class="jf-local">
            <label class="jf-local-label" for="jf-local">Local address on this device (optional)</label>
            <div class="jf-local-row">
                <input type="text" class="glass-input" id="jf-local" placeholder="e.g. http://localhost:8096" value="${esc(localUrl)}" autocomplete="off">
                <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-local-save">Save</button>
            </div>
            <p class="dot-label jf-hint">The player tries it first — at home it skips the detour through the internet and plays big files at full quality.</p>
        </div>
        <div class="jf-actions">
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-pull-now">Sync from Jellyfin</button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-recheck">Test again</button>
            ${scope === 'device' ? '<button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-to-account">Save to account</button>' : ''}
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-disconnect" style="color:var(--danger)">Disconnect</button>
        </div>`;

    const paint = (status) => {
        const dot = box.querySelector('#jf-settings-dot');
        const label = box.querySelector('#jf-settings-state');
        if (!dot || !label) return;
        dot.className = `jf-dot jf-dot-${status.state === 'connected' ? 'on' : 'off'}`;
        label.textContent = status.state === 'connected'
            ? `Connected${status.version ? ` · Jellyfin ${status.version}` : ''}`
            : `Not connected · ${status.error}`;
    };
    paint(await jf.getStatus(true));

    box.querySelector('#jf-local-save').addEventListener('click', async (ev) => {
        const btn = ev.target;
        const url = player.setLocalUrl(box.querySelector('#jf-local').value);
        box.querySelector('#jf-local').value = url;
        if (!url) return toast('Local address removed', 'success');
        btn.disabled = true;
        const avail = await player.availability(true);
        btn.disabled = false;
        toast(avail?.local ? 'Local address works — the player uses it on this device' : 'Saved, but it does not answer right now — the player uses the public address', avail?.local ? 'success' : 'error');
    });

    box.querySelector('#jf-recheck').addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        paint(await jf.getStatus(true));
        refreshJellyfinStatus(true);
        ev.target.disabled = false;
    });

    box.querySelector('#jf-pull')?.addEventListener('change', (ev) => {
        jf.setPullEnabled(ev.target.checked);
        toast(ev.target.checked ? 'Jellyfin progress will be pulled in' : 'Pulling from Jellyfin switched off', 'success');
    });

    box.querySelector('#jf-pull-now')?.addEventListener('click', async (ev) => {
        const btn = ev.target;
        btn.disabled = true;
        btn.textContent = 'Checking Jellyfin...';
        try {
            const res = await jf.pullFromJellyfin(getState().user, getToken());
            if (res.skipped === 'rate-limited') toast('AniList is rate limiting right now, try again later', 'error');
            else if (!res.updated) toast('Nothing to pull — AniList is already up to date', 'success');
            else {
                for (const c of res.changes) toast(`${c.title}: episode ${c.from} to ${c.to}`, 'success');
            }
        } catch (err) {
            toast(err.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Sync from Jellyfin';
    });

    box.querySelector('#jf-to-account')?.addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        const ok = await jf.saveToAccount();
        toast(ok ? 'Saved for your AniList account' : 'Could not store it for your account, still this browser only', ok ? 'success' : 'error');
        renderJellyfinSettings();
    });

    box.querySelector('#jf-disconnect').addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Disconnect Jellyfin',
            message: cfg.kind === 'user'
                ? 'AniRoll stops marking episodes watched and signs out of Jellyfin.'
                : 'AniRoll stops marking episodes watched, and the API key is removed from this browser.',
            confirmText: 'Disconnect',
            danger: true
        });
        if (!ok) return;
        await jf.clearConfig();
        toast('Jellyfin disconnected', 'success');
        renderJellyfinSettings();
        refreshJellyfinStatus(true);
    });
}

// Connection status in the avatar menu
function refreshPendingStatus() {
    const item = document.getElementById('pending-status-item');
    if (!item) return;
    const n = api.pendingSaveCount();
    item.hidden = n === 0;
    if (!n) return;
    const text = document.getElementById('pending-status-text');
    const dot = document.getElementById('pending-status-dot');
    if (dot) dot.className = `jf-dot ${api.isRateLimited() ? 'jf-dot-checking' : 'jf-dot-off'}`;
    if (text) {
        text.textContent = api.isRateLimited()
            ? `${n} change${n > 1 ? 's' : ''} waiting · AniList paused`
            : `${n} change${n > 1 ? 's' : ''} waiting · retrying a few at a time`;
    }
}

async function refreshJellyfinStatus(force = false) {
    refreshPendingStatus();
    const item = document.getElementById('jf-status-item');
    if (!item) return;
    const { getConfig, getStatus } = await import('./jellyfin.js?v=119');
    if (!getConfig()) {
        item.hidden = true;
        return;
    }
    item.hidden = false;
    const dot = document.getElementById('jf-status-dot');
    const text = document.getElementById('jf-status-text');
    dot.className = 'jf-dot jf-dot-checking';
    text.textContent = 'Jellyfin · checking...';
    const status = await getStatus(force);
    dot.className = `jf-dot jf-dot-${status.state === 'connected' ? 'on' : 'off'}`;
    text.textContent = status.state === 'connected'
        ? `Jellyfin · ${status.serverName}`
        : `Jellyfin · ${status.error || 'not connected'}`;
}

function setupSlidePanel() {
    const overlay = document.getElementById('detail-panel-overlay');
    const closeBtn = document.getElementById('detail-panel-close-btn');
    const fullscreenBtn = document.getElementById('detail-panel-fullscreen-btn');
    const backdrop = overlay?.querySelector('.detail-panel-backdrop');

    function close() {
        overlay?.classList.remove('open');
        overlay?.setAttribute('inert', '');
        releasePanel?.();
        releasePanel = null;
        startLenis();
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
            close();
            window.location.hash = `/${type}/${id}/full`;
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

    const { renderPanel } = await import('./pages/detail.js?v=119');
    await renderPanel(id, body);
    overlay.dataset.mediaType = body.querySelector('.detail-fullscreen-btn')?.dataset.type || 'anime';
}

init();

// ===== Colour by hex code: a swatch that opens the system colour picker, and the code to type =====
function hexField(id, value) {
    const v = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '';
    return `<div class="hex-field">
        <label class="hex-swatch" style="--c:${v || 'transparent'}" title="Pick a colour">
            <input type="color" value="${v || '#6750a4'}" aria-label="Pick a colour">
        </label>
        <input type="text" class="glass-input hex-input" id="${id}" value="${v}" placeholder="#rrggbb" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Colour as hex code">
    </div>`;
}

function setHexField(input, hex) {
    if (!input) return;
    const v = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : '';
    input.value = v;
    input.classList.remove('invalid');
    const field = input.closest('.hex-field');
    field.querySelector('.hex-swatch').style.setProperty('--c', v || 'transparent');
    if (v) field.querySelector('input[type="color"]').value = v;
}

// "a1b", "#A1B2C3", "a1b2c3" all work; calls onPick with "#a1b2c3" once it is a colour
function bindHexField(input, onPick) {
    if (!input) return;
    const field = input.closest('.hex-field');
    const picker = field.querySelector('input[type="color"]');
    const parse = (text) => {
        let t = text.trim().replace(/^#/, '').toLowerCase();
        if (/^[0-9a-f]{3}$/.test(t)) t = t.split('').map(c => c + c).join('');
        return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
    };
    input.addEventListener('input', () => {
        const hex = parse(input.value);
        input.classList.toggle('invalid', !!input.value.trim() && !hex);
        if (!hex) return;
        field.querySelector('.hex-swatch').style.setProperty('--c', hex);
        picker.value = hex;
        onPick(hex);
    });
    input.addEventListener('blur', () => { const hex = parse(input.value); if (hex) input.value = hex; });
    picker.addEventListener('input', () => {
        setHexField(input, picker.value);
        onPick(picker.value.toLowerCase());
    });
}
