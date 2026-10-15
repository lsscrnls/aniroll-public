// @ts-check
// Going back in the installed app. A home screen app has no browser bar: iOS gives it no way back at all,
// Android only its system back. So there is a back button in the top bar and a swipe from the left edge,
// both only in the installed app. Going back first closes what is open over the page (a dialog, or one
// step of the detail panel), then returns one page, and never further than the page the app started on.
import { dialogOpen, dialogBack, closeAllDialogs } from './a11y.js?v=179';

const KEY = 'anirollDepth';
// How many pages of this app lie behind the current one
let depth = 0;

export function isStandalone() {
    // @ts-ignore: iOS only
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// Every page in the history carries its depth. Where the browser has the Navigation API its index says
// it exactly (it only counts this app's pages); otherwise one more than the page it came from.
function stamp(first) {
    const known = history.state?.[KEY];
    if (typeof known === 'number') depth = known;
    else {
        depth = first ? 0 : depth + 1;
        history.replaceState({ ...(history.state || {}), [KEY]: depth }, '');
    }
    // @ts-ignore: the Navigation API is not in every DOM typing yet
    const index = window.navigation?.currentEntry?.index;
    if (typeof index === 'number' && index >= 0) depth = index;
}

export function canGoBack() {
    return dialogOpen() || depth > 0;
}

export function goBack() {
    if (dialogBack()) return;
    if (depth > 0) history.back();
}

// The player has gestures of its own, and its own back button
function onPlayer() {
    return location.hash.startsWith('#/play/') || !!document.fullscreenElement || !!document.querySelector('#content .player');
}

function updateButton(btn) {
    btn.hidden = !isStandalone() || depth === 0;
}

// ===== Swipe from the left edge =====
const EDGE = 20;
const THRESHOLD = 90;
const SHIFT = 28;

// A carousel under the finger that can still scroll left takes the swipe itself
function scrollsLeft(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (node.matches?.('input[type="range"]')) return true;
        if (node.scrollLeft > 0 && node.scrollWidth > node.clientWidth) {
            const overflow = getComputedStyle(node).overflowX;
            if (overflow === 'auto' || overflow === 'scroll') return true;
        }
    }
    return false;
}

function setupSwipe() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const hint = document.createElement('div');
    hint.className = 'back-swipe';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    document.body.appendChild(hint);

    let start = null;
    let dragging = false;
    let progress = 0;
    // The page under the finger follows a little: the panel when one is open, otherwise the page
    let moved = null;

    function paint() {
        hint.style.setProperty('--p', String(progress));
        hint.style.top = `${start.y}px`;
        hint.classList.toggle('is-ready', progress >= 1);
        if (moved && !reduce.matches) moved.style.transform = `translateX(${Math.round(progress * SHIFT)}px)`;
    }

    function end(go) {
        if (dragging) {
            hint.classList.remove('is-on', 'is-ready');
            if (moved) {
                const el = moved;
                el.style.transition = 'transform .2s ease';
                el.style.transform = '';
                setTimeout(() => { el.style.transition = ''; }, 220);
            }
            if (go) goBack();
        }
        start = null;
        dragging = false;
        progress = 0;
        moved = null;
    }

    document.addEventListener('touchstart', (e) => {
        start = null;
        if (e.touches.length !== 1 || !isStandalone() || !canGoBack() || onPlayer()) return;
        const t = e.touches[0];
        if (t.clientX > EDGE || scrollsLeft(e.target)) return;
        start = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!start) return;
        const t = e.touches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (!dragging) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > dx) return end(false);
            if (dx < 10) return;
            dragging = true;
            hint.classList.add('is-on');
            moved = dialogOpen()
                ? document.querySelector('#detail-panel-overlay.open .detail-panel')
                : document.getElementById('content');
        }
        // The page must not scroll while the finger pulls it back
        if (e.cancelable) e.preventDefault();
        progress = Math.max(0, Math.min(1, dx / THRESHOLD));
        paint();
    }, { passive: false });

    document.addEventListener('touchend', () => end(progress >= 1));
    document.addEventListener('touchcancel', () => end(false));
}

export function initBackNav() {
    stamp(true);
    const btn = document.getElementById('nav-back');
    window.addEventListener('popstate', (e) => {
        // Back or forward to another page of the app: nothing stays open over the page it left
        if (typeof e.state?.[KEY] === 'number') closeAllDialogs();
    });
    window.addEventListener('hashchange', () => {
        stamp(false);
        if (btn) updateButton(btn);
    });
    if (btn) {
        btn.addEventListener('click', goBack);
        updateButton(btn);
        matchMedia('(display-mode: standalone)').addEventListener?.('change', () => updateButton(btn));
    }
    setupSwipe();
}
