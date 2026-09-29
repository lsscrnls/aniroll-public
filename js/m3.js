// Material 3 Expressive: what that design adds to the page beyond CSS (loaded by design.js, only in M3).
// - the top app bar gets a search bar instead of a search icon
// - the navigation rail gets Roll as its FAB
// - Home opens with a hero moment: the show you're on, the next episode as a huge number, a shaped cover
// - colour from content: a show's cover colour recolours its surroundings (detail panel, the whole app on a
//   detail page, the Roll stage, the Home hero), with a smooth blend (@property in m3.css)
// - container transform: a tapped cover grows into the detail panel (View Transitions, where supported)
// - every page carries its name on <body data-m3-page>
// - like a desktop themed from its wallpaper: the show you're on becomes the app's blurred wallpaper and,
//   with the palette "From your show", the whole app wears its colours; a detail page lends its own
// - widgets on Home: the next episode's countdown, your week, the episodes waiting
// - its own cursor: a dot, and a tonal shape that follows on a spring and takes the shape of what it points at
// - the detail sheet pushes the page slightly aside instead of covering it
// - feel: ripples under the finger, and a small burst of shapes whenever an episode is marked watched
// Everything is removed again by teardown() when switching back to AniRoll's design.
import { esc, titlePref, WATCHED_EVENT, GITHUB_URL, GITHUB_ICON } from './store.js?v=115';
import { upNext, glance, DAYS, greeting } from './upnext.js?v=115';
import { contentScheme, getSeed, getShowTheme, setShowTheme, SHOW_SEED } from './design.js?v=115';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ROLL_SVG = document.querySelector('.mobile-tab[data-page="roll"] svg')?.outerHTML || '';
let cleanups = [];

