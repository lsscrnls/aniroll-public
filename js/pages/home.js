import * as api from '../api.js?v=113';
import { getState, renderMediaCard, renderSkeletonCards, esc, titlePref, toast, LIST_EVENT, emitListChange, emitWatched, GITHUB_URL, GITHUB_ICON } from '../store.js?v=113';
import { openDialog } from '../a11y.js?v=113';
import { isLoggedIn, getToken } from '../auth.js?v=113';
import { getActiveParty, startParty, openPartyPicker } from './watchparty.js?v=113';
import { lenisScrollTo, stopLenis, startLenis } from '../animations.js?v=113';
import { renderHeadline, renderStage, renderTour, renderDesigns, initLanding } from '../landing.js?v=113';
import { renderCinema, stop as stopCinema } from '../home-cinema.js?v=113';

export async function render({ content }) {
    if (!isLoggedIn()) {
        content.innerHTML = renderLanding();
        initFeatureCards();
        return initLanding(content);
    }

    const token = getToken();
    content.innerHTML = `<div class="page-enter">
        <section class="ar-home" id="ar-home" aria-label="Up next" hidden></section>
        <section class="home-section jf-now-section" id="jf-now-section" hidden></section>
        <section class="home-section">
            <div class="section-header">
                <h2 class="section-title">Continue Watching</h2>
                <a href="#/list" class="section-link">View All</a>
            </div>
            <div id="continue-watching" class="scroll-row">${renderSkeletonCards(6)}</div>
        </section>
        <section class="home-section starting-soon" id="starting-soon" hidden>
            <div class="section-header">
                <h2 class="section-title">Starting soon</h2>
                <a href="#/list" class="section-link">Planning</a>
            </div>
            <div id="starting-soon-row" class="scroll-row"></div>
        </section>
        <section class="home-section home-popular-friends" style="margin-top:var(--space-xl)">
            <div class="section-header">
                <div class="friends-head">
                    <h2 class="section-title">Friends</h2>
                    <div class="friends-tabs" role="tablist">
                        <button class="friends-tab${getFriendsTab() === 'now' ? ' active' : ''}" data-tab="now" role="tab">Right now</button>
                        <button class="friends-tab${getFriendsTab() === 'popular' ? ' active' : ''}" data-tab="popular" role="tab">Popular this week</button>
                    </div>
                </div>
                <div class="friends-head-actions">
                    <a href="#/social" class="section-link">View All</a>
                    <button id="popular-friends-toggle" class="section-toggle" aria-label="Toggle section">
                        <svg data-icon="keyboard_arrow_down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                </div>
            </div>
            <div id="popular-friends-row" class="scroll-row">${renderSkeletonCards(6)}</div>
            <a href="#/social" class="friends-posts-link" id="friends-posts-link" hidden></a>
        </section>
        <section class="home-section" style="margin-top:var(--space-xl)">
            <div class="section-header">
                <h2 class="section-title">Recommended for You</h2>
            </div>
            <div id="recommendations-row" class="scroll-row">${renderSkeletonCards(6)}</div>
        </section>
    </div>`;

    loadContinueWatching(token);
    loadFriendAndPopular(token);
    loadRecommendations(token);
    initPopularToggle();
    initFriendsTabs();
    initFriendsRowActions(token);

    const removeFab = addWatchPartyFab();
    const stopNow = mountNowPlaying();
    return () => {
        removeFab();
        stopNow();
        stopCinema();
        clearTimeout(friendsRetryTimer);
        window.removeEventListener(LIST_EVENT, continueListHandler);
    };
}

// Live "now watching" card from the Jellyfin webhook — only once live tracking is set up
function mountNowPlaying() {
    if (!localStorage.getItem('aniroll_jf_hook')) return () => {};
    let render = null;
    const onNow = (e) => render?.(e.detail);
    window.addEventListener('aniroll:jf-now', onNow);
    Promise.all([import('../nowplaying.js?v=113'), import('../jellyfin.js?v=113')]).then(([np, jf]) => {
        render = (state) => np.renderNowCard(document.getElementById('jf-now-section'), state);
        render(jf.getNowState());
    });
    return () => window.removeEventListener('aniroll:jf-now', onNow);
}

function addWatchPartyFab() {
    const existing = document.querySelector('.wp-fab');
    if (existing) existing.remove();

    const fab = document.createElement('button');
    fab.className = 'wp-fab';
    fab.innerHTML = `
        <svg data-icon="live_tv" class="wp-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>
        </svg>
        <span class="wp-fab-label">Watch Party</span>`;
    fab.addEventListener('click', () => {
        const active = getActiveParty();
        if (active) {
            window.location.hash = '#/watchparty';
        } else {
            showAnimePickerForParty();
        }
    });
    document.body.appendChild(fab);

    return () => {
        fab.remove();
        const picker = document.getElementById('wp-anime-picker');
        if (picker) { picker.remove(); startLenis(); }
    };
}

function showAnimePickerForParty() {
    const user = getState().user;
    if (!user) return;
    openPartyPicker({
        title: 'Start a Watch Party',
        sub: 'Pick an anime to watch with friends',
        onPick: async (pick) => {
            await startParty(pick.mediaId, pick.title, user.name, pick.progress, pick.cover);
            window.location.hash = '#/watchparty';
        },
    });
}

function continueSub(e) {
    const m = e.media;
    const progress = m.episodes ? `${e.progress}/${m.episodes}` : `${e.progress}`;
    const airing = m.nextAiringEpisode
        ? `Ep ${m.nextAiringEpisode.episode} in ${api.timeUntil(api.untilAiring(m.nextAiringEpisode))}`
        : '';
    return `${progress} Ep${airing ? ` · ${airing}` : ''}`;
}

function continuePct(e) {
    return e.media.episodes ? Math.min(100, e.progress / e.media.episodes * 100) : 0;
}

const CONTINUE_STATUSES = ['CURRENT', 'REPEATING'];
const CONTINUE_EMPTY = '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">Nothing currently watching</div></div>';
let continueListHandler = null;

// Fade + collapse a card out of the Continue Watching row
function removeContinueCard(row, card) {
    let finished = false;
    const done = () => {
        if (finished) return;
        finished = true;
        card.remove();
        if (!row.querySelector('.media-card')) row.innerHTML = CONTINUE_EMPTY;
    };
    if (typeof gsap === 'undefined') return done();
    gsap.timeline({ onComplete: done })
        .to(card, { opacity: 0, scale: 0.85, duration: 0.25, ease: 'power2.in' })
        .to(card, { flexBasis: 0, width: 0, duration: 0.3, ease: 'power2.inOut' });
    // Throttled/background tabs can stall the animation — the card must still leave
    setTimeout(done, 700);
}

const ICON_EVENT = '<svg data-icon="event" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';

// Shows on the Planning list that haven't started yet but have a date: the next premieres, soonest first
function renderStartingSoon(planning) {
    const section = document.getElementById('starting-soon');
    const row = document.getElementById('starting-soon-row');
    if (!section || !row) return;
    const now = Date.now() / 1000;
    const soon = planning
        .filter(e => e.media.status === 'NOT_YET_RELEASED' && e.media.nextAiringEpisode?.airingAt > now)
        .sort((a, b) => a.media.nextAiringEpisode.airingAt - b.media.nextAiringEpisode.airingAt)
        .slice(0, 12);
    section.hidden = !soon.length;
    row.innerHTML = soon.map(e => {
        const m = e.media;
        const next = m.nextAiringEpisode;
        return `<div class="media-card starting-soon-card" style="flex:0 0 150px" data-media-id="${m.id}" data-open="${m.id}" role="button" tabindex="0">
            <img class="media-card-img" src="${esc(m.coverImage?.large || '')}" alt="${esc(titlePref(m.title))}" loading="lazy">
            <div class="media-card-overlay">
                <div class="media-card-title">${esc(titlePref(m.title))}</div>
                <div class="media-card-sub starting-soon-when">${ICON_EVENT}<span><strong>Episode ${next.episode}</strong> in ${api.timeUntil(api.untilAiring(next))}</span></div>
            </div>
        </div>`;
    }).join('');
}