export function setup() {
    teardown();

    // Wallpaper: two stacked images, the new one fades in over the old
    const wall = document.createElement('div');
    wall.className = 'm3-wall';
    wall.setAttribute('aria-hidden', 'true');
    document.body.prepend(wall);
    cleanups.push(() => wall.remove());
    applyAppTheme();

    // Search bar in the app bar (the button stays the button; it just reads like a field)
    const search = document.getElementById('search-btn');
    if (search) {
        const label = document.createElement('span');
        label.className = 'm3-search-label';
        label.textContent = 'Search anime and manga';
        search.appendChild(label);
        search.classList.add('m3-searchbar');
        cleanups.push(() => { label.remove(); search.classList.remove('m3-searchbar'); });
    }

    // Roll as the rail's FAB (desktop); the phone bar keeps Roll as a destination
    const tabbar = document.getElementById('tabbar');
    if (tabbar) {
        const fab = document.createElement('a');
        fab.href = '#/roll';
        fab.className = 'm3-rail-fab';
        fab.setAttribute('aria-label', 'Roll');
        fab.innerHTML = ROLL_SVG;
        tabbar.prepend(fab);
        const mark = () => fab.classList.toggle('active', location.hash.startsWith('#/roll'));
        mark();
        window.addEventListener('hashchange', mark);
        cleanups.push(() => { fab.remove(); window.removeEventListener('hashchange', mark); });
    }

    // The source on GitHub as the rail's last item, set apart from the destinations (desktop; on a phone
    // it stays in the avatar menu)
    if (tabbar) {
        const gh = document.createElement('a');
        gh.href = GITHUB_URL;
        gh.target = '_blank';
        gh.rel = 'noopener';
        gh.className = 'm3-rail-github';
        gh.innerHTML = `${GITHUB_ICON}<span>GitHub</span>`;
        gh.setAttribute('aria-label', 'Source on GitHub');
        tabbar.append(gh);
        cleanups.push(() => gh.remove());
    }

    document.addEventListener('aniroll:continue-watching', onContinue);
    cleanups.push(() => document.removeEventListener('aniroll:continue-watching', onContinue));

    // Colour from content
    document.addEventListener('aniroll:media-shown', onMediaShown);
    cleanups.push(() => document.removeEventListener('aniroll:media-shown', onMediaShown));

    // Page name for the header band; a detail page's colours end when you leave it
    const onRoute = () => {
        const page = (location.hash.slice(2).split(/[/?]/)[0]) || 'home';
        document.body.dataset.m3Page = page;
        if (page !== 'anime' && page !== 'manga') applyAppTheme();
    };
    onRoute();
    window.addEventListener('hashchange', onRoute);
    cleanups.push(() => { window.removeEventListener('hashchange', onRoute); delete document.body.dataset.m3Page; setScope(document.documentElement, null); });

    // Container transform: remember which cover was pressed, grow it into the panel
    let pressed = null;
    const onDown = (e) => {
        const cover = e.target.closest('.m3-hero-cover, .m3-widget img[data-open]');
        pressed = { img: cover || e.target.closest('.media-card, .search-result-item, .calendar-week-item, .schedule-item')?.querySelector('img'), at: Date.now() };
    };
    document.addEventListener('pointerdown', onDown, true);
    const open = window.__openDetailPanel;
    if (open && !open.m3) {
        const wrapped = (id) => {
            const img = pressed && Date.now() - pressed.at < 1500 ? pressed.img : null;
            pressed = null;
            if (!img || !document.startViewTransition || reduceMotion()) return open(id);
            return morphInto(img, () => open(id));
        };
        wrapped.m3 = true;
        window.__openDetailPanel = wrapped;
        cleanups.push(() => { if (window.__openDetailPanel === wrapped) window.__openDetailPanel = open; });
    }
    cleanups.push(() => document.removeEventListener('pointerdown', onDown, true));
    // Ripple: the touch spreads from where the finger went down
    document.addEventListener('pointerdown', ripple, true);
    cleanups.push(() => document.removeEventListener('pointerdown', ripple, true));
    // An episode marked watched gets its little celebration
    document.addEventListener('click', celebrate, true);
    cleanups.push(() => document.removeEventListener('click', celebrate, true));

    // The show you just watched becomes the app's show: wallpaper and (with "From your show") colours
    document.addEventListener(WATCHED_EVENT, onWatched);
    cleanups.push(() => document.removeEventListener(WATCHED_EVENT, onWatched));

    // Cursor (mouse and trackpad only)
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) cleanups.push(setupCursor());

    // The detail sheet slides in and the page makes room for it
    const overlay = document.getElementById('detail-panel-overlay');
    if (overlay) {
        const sync = () => document.body.classList.toggle('m3-sheet-open', overlay.classList.contains('open'));
        const mo = new MutationObserver(sync);
        mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        sync();
        cleanups.push(() => { mo.disconnect(); document.body.classList.remove('m3-sheet-open'); });
    }

    // A cover inside a widget opens its show instead of following the widget's link
    const onWidgetCover = (e) => {
        const img = e.target.closest('.m3-widget img[data-open]');
        if (!img) return;
        e.preventDefault();
        e.stopPropagation();
        window.__openDetailPanel?.(Number(img.dataset.open));
    };
    document.addEventListener('click', onWidgetCover, true);
    cleanups.push(() => document.removeEventListener('click', onWidgetCover, true));

    // Widgets tick along with the clock
    const tick = setInterval(() => document.querySelectorAll('[data-m3-until]').forEach(renderCountdown), 30000);
    cleanups.push(() => clearInterval(tick));

    // Home may have rendered before this module arrived
    if (window.__anirollContinue) onContinue({ detail: window.__anirollContinue });
}

// Settings changed the palette: re-apply the show's colours (or drop them)
export function refresh() {
    const page = document.body.dataset.m3Page;
    if (page !== 'anime' && page !== 'manga') applyAppTheme();
}

// The app's own look outside a detail page: the show you're on as wallpaper, its colours if chosen
function applyAppTheme() {
    const show = getShowTheme();
    setWall(show?.cover || null);
    setScope(document.documentElement, getSeed() === SHOW_SEED ? show?.color || null : null);
}

function onWatched(e) {
    const m = e.detail?.media;
    if (!m) return;
    // A show without a cover colour on AniList keeps the palette; only the wallpaper changes
    const theme = { color: m.coverImage?.color || getShowTheme()?.color || null, cover: coverOf(m) || getShowTheme()?.cover || null };
    setShowTheme(theme);
    const page = document.body.dataset.m3Page;
    if (page !== 'anime' && page !== 'manga') applyAppTheme();
}

// A cover drawn tiny (48×72) and blurred once into a canvas: stretched to fill the screen it is soft by itself,
// with no CSS blur at all. A 44–72px CSS blur over the whole window made every larger repaint stall a frame.
function tinyCover(url, onReady) {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 72;
    canvas.setAttribute('aria-hidden', 'true');
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // Blurred once, here, drawn a little larger than the canvas so the edges don't fade to transparent
        ctx.filter = 'blur(3px)';
        ctx.drawImage(img, -8, -12, canvas.width + 16, canvas.height + 24);
        onReady?.(canvas);
    };
    img.src = url;
    return canvas;
}