async function loadContinueWatching(token) {
    try {
        const user = getState().user;
        if (!user) return;
        const lists = await api.getMediaList(user.id, 'ANIME', token);
        renderStartingSoon(lists.find(l => l.status === 'PLANNING')?.entries || []);
        const current = lists.find(l => l.status === 'CURRENT');
        const entries = (current?.entries || [])
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 20);

        const el = document.getElementById('continue-watching');
        if (!el) return;

        // For the M3 design's hero (js/m3.js); kept on window in case that module loads later
        window.__anirollContinue = { entries, name: user.name };
        document.dispatchEvent(new CustomEvent('aniroll:continue-watching', { detail: window.__anirollContinue }));

        // AniRoll's own hero and data strip (js/home-cinema.js). "Watched episode N" goes through the card's
        // own +1, so saving and the row stay one code path; the hero follows a moment later
        const cinema = document.getElementById('ar-home');
        renderCinema(cinema, entries, user.name);
        cinema?.addEventListener('click', (ev) => {
            const inc = ev.target.closest('[data-ar-inc]');
            if (!inc) return;
            el.querySelector(`.cw-inc[data-entry-id="${inc.dataset.arInc}"]`)?.click();
            setTimeout(() => renderCinema(cinema, entries, user.name), 60);
        });

        if (entries.length === 0) {
            el.innerHTML = CONTINUE_EMPTY;
            return;
        }

        // The first show is Home's hero in both designs, so the row starts with the second. Its card stays in
        // the row, hidden: the hero's "Watched episode N" clicks that card's +1. Only the hero? Then no row.
        el.closest('section').hidden = entries.length === 1;
        el.innerHTML = entries.map((e, i) => {
            const m = e.media;
            return `
                <div class="media-card" style="flex:0 0 150px" data-media-id="${m.id}" data-open="${m.id}" role="button" tabindex="0"${i ? '' : ' hidden'}>
                    <img class="media-card-img" src="${m.coverImage?.large || ''}" alt="${esc(titlePref(m.title))}" loading="lazy">
                    ${!m.episodes || e.progress < m.episodes ? `<button class="cw-inc" data-entry-id="${e.id}" title="Mark next episode watched">+1</button>` : ''}
                    <div class="media-card-overlay">
                        <div class="media-card-title">${esc(titlePref(m.title))}</div>
                        <div class="media-card-sub">${continueSub(e)}</div>
                    </div>
                    <div class="progress-bar" style="position:absolute;bottom:0;left:0;right:0;border-radius:0">
                        <div class="progress-bar-fill" style="width:${continuePct(e)}%"></div>
                    </div>
                </div>`;
        }).join('');

        // "+1" on the card: capture phase so the card's own onclick (open detail) never fires
        const byId = new Map(entries.map(e => [e.id, e]));
        const chains = new Map();
        el.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.cw-inc');
            if (!btn) return;
            ev.stopPropagation();
            const entry = byId.get(Number(btn.dataset.entryId));
            const max = entry?.media.episodes;
            if (!entry || (max && entry.progress >= max)) return;

            entry.progress++;
            emitWatched(entry.media);
            const card = btn.closest('.media-card');
            card.querySelector('.media-card-sub').textContent = continueSub(entry);
            card.querySelector('.progress-bar-fill').style.width = `${continuePct(entry)}%`;
            if (max && entry.progress >= max) btn.remove();

            // Serialize per entry so rapid clicks can't land out of order on AniList
            const target = entry.progress;
            chains.set(entry.id, (chains.get(entry.id) || Promise.resolve()).then(async () => {
                if (target !== entry.progress) return; // a newer click will save
                const vars = api.progressVars(entry, target, max);
                try {
                    const saved = await api.saveMediaListEntry(vars, token);
                    Object.assign(entry, { status: saved.status, startedAt: saved.startedAt, completedAt: saved.completedAt, repeat: saved.repeat });
                    if (vars.status === 'COMPLETED') toast(`Completed ${titlePref(entry.media.title)}`, 'success');
                    if (!CONTINUE_STATUSES.includes(saved.status)) removeContinueCard(el, card);
                } catch (err) { toast(err.message, 'error'); }
            }));
        }, true);

        // Follow changes made elsewhere (detail panel): leave the row when no longer watching, else update progress
        window.removeEventListener(LIST_EVENT, continueListHandler);
        continueListHandler = (ev) => {
            const { mediaId, status, progress, removed } = ev.detail || {};
            const card = el.querySelector(`.media-card[data-media-id="${mediaId}"]`);
            const entry = entries.find(x => x.media.id === mediaId);
            if (!card || !entry) return;
            if (removed || (status && !CONTINUE_STATUSES.includes(status))) {
                removeContinueCard(el, card);
                return;
            }
            if (progress != null) {
                entry.progress = progress;
                card.querySelector('.media-card-sub').textContent = continueSub(entry);
                card.querySelector('.progress-bar-fill').style.width = `${continuePct(entry)}%`;
                const max = entry.media.episodes;
                if (max && progress >= max) card.querySelector('.cw-inc')?.remove();
            }
        };
        window.addEventListener(LIST_EVENT, continueListHandler);
    } catch (err) {
        console.error('Continue watching error:', err);
    }
}

// ===== Friends: "Right now" + "Popular this week" (one feed, grouped per show) =====
const FRIENDS_TAB_KEY = 'aniroll_friends_tab';
const DAY = 86400;
let friendsData = null;

// Inline stroke icons in the style of the Watch Party FAB / Compare button — no emoji
const FR_ICONS = {
    play: '<svg data-icon="play_arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    check: '<svg data-icon="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    bookmark: '<svg data-icon="bookmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v16l-6-4-6 4z"/></svg>',
    pause: '<svg data-icon="pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
    drop: '<svg data-icon="close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    repeat: '<svg data-icon="repeat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 014-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 01-4 4H4"/></svg>',
    plus: '<svg data-icon="add" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    people: '<svg data-icon="group" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><circle cx="17" cy="9" r="2.5"/><path d="M21.5 19c0-2.5-2-4.5-4.5-4.5"/></svg>',
    chat: '<svg data-icon="chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1.1-4.6A8 8 0 1121 12z"/></svg>',
    arrow: '<svg data-icon="arrow_forward" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>',
};

// ListActivity.status is free text: "watched episode", "read chapter", "completed", "plans to watch", "rewatched episode", …
function activityKind(status = '') {
    const s = status.toLowerCase();
    if (s.includes('completed')) return 'completed';
    if (s.includes('plans')) return 'planning';
    if (s.includes('paused')) return 'paused';
    if (s.includes('dropped')) return 'dropped';
    if (/^re(watched|read)/.test(s)) return 'repeating';
    return 'watching';
}

const KIND_ICON = { watching: FR_ICONS.play, repeating: FR_ICONS.repeat, completed: FR_ICONS.check, planning: FR_ICONS.bookmark, paused: FR_ICONS.pause, dropped: FR_ICONS.drop };

function activityLabel(a) {
    const kind = activityKind(a.status);
    const manga = a.media?.type === 'MANGA';
    const unit = manga ? 'Ch' : 'Ep';
    const prog = a.progress ? `${unit} ${String(a.progress).replace(/\s*-\s*/, '–')}` : '';
    const text = {
        watching: prog || (manga ? 'Reading' : 'Watching'),
        repeating: prog ? `${manga ? 'Reread' : 'Rewatch'} ${prog}` : (manga ? 'Rereading' : 'Rewatching'),
        completed: 'Completed',
        planning: 'Planned',
        paused: 'Paused',
        dropped: 'Dropped',
    }[kind];
    return { kind, text };
}

// Feed is newest-first → one group per show, each friend with their newest activity
function groupByMedia(activities) {
    const map = new Map();
    for (const a of activities) {
        const m = a.media;
        if (!m?.id || !a.user?.id) continue;
        let g = map.get(m.id);
        if (!g) {
            g = { media: m, latest: a, friends: new Map() };
            map.set(m.id, g);
        }
        if (!g.friends.has(a.user.id)) g.friends.set(a.user.id, { user: a.user, activity: a });
    }
    return [...map.values()].map(g => ({ ...g, friends: [...g.friends.values()] }));
}

function renderFriendCard(g, tab) {
    const m = g.media;
    const lead = g.friends[0];
    const { kind, text } = activityLabel(lead.activity);
    const others = g.friends.length - 1;
    const entry = m.mediaListEntry;
    const unit = m.type === 'MANGA' ? 'Ch' : 'Ep';
    const mine = entry
        ? `<div class="fr-mine">${entry.status === 'PLANNING' ? 'On your list' : `You · ${unit} ${entry.progress || 0}`}</div>`
        : `<button class="fr-plan" data-media-id="${m.id}" title="Add to your Planning list">${FR_ICONS.plus}<span>Plan</span></button>`;
    const avatars = g.friends.slice(0, 4).map(f =>
        `<img class="fr-avatar fr-${activityKind(f.activity.status)}" src="${esc(f.user.avatar?.medium || '')}" alt="${esc(f.user.name)}" title="${esc(f.user.name)} · ${esc(activityLabel(f.activity).text)}" loading="lazy">`).join('');
    const line = tab === 'popular'
        ? `<span class="fr-line-icon">${FR_ICONS.people}</span><span class="fr-line-text">${g.friends.length} friend${g.friends.length > 1 ? 's' : ''}</span>`
        : `<span class="fr-line-icon fr-${kind}">${KIND_ICON[kind]}</span><span class="fr-line-text"><strong>${esc(lead.user.name)}</strong>${others ? ` +${others}` : ''} · ${esc(text)}</span>`;

    return `<div class="media-card fr-card" style="flex:0 0 150px" data-media-id="${m.id}" data-open="${m.id}" role="button" tabindex="0">
        <img class="media-card-img" src="${m.coverImage?.large || ''}" alt="${esc(titlePref(m.title))}" loading="lazy">
        ${mine}
        <div class="media-card-overlay">
            <div class="fr-avatars">${avatars}</div>
            <div class="media-card-title">${esc(titlePref(m.title))}</div>
            <div class="fr-line">${line}</div>
            <div class="fr-time">${api.timeAgo(g.latest.createdAt)}</div>
        </div>
    </div>`;
}

function getFriendsTab() {
    try { return localStorage.getItem(FRIENDS_TAB_KEY) === 'popular' ? 'popular' : 'now'; } catch { return 'now'; }
}

function renderFriendsTab(tab, animate = true) {
    const row = document.getElementById('popular-friends-row');
    if (!row || !friendsData) return;
    document.querySelectorAll('.friends-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });

    const groups = friendsData[tab];
    const html = groups.length
        ? groups.map(g => renderFriendCard(g, tab)).join('')
        : `<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">${tab === 'now' ? 'No friend activity lately' : 'Nothing popular among your friends this week'}</div></div>`;

    const collapsed = document.getElementById('popular-friends-toggle')?.classList.contains('collapsed');
    const canAnimate = animate && !collapsed && typeof gsap !== 'undefined' && row.children.length;
    if (!canAnimate) {
        row.innerHTML = html;
        row.scrollLeft = 0;
        // Keep the collapsed state's hidden cards consistent with initPopularToggle
        if (collapsed && typeof gsap !== 'undefined') gsap.set(row.children, { opacity: 0, y: 40, scale: 0.85 });
        return;
    }

    let swapped = false;
    const swap = () => {
        if (swapped) return;
        swapped = true;
        row.innerHTML = html;
        row.scrollLeft = 0;
        gsap.from(row.children, { opacity: 0, y: 12, duration: 0.35, stagger: 0.03, ease: 'power3.out' });
    };
    gsap.to(row.children, { opacity: 0, y: 8, duration: 0.15, stagger: 0.01, onComplete: swap });
    setTimeout(swap, 400); // throttled tabs can stall the fade — content must still switch
}

function initFriendsTabs() {
    document.querySelectorAll('.friends-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (btn.classList.contains('active')) return;
            try { localStorage.setItem(FRIENDS_TAB_KEY, tab); } catch { /* storage blocked */ }
            renderFriendsTab(tab);
        });
    });
}