function setWall(url) {
    const wall = document.querySelector('.m3-wall');
    if (!wall) return;
    const current = wall.querySelector('.on');
    if ((current?.dataset.src || null) === (url || null)) return;
    current?.classList.remove('on');
    [...wall.querySelectorAll('canvas:not(.on)')].slice(0, -1).forEach(el => el.remove());
    if (!url) return;
    const layer = tinyCover(url, (c) => requestAnimationFrame(() => c.classList.add('on')));
    layer.dataset.src = url;
    wall.appendChild(layer);
    setTimeout(() => wall.querySelectorAll('canvas:not(.on)').forEach(old => old !== layer && old.remove()), 1600);
}

export function teardown() {
    cleanups.forEach(fn => fn());
    cleanups = [];
    document.querySelectorAll('.m3-hero, .m3-widgets').forEach(el => el.remove());
    document.querySelectorAll('.m3-scope').forEach(el => setScope(el, null));
    document.querySelectorAll('.m3-ripple-box, .m3-confetti').forEach(el => el.remove());
    document.querySelectorAll('.roll-stage > .m3-hero-glow').forEach(el => el.remove());
}

const RIPPLE = '.glass-btn, .media-card, .list-tab, .tab-btn, .friends-tab, .page-switch > a, .genre-chip, .progress-btn, .cw-inc, '
    + '.nav-icon-btn, .m3-rail-fab, .wp-fab, .design-option, .dropdown-item, .glass-menu-option, .search-result-item, .notif-item, '
    + '.list-entry, .activity-action-btn, .section-link, .season-nav-btn, .detail-panel-action-btn, .list-card';