// "+ Plan" on a friend card — capture phase so the card's own onclick (open detail) never fires
function initFriendsRowActions(token) {
    const row = document.getElementById('popular-friends-row');
    row?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('.fr-plan');
        if (!btn) return;
        ev.stopPropagation();
        btn.disabled = true;
        const mediaId = Number(btn.dataset.mediaId);
        try {
            const saved = await api.saveMediaListEntry({ mediaId, status: 'PLANNING' }, token);
            for (const g of [...(friendsData?.now || []), ...(friendsData?.popular || [])]) {
                if (g.media.id === mediaId) g.media.mediaListEntry = { status: saved.status, progress: saved.progress };
            }
            btn.outerHTML = '<div class="fr-mine">On your list</div>';
            toast('Added to Planning', 'success');
            emitListChange({ mediaId, status: saved.status, progress: saved.progress });
        } catch (err) {
            btn.disabled = false;
            toast(err.message, 'error');
        }
    }, true);
}

let friendsRetryTimer = null;

// A failed feed request used to hide the whole section, which looked like the feature was gone.
// Now it stays with a reason and a retry; after a rate-limit pause it retries once by itself.
function renderFriendsError(row, err, token) {
    const limited = !!err?.rateLimited;
    const wait = api.rateLimitWaitMs();
    const reason = limited
        ? `AniList is rate limiting — friend activity loads again in ${Math.max(1, Math.ceil(wait / 60000))} min`
        : err?.throttled ? 'AniRoll is holding back requests for a moment' : "Couldn't load friend activity";
    row.innerHTML = `<div class="empty-state" style="padding:var(--space-lg)">
        <div class="empty-state-sub">${reason}</div>
        <button class="glass-btn glass-btn-secondary glass-btn-sm" id="friends-retry" style="margin-top:var(--space-sm)">Try again</button>
    </div>`;
    row.querySelector('#friends-retry').addEventListener('click', () => {
        row.innerHTML = renderSkeletonCards(6);
        loadFriendAndPopular(token);
    });
    if (!limited && !err?.throttled) api.reportIssue(`Friends feed failed: ${err?.message || err}`);
    clearTimeout(friendsRetryTimer);
    if (limited && wait) {
        friendsRetryTimer = setTimeout(() => {
            if (document.getElementById('popular-friends-row') === row) loadFriendAndPopular(token);
        }, wait + 2000);
    }
}

async function loadFriendAndPopular(token) {
    const row = document.getElementById('popular-friends-row');
    if (!row) return;
    clearTimeout(friendsRetryTimer);
    let feed;
    try {
        // One page (25 activities) is enough for both tabs — a second page doubled the cost
        feed = await api.getActivityFeed(1, true, token);
    } catch (err) {
        console.warn('Friends feed failed:', err.message);
        return renderFriendsError(row, err, token);
    }
    try {
        const userId = getState().user?.id;
        const pages = [feed];
        const seen = new Set();
        const acts = pages.flatMap(p => p?.activities || [])
            .filter(a => a && a.type !== 'MESSAGE' && a.user?.id !== userId && !seen.has(a.id) && seen.add(a.id));

        const now = Date.now() / 1000;
        const listActs = acts.filter(a => a.media);
        let recent = listActs.filter(a => now - a.createdAt < 3 * DAY);
        if (!recent.length) recent = listActs; // quiet friends: show the latest instead of nothing

        friendsData = {
            now: groupByMedia(recent).slice(0, 15),
            popular: groupByMedia(listActs.filter(a => now - a.createdAt < 7 * DAY))
                .sort((a, b) => b.friends.length - a.friends.length || b.latest.createdAt - a.latest.createdAt)
                .slice(0, 15),
        };
        // Empty tabs render their own "nothing yet" note — the section never disappears
        renderFriendsTab(getFriendsTab(), false);

        // Text posts don't fit a cover row — point to Social instead
        const posts = acts.filter(a => a.type === 'TEXT' && now - a.createdAt < 3 * DAY).length;
        const link = document.getElementById('friends-posts-link');
        if (link && posts) {
            link.innerHTML = `${FR_ICONS.chat}<span>${posts} new post${posts > 1 ? 's' : ''} from friends</span>${FR_ICONS.arrow}`;
            link.hidden = false;
        }
    } catch (err) {
        console.error('Friends section error:', err);
        renderFriendsError(row, err, token);
    }
}

async function loadRecommendations(token) {
    try {
        const user = getState().user;
        if (!user) return;
        const recs = await api.getRecommendations(user.id, token);
        const el = document.getElementById('recommendations-row');
        if (!el) return;

        if (!recs.length) {
            el.innerHTML = '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">Watch more anime to get recommendations</div></div>';
            return;
        }

        el.innerHTML = recs.map(r => `<div style="flex:0 0 150px">${renderMediaCard(r.media, false, r)}</div>`).join('');
    } catch (err) {
        console.error('Recommendations error:', err);
        const el = document.getElementById('recommendations-row');
        if (el) el.innerHTML = '';
    }
}

function initPopularToggle() {
    const btn = document.getElementById('popular-friends-toggle');
    const row = document.getElementById('popular-friends-row');
    if (!btn || !row) return;

    let isAnimating = false;
    const spring = 'elastic.out(1, 0.5)';

    const stored = localStorage.getItem('popularFriendsCollapsed');
    if (stored === 'true') {
        gsap.set(row, { height: 0, overflow: 'hidden' });
        gsap.set(row.children, { opacity: 0, y: 40, scale: 0.85 });
        gsap.set(btn.querySelector('svg'), { rotation: -90 });
        btn.classList.add('collapsed');
    }

    btn.addEventListener('click', () => {
        if (isAnimating) return;
        isAnimating = true;
        const isCollapsed = btn.classList.contains('collapsed');
        const cards = row.children;

        if (isCollapsed) {
            const section = row.closest('.home-section');
            gsap.set(row, { height: 'auto', overflow: 'hidden' });
            const fullH = row.scrollHeight;
            gsap.set(row, { height: 0 });

            let prevH = 0;
            const needsScroll = () => section.getBoundingClientRect().bottom > window.innerHeight - 40;

            const tl = gsap.timeline({
                onComplete: () => {
                    gsap.set(row, { clearProps: 'height,overflow' });
                    isAnimating = false;
                }
            });

            tl.to(btn.querySelector('svg'), {
                rotation: 0, duration: 0.6, ease: spring
            }, 0);

            tl.to(btn, {
                scale: 1.2, duration: 0.15, ease: 'power2.out',
                yoyo: true, repeat: 1
            }, 0);

            tl.to(row, {
                height: fullH, duration: 0.55,
                ease: 'power4.out',
                onUpdate() {
                    const curH = row.offsetHeight;
                    const delta = curH - prevH;
                    prevH = curH;
                    if (delta > 0 && needsScroll()) {
                        window.scrollBy(0, delta);
                    }
                }
            }, 0);

            tl.to(cards, {
                opacity: 1, y: 0, scale: 1,
                duration: 0.6, ease: spring,
                stagger: 0.04
            }, 0.15);

            btn.classList.remove('collapsed');
        } else {
            const rowH = row.offsetHeight;
            const sectionTop = row.closest('.home-section').getBoundingClientRect().top + window.scrollY;
            gsap.set(row, { height: rowH, overflow: 'hidden' });

            const tl = gsap.timeline({
                onComplete: () => {
                    gsap.set(row, { height: 0 });
                    gsap.set(cards, { opacity: 0, y: 40, scale: 0.85 });
                    isAnimating = false;
                    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                    if (window.scrollY > maxScroll) {
                        lenisScrollTo(Math.max(0, sectionTop - 100), { duration: 0.8 });
                    }
                }
            });

            tl.to(btn.querySelector('svg'), {
                rotation: -90, duration: 0.5, ease: 'back.out(2)'
            }, 0);

            tl.to(cards, {
                opacity: 0, y: -20, scale: 0.9,
                duration: 0.3, ease: 'power2.in',
                stagger: { each: 0.02, from: 'end' }
            }, 0);

            tl.to(row, {
                height: 0, duration: 0.45,
                ease: 'power3.inOut'
            }, 0.15);

            btn.classList.add('collapsed');
        }

        localStorage.setItem('popularFriendsCollapsed', !isCollapsed);
    });
}

function renderLanding() {
    return `<div class="page-enter">
        <div class="landing-hero">
            <h1 class="landing-title">${renderHeadline(['Watch Together.', 'Track Together.'])}</h1>
            <p class="landing-sub">Host a Watch Party, sync progress with friends in real time, and never watch alone again.</p>
            <button class="glass-btn glass-btn-primary" style="font-size:1rem;padding:14px 36px" data-login>
                Get Started with AniList
            </button>
        </div>
        ${renderStage()}
        ${renderTour()}
        ${renderDesigns()}
        <h2 class="landing-more-title">And there's more</h2>
        <div class="landing-features stagger-in">
            <div class="landing-feature landing-feature-highlight landing-feature-clickable" role="button" tabindex="0" data-feature="watchparty">
                <div class="landing-feature-icon">${FEATURE_ICONS.watchparty}</div>
                <div class="landing-feature-title">Watch Party</div>
                <div class="landing-feature-text">Share a link, the host counts episodes and everyone's AniList follows — even with the tab closed.</div>
                <div class="landing-feature-cta">Learn more <svg data-icon="arrow_forward" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></div>
            </div>
            <div class="landing-feature landing-feature-highlight landing-feature-clickable" role="button" tabindex="0" data-feature="jellyfin">
                <div class="landing-feature-icon">${FEATURE_ICONS.jellyfin}</div>
                <div class="landing-feature-title">Jellyfin Live Tracking</div>
                <div class="landing-feature-text">Watch on your own Jellyfin server and the episode lands on your AniList by itself.</div>
                <div class="landing-feature-cta">Learn more <svg data-icon="arrow_forward" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></div>
            </div>
            <div class="landing-feature landing-feature-highlight landing-feature-clickable" role="button" tabindex="0" data-feature="social">
                <div class="landing-feature-icon">${FEATURE_ICONS.social}</div>
                <div class="landing-feature-title">Social Feed</div>
                <div class="landing-feature-text">See what the people you follow are watching, reply, like and compare lists.</div>
                <div class="landing-feature-cta">Learn more <svg data-icon="arrow_forward" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></div>
            </div>
        </div>
        <div id="trending-preview" style="margin-top:var(--space-2xl)">
            <div class="section-header">
                <h2 class="section-title">Trending Now</h2>
            </div>
            <div id="landing-trending" class="scroll-row">${renderSkeletonCards(6)}</div>
        </div>
        <div class="landing-foot"><button type="button" class="whatsnew-link">What's new</button><a class="landing-foot-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}Source on GitHub</a></div>
    </div>`;
}