function ripple(e) {
    if (e.button !== 0 || reduceMotion()) return;
    const host = e.target.closest(RIPPLE);
    if (!host || host.disabled) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let box = host.querySelector(':scope > .m3-ripple-box');
    if (!box) {
        box = document.createElement('span');
        box.className = 'm3-ripple-box';
        host.appendChild(box);
    }
    const r = host.getBoundingClientRect();
    const size = 2 * Math.hypot(Math.max(e.clientX - r.left, r.right - e.clientX), Math.max(e.clientY - r.top, r.bottom - e.clientY));
    const dot = document.createElement('span');
    dot.className = 'm3-ripple';
    Object.assign(dot.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
    box.appendChild(dot);
    const grow = dot.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
    const release = () => {
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
        grow.finished.catch(() => {}).then(() => dot.animate([{ opacity: 0.14 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished)
            .catch(() => {}).then(() => dot.remove());
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
}

// +1 on Home, the hero, My List and the detail panel: a handful of shapes in the palette fly off the button
const INC = '.cw-inc:not([data-action="dec"]), [data-hero-inc], .progress-btn[data-action="inc"], #inc-progress';
const PIECES = ['--m3-shape-cookie4', '--m3-shape-clover4', '--m3-shape-circle', '--m3-shape-flower', '--m3-shape-cookie9'];
const COLOURS = ['--md-primary', '--md-tertiary', '--md-secondary', '--md-primary-container', '--md-tertiary-container'];

function celebrate(e) {
    // Real clicks only: the hero passes its click on to the card's button, that one stays quiet
    const btn = e.isTrusted && e.target.closest(INC);
    if (!btn || btn.disabled) return;
    navigator.vibrate?.(12);
    if (reduceMotion()) return;
    const r = btn.getBoundingClientRect();
    const x = e.clientX || r.left + r.width / 2, y = e.clientY || r.top + r.height / 2;
    const css = getComputedStyle(btn);
    for (let i = 0; i < 14; i++) {
        const bit = document.createElement('span');
        bit.className = 'm3-confetti';
        const size = 8 + Math.random() * 10;
        Object.assign(bit.style, {
            left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px`,
            clipPath: `var(${PIECES[i % PIECES.length]})`,
            background: css.getPropertyValue(COLOURS[i % COLOURS.length]) || 'currentColor',
        });
        document.body.appendChild(bit);
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
        const dist = 50 + Math.random() * 70;
        const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
        const spin = (Math.random() - 0.5) * 540;
        bit.animate([
            { transform: 'translate(0, 0) scale(.3) rotate(0deg)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx * 1.2}px, ${dy + 70}px) scale(.6) rotate(${spin}deg)`, opacity: 0 },
        ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' }).finished.then(() => bit.remove(), () => bit.remove());
    }
}

// Puts a show's colours on an element (null = back to the app's own)
async function setScope(el, hex) {
    if (!el) return;
    const cls = hex ? await contentScheme(hex) : null;
    [...el.classList].filter(c => c.startsWith('m3-c-') && c !== cls).forEach(c => el.classList.remove(c));
    el.classList.toggle('m3-scope', !!cls);
    if (cls) el.classList.add(cls);
}

function onMediaShown(e) {
    const { media, root, where } = e.detail || {};
    setScope(root, media?.coverImage?.color || null);
    // The rolled cover lights the stage from behind; a detail page lends the app its wallpaper
    const cover = media?.coverImage?.extraLarge || media?.coverImage?.large;
    if (where === 'page' && cover) setWall(cover);
    if (where === 'roll' && root) {
        let glow = root.querySelector(':scope > .m3-hero-glow');
        if (!glow) {
            glow = document.createElement('div');
            glow.className = 'm3-hero-glow';
            glow.setAttribute('aria-hidden', 'true');
            root.prepend(glow);
        }
        if (glow.dataset.cover !== cover) {
            glow.dataset.cover = cover || '';
            const old = [...glow.children];
            old.forEach(c => c.classList.remove('on'));
            setTimeout(() => old.forEach(c => c.remove()), 800);
            if (cover) glow.appendChild(tinyCover(cover, (c) => requestAnimationFrame(() => c.classList.add('on'))));
        }
    }
}

// The pressed cover and the panel's cover share one view-transition name: the browser morphs one into the other
async function morphInto(img, openPanel) {
    const overlay = document.getElementById('detail-panel-overlay');
    img.style.viewTransitionName = 'm3-cover';
    overlay?.classList.add('m3-vt');
    let target = null;
    const vt = document.startViewTransition(async () => {
        img.style.viewTransitionName = '';
        const done = openPanel();
        // Wait for the panel's content (cached most of the time), but never freeze the page for long
        await Promise.race([done, new Promise(r => setTimeout(r, 900))]);
        target = document.querySelector('#detail-panel-body .detail-cover img');
        if (target) target.style.viewTransitionName = 'm3-cover';
    });
    try { await vt.finished; } catch { /* skipped */ }
    if (target) target.style.viewTransitionName = '';
    overlay?.classList.remove('m3-vt');
}


const coverOf = (m) => m?.coverImage?.extraLarge || m?.coverImage?.large || '';

function heroHtml(entry, name, others = []) {
    if (!entry) {
        return `<div class="m3-hero-body">
            <p class="m3-hero-greet">${greeting()}${name ? `, ${esc(name)}` : ''}</p>
            <h2 class="m3-hero-headline">Nothing on the go.</h2>
            <p class="m3-hero-meta">Let AniRoll pick your next show.</p>
            <div class="m3-hero-actions"><a class="glass-btn glass-btn-primary m3-btn-lg" href="#/roll">Roll something</a></div>
        </div>
        <div class="m3-hero-art m3-hero-art-empty" aria-hidden="true">${ROLL_SVG}</div>`;
    }
    const { m, next, total, behind, done, status, canWatch } = upNext(entry);
    const [left, right] = others.map(o => o.media).filter(x => coverOf(x));
    // Every cover in the fan opens its show (keyboard too: role=button + Enter via a11y.js)
    const cover = (media, cls) => `<img class="m3-hero-cover ${cls}" src="${esc(coverOf(media))}" alt="${esc(titlePref(media.title))}" data-open="${media.id}" role="button" tabindex="0">`;
    return `<div class="m3-hero-glow" data-cover="${esc(coverOf(m))}" aria-hidden="true"></div>
        <div class="m3-hero-body">
            <p class="m3-hero-greet">${greeting()}${name ? `, ${esc(name)}` : ''}</p>
            <div class="m3-hero-ep"><span class="m3-hero-ep-label">${done ? 'Finished' : 'Up next'}</span><span class="m3-hero-ep-num">${done ? total : next}</span>${total ? `<span class="m3-hero-ep-of">/ ${total}</span>` : ''}</div>
            <h2 class="m3-hero-title">${esc(titlePref(m.title))}</h2>
            ${status ? `<p class="m3-hero-meta"><span class="m3-hero-chip">${esc(status)}</span></p>` : ''}
            <div class="m3-hero-actions">
                ${canWatch ? `<button class="glass-btn glass-btn-primary m3-btn-lg" data-hero-inc="${entry.id}">Watched episode ${next}</button>` : ''}
                <button class="glass-btn glass-btn-secondary m3-btn-lg" data-open="${m.id}">Details</button>
            </div>
        </div>
        <div class="m3-hero-art">
            <div class="m3-hero-deck">
                ${left ? cover(left, 'is-left') : ''}
                ${right ? cover(right, 'is-right') : ''}
                ${cover(m, 'is-front')}
                ${behind > 1 ? `<span class="m3-hero-badge" aria-hidden="true">${behind}<small>waiting</small></span>` : ''}
            </div>
        </div>`;
}


function onContinue(e) {
    const { entries, name } = e.detail || {};
    const row = document.getElementById('continue-watching');
    const section = row?.closest('section');
    if (!section) return;
    let hero = document.querySelector('.m3-hero');
    if (!hero) {
        hero = document.createElement('section');
        hero.className = 'm3-hero';
        hero.setAttribute('aria-label', 'Up next');
        section.before(hero);
        // +1 goes through the card's own button, so saving, queueing and the row stay one code path
        hero.addEventListener('click', (ev) => {
            const inc = ev.target.closest('[data-hero-inc]');
            if (!inc) return;
            document.querySelector(`#continue-watching .cw-inc[data-entry-id="${inc.dataset.heroInc}"]`)?.click();
            setTimeout(() => onContinue(e), 60);
        });
    }
    const first = entries?.[0]?.media;
    if (first) {
        const theme = { color: first.coverImage?.color || null, cover: coverOf(first) };
        const old = getShowTheme();
        if (old?.color !== theme.color || old?.cover !== theme.cover) {
            setShowTheme(theme);
            if (document.body.dataset.m3Page === 'home') applyAppTheme();
        }
    }
    renderWidgets(hero, entries || []);

    const before = hero.querySelector('.m3-hero-ep-num')?.textContent;
    hero.innerHTML = heroHtml(entries?.[0], name, entries?.slice(1, 3) || []);
    setScope(hero, entries?.[0]?.media?.coverImage?.color || null);
    const glow = hero.querySelector('.m3-hero-glow[data-cover]');
    if (glow) glow.appendChild(tinyCover(glow.dataset.cover, (c) => c.classList.add('on')));
    const num = hero.querySelector('.m3-hero-ep-num');
    if (!num || reduceMotion()) return;
    if (before == null) countUp(num);
    else if (before !== num.textContent) num.classList.add('is-pop');
}

// The big number runs up to the episode, fast at first and settling on it
function countUp(el) {
    const to = Number(el.textContent);
    if (!(to > 1)) return;
    const start = performance.now(), duration = Math.min(1100, 500 + to * 20);
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 4))));
        if (t < 1 && el.isConnected) requestAnimationFrame(step);
        else { el.textContent = String(to); el.classList.add('is-pop'); }
    };
    el.textContent = '0';
    requestAnimationFrame(step);
}

// ===== Widgets: small live tiles under the hero, like a desktop's clock and calendar =====

function renderWidgets(hero, entries) {
    let box = document.querySelector('.m3-widgets');
    if (!entries.length) { box?.remove(); return; }
    if (!box) {
        box = document.createElement('section');
        box.className = 'm3-widgets';
        box.setAttribute('aria-label', 'At a glance');
        hero.after(box);
    }
    const { next, airing, waiting, waitingTotal: total, byDay, today } = glance(entries);

    box.innerHTML = `
        ${next ? `<button class="m3-widget m3-widget-clock" data-open="${next.media.id}" data-m3-until="${next.media.nextAiringEpisode.airingAt}">
            <span class="m3-widget-label">Next episode</span>
            <span class="m3-widget-clock-num"></span>
            <span class="m3-widget-sub">${esc(titlePref(next.media.title))} · Ep ${next.media.nextAiringEpisode.episode}</span>
        </button>` : ''}
        <a class="m3-widget m3-widget-queue" href="#/list">
            <span class="m3-widget-label">Ready to watch</span>
            <span class="m3-widget-big">${total}</span>
            <span class="m3-widget-sub">${total === 1 ? 'episode' : 'episodes'} waiting${waiting.length ? ` in ${waiting.length} ${waiting.length === 1 ? 'show' : 'shows'}` : ''}</span>
            <span class="m3-widget-faces">${waiting.slice(0, 5).map(x => `<img src="${esc(x.e.media.coverImage?.large || '')}" alt="${esc(titlePref(x.e.media.title))}" title="${esc(titlePref(x.e.media.title))}" data-open="${x.e.media.id}" role="button" tabindex="0">`).join('')}</span>
        </a>
        <a class="m3-widget m3-widget-week" href="#/calendar">
            <span class="m3-widget-label">Your week</span>
            <span class="m3-widget-days">${DAYS.map((d, i) => `<span class="m3-day${i === today ? ' is-today' : ''}${byDay[i].length ? ' has' : ''}">
                <span class="m3-day-name">${d.slice(0, 1)}</span>
                <span class="m3-day-dots">${byDay[i].slice(0, 3).map(m => `<img src="${esc(m.coverImage?.large || '')}" alt="${esc(titlePref(m.title))}" title="${esc(titlePref(m.title))}" data-open="${m.id}" role="button" tabindex="0">`).join('')}</span>
            </span>`).join('')}</span>
            <span class="m3-widget-sub">${airing.length ? `${airing.length} ${airing.length === 1 ? 'show airs' : 'shows air'} this week` : 'Nothing airing'}</span>
        </a>`;
    box.querySelectorAll('[data-m3-until]').forEach(renderCountdown);
}

// Big stacked digits like a desktop clock: days and hours, or hours and minutes
function renderCountdown(el) {
    const left = Math.max(0, Number(el.dataset.m3Until) - Date.now() / 1000);
    const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60);
    const [a, ua, b, ub] = d > 0 ? [d, 'd', h, 'h'] : [h, 'h', m, 'm'];
    const num = el.querySelector('.m3-widget-clock-num');
    if (num) num.innerHTML = `<span>${a}<small>${ua}</small></span><span>${String(b).padStart(2, '0')}<small>${ub}</small></span>`;
}