const MOCK_COVERS = {
    jjk: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx145064-5fa4ZBbW4dqA.jpg',
    op: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/nx21-tXMN3Y20PIL9.jpg',
    rezero: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx108632-lQWnmw7XaNOK.jpg',
    mushoku: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx146065-IjirxRK26O03.png',
    frieren: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-gHSraOSa0nBG.jpg',
    dandadan: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx171018-60q1B6GK2Ghb.jpg',
    csm: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx127230-DdP4vAdssLoz.png',
    vinland: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101348-2fhDFPCuMNiz.jpg',
    spy: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx140960-vN39AmOWrVB5.jpg',
    bocchi: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx130003-HTDmeL4RGeJ4.png',
    oshi: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx150672-WqmmwZ4nMzAy.png',
    aot: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-C6FPmWm59CyP.jpg',
};

function buildMockWatchParty() {
    return `<div class="fm-wp">
        <div class="fm-wp-header">
            <div class="fm-wp-badge">● LIVE</div>
            <div class="fm-wp-title-row">
                <img class="fm-cover-img" src="${MOCK_COVERS.jjk}" alt="">
                <div><div class="fm-wp-name">Jujutsu Kaisen S2</div><div class="fm-wp-ep">Episode 14 / 23</div></div>
            </div>
        </div>
        <div class="fm-wp-progress">
            <div class="fm-wp-bar"><div class="fm-wp-fill"></div></div>
        </div>
        <div class="fm-wp-members">
            <div class="fm-wp-member"><div class="fm-avatar fm-a1"></div><span>Gojo</span><span class="fm-wp-ep-tag">Ep 14</span></div>
            <div class="fm-wp-member"><div class="fm-avatar fm-a2"></div><span>Anya</span><span class="fm-wp-ep-tag">Ep 14</span></div>
            <div class="fm-wp-member"><div class="fm-avatar fm-a3"></div><span>Eren</span><span class="fm-wp-ep-tag fm-behind">Ep 13</span></div>
        </div>
        <div class="fm-wp-link">
            <div class="fm-wp-link-url">aniroll.app/party/a3f8k2</div>
            <div class="fm-wp-copy">Copy</div>
        </div>
    </div>`;
}

function buildMockSocial() {
    return `<div class="fm-social">
        <div class="fm-social-item fm-si-anim1">
            <div class="fm-avatar fm-a1"></div>
            <div class="fm-social-body">
                <span class="fm-social-user">Anya</span>
                <span class="fm-social-text">completed <strong>Frieren</strong></span>
            </div>
            <img class="fm-social-cover" src="${MOCK_COVERS.frieren}" alt="">
        </div>
        <div class="fm-social-item fm-si-anim2">
            <div class="fm-avatar fm-a2"></div>
            <div class="fm-social-body">
                <span class="fm-social-user">Eren</span>
                <span class="fm-social-text">watched episode 8 of <strong>Dandadan</strong></span>
            </div>
            <img class="fm-social-cover" src="${MOCK_COVERS.dandadan}" alt="">
        </div>
        <div class="fm-social-item fm-si-anim3">
            <div class="fm-avatar fm-a3"></div>
            <div class="fm-social-body">
                <span class="fm-social-user">Gojo</span>
                <span class="fm-social-text">plans to watch <strong>Chainsaw Man S2</strong></span>
            </div>
            <img class="fm-social-cover" src="${MOCK_COVERS.csm}" alt="">
        </div>
        <div class="fm-social-actions">
            <div class="fm-like-btn">♡ Like</div>
            <div class="fm-compare-btn">⇄ Compare</div>
        </div>
    </div>`;
}

function buildMockJellyfin() {
    return `<div class="fm-jf">
        <div class="jf-now-card">
            <img class="jf-now-cover" src="${MOCK_COVERS.frieren}" alt="">
            <div class="jf-now-body">
                <div class="jf-now-kicker"><span class="jf-now-dot"></span>Now watching on Jellyfin</div>
                <div class="jf-now-title">Frieren: Beyond Journey's End</div>
                <div class="jf-now-sub">Episode 7</div>
                <div class="jf-now-bar"><span></span><i style="left:90%"></i></div>
                <div class="jf-now-meta"><span class="fm-jf-state"><span class="fm-jf-wait">Counts toward AniList at 90%</span><span class="fm-jf-saved">Saved to AniList</span></span> · Living Room TV</div>
            </div>
        </div>
    </div>`;
}

const FEATURE_ICONS = {
    watchparty: `<svg data-icon="live_tv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
    jellyfin: `<svg data-icon="play_circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5z"/></svg>`,
    social: `<svg data-icon="group" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="4"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="18" cy="9" r="3"/><path d="M22 20c0-2.8-2.2-5-5-5"/></svg>`,
};

const featureDetails = {
    watchparty: {
        title: 'Watch Party',
        icon: FEATURE_ICONS.watchparty,
        headline: 'Watch anime together, no matter where you are.',
        description: 'Start a Watch Party and invite your friends with a single link. The host counts the episodes, and every guest\'s AniList follows along — forward only, so nobody loses progress. With “Keep syncing” it even works while a guest\'s tab is closed. When the party is over, post it straight to your AniList feed.',
        features: [
            'One link to join, guests log in with their own AniList',
            'Host counts episodes, guests follow live (also with the tab closed)',
            'Roll together from everyone\'s Planning lists, switch shows without a new party',
            'Rewatches count as rewatches; End & Post shares the session on AniList',
        ],
        mockup: buildMockWatchParty
    },
    jellyfin: {
        title: 'Jellyfin Live Tracking',
        icon: FEATURE_ICONS.jellyfin,
        headline: 'Press play on Jellyfin. AniRoll does the bookkeeping.',
        description: 'Connect your own Jellyfin server once. When an episode passes 90%, AniRoll writes it to your AniList within seconds — also when AniRoll isn\'t open. The show you\'re watching appears as “Now watching” in AniRoll, and a Watch Party host\'s counter jumps along.',
        features: [
            'Counts an episode at 90%, within seconds, without AniRoll open',
            '“Now watching” in the nav and on Home',
            'Finds the right show even when two share a title (episode and year decide)',
            'Starting episode 1 again tracks a rewatch; specials are never counted',
        ],
        mockup: buildMockJellyfin
    },
    social: {
        title: 'Social Feed',
        icon: FEATURE_ICONS.social,
        headline: 'Stay connected with what your friends are watching.',
        description: 'Your feed pulls activity from everyone you follow on AniList: who started a series, finished a binge or posted something. Posts show the way they do on AniList — formatting, spoilers, images and cards for linked shows — and you can reply right there.',
        features: [
            'Activity from everyone you follow on AniList',
            'Like and reply; Reply puts the @name in for you',
            'Spoilers, images, formatting and cards for linked shows',
            'Compare your list side by side with a friend',
        ],
        mockup: buildMockSocial
    },
};

export function initFeatureCards() {
    document.querySelectorAll('.landing-feature-clickable').forEach(card => {
        const show = () => {
            const detail = featureDetails[card.dataset.feature];
            if (detail) showFeatureDetail(detail);
        };
        card.addEventListener('click', show);
        card.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            show();
        });
    });
}

function showFeatureDetail(detail) {
    const overlay = document.createElement('div');
    overlay.className = 'feature-detail-overlay';
    overlay.innerHTML = `
        <div class="feature-detail-backdrop"></div>
        <div class="feature-detail-panel">
            <button class="feature-detail-close glass-icon-btn" aria-label="Close">
                <svg data-icon="close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <div class="feature-detail-mockup" aria-hidden="true">${detail.mockup()}</div>
            <div class="feature-detail-content">
                <div class="feature-detail-icon">${detail.icon}</div>
                <h2 class="feature-detail-title">${detail.title}</h2>
                <p class="feature-detail-headline">${detail.headline}</p>
                <p class="feature-detail-desc">${detail.description}</p>
                <ul class="feature-detail-list">
                    ${detail.features.map(f => `<li>${f}</li>`).join('')}
                </ul>
                <button class="glass-btn glass-btn-primary" style="margin-top:var(--space-xl)" data-login>
                    Get Started
                </button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const release = openDialog(overlay.querySelector('.feature-detail-panel'), { label: detail.title, onClose: () => close() });
    const close = () => {
        release();
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 300);
    };
    overlay.querySelector('.feature-detail-backdrop').addEventListener('click', close);
    overlay.querySelector('.feature-detail-close').addEventListener('click', close);
}

export function loadLandingTrending() {
    api.getTrending('ANIME', 1, 15).then(media => {
        const el = document.getElementById('landing-trending');
        if (el) el.innerHTML = media.map(m => `<div style="flex:0 0 150px">${renderMediaCard(m)}</div>`).join('');
    }).catch(() => {});
}