// ===== Cursor =====
// A dot right under the pointer and a tonal shape that follows it on a spring. The shape says what a click does:
// a circle at rest, a cookie over anything you can press, a flower with an arrow over a show (it opens),
// a slim bar over text fields. Pressing squishes it. Only transform and clip-path change; nothing loops.
const CURSOR_STATES = [
    ['text', 'input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]), textarea, [contenteditable="true"]'],
    ['show', '.media-card, .list-card, .search-result-item, .calendar-week-item, .schedule-item, .fr-card, .m3-hero-deck, [data-open]'],
    ['press', 'a[href], button, [role="button"], [role="link"], [role="tab"], label, select, summary, [data-go], .glass-menu-trigger, .accent-swatch, input[type="checkbox"], input[type="radio"], input[type="color"]'],
];

function setupCursor() {
    const root = document.documentElement;
    const el = document.createElement('div');
    el.className = 'm3-cursor';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="m3-cursor-ring"><div class="m3-cursor-shape"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 16L16 8M9 8h7v7"/></svg></div></div><div class="m3-cursor-dot"></div>';
    document.body.appendChild(el);
    root.classList.add('m3-cursor-on');
    const ring = el.querySelector('.m3-cursor-ring');
    const dot = el.querySelector('.m3-cursor-dot');

    const reduce = reduceMotion();
    let x = -100, y = -100, rx = -100, ry = -100, raf = 0, shown = false;
    const follow = () => {
        rx += (x - rx) * 0.24;
        ry += (y - ry) * 0.24;
        if (Math.abs(x - rx) < 0.3 && Math.abs(y - ry) < 0.3) { rx = x; ry = y; raf = 0; }
        else raf = requestAnimationFrame(follow);
        ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    };
    const onMove = (e) => {
        x = e.clientX; y = e.clientY;
        dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        if (!shown) { shown = true; rx = x; ry = y; el.classList.add('is-on'); }
        if (reduce) { rx = x; ry = y; ring.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
        else if (!raf) raf = requestAnimationFrame(follow);
    };
    const onOver = (e) => {
        const t = e.target instanceof Element ? e.target : null;
        // The innermost match wins: the +1 on a card is a button, the card around it is a show
        let state = '', hit = null;
        if (t) for (const [name, sel] of CURSOR_STATES) {
            const m = t.closest(sel);
            if (m && (!hit || (m !== hit && hit.contains(m)))) { state = name; hit = m; }
        }
        if (el.dataset.state !== state) el.dataset.state = state;
    };
    const onDown = () => el.classList.add('is-down');
    const onUp = () => el.classList.remove('is-down');
    const onLeave = () => { el.classList.remove('is-on'); shown = false; };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerover', onOver, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    root.addEventListener('mouseleave', onLeave);
    return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerover', onOver);
        window.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        root.removeEventListener('mouseleave', onLeave);
        root.classList.remove('m3-cursor-on');
        el.remove();
    };
}
