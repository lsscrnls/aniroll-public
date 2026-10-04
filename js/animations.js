let lenis = null;
const cursorEl = document.getElementById('cursor');
let magneticCleanups = [];
let scrollTriggers = [];
let lenisRafId = null;
let lenisWake = null;
let cursorInitialized = false;

// "Reduce motion" in the system settings: no smooth scrolling, nothing flies in, moves along
// or counts up. Checked on every setup, so switching it takes effect with the next page.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export function prefersReducedMotion() {
    return reducedMotion.matches;
}

export function initAnimations() {
    if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
    initLenis();
    reducedMotion.addEventListener?.('change', initLenis);
    if (!cursorInitialized) {
        initCursor();
        cursorInitialized = true;
    }
    initMagnetics();
    scheduleScrollSetup();
}

export function stopLenis() {
    if (lenis) lenis.stop();
}

export function startLenis() {
    if (lenis) lenis.start();
}

export function lenisScrollTo(target, opts) {
    if (lenis) { lenis.scrollTo(target, opts); lenisWake?.(); }
    else {
        // Without Lenis (reduce motion): a number, or an element and the offset above it
        const top = typeof target === 'number' ? target
            : target?.getBoundingClientRect ? target.getBoundingClientRect().top + window.scrollY + (opts?.offset || 0) : 0;
        window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
}

export function refreshAnimations() {
    scrollTriggers.forEach(st => st.kill());
    scrollTriggers = [];

    if (lenis) { lenis.scrollTo(0, { immediate: true }); lenisWake?.(); }
    else window.scrollTo(0, 0);

    initMagnetics();
    scheduleScrollSetup();
}

function scheduleScrollSetup() {
    requestAnimationFrame(() => {
        window.ScrollTrigger?.refresh();
        initScrollReveals();
        initParallax();
        initSmoothCounter();
    });
}

function initLenis() {
    if (lenis) {
        lenis.destroy();
        lenis = null;
        if (lenisRafId) cancelAnimationFrame(lenisRafId);
    }
    if (prefersReducedMotion()) return; // the browser's own scrolling

    lenis = new window.Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 2,
        prevent: (node) => node.closest('.detail-panel-body, .detail-panel-actions, .search-container, .glass-dropdown, .modal-content'),
    });

    lenis.on('scroll', () => window.ScrollTrigger?.update());

    // Lenis needs a frame only while it scrolls; with the page at rest the loop sleeps until the next wheel,
    // touch or key, instead of running 60 times a second forever (and under the player, where it is stopped)
    function raf(time) {
        lenis.raf(time);
        lenisRafId = lenis.isScrolling || lenis.isStopped === false && lenis.velocity ? requestAnimationFrame(raf) : null;
    }
    const wake = () => { if (!lenisRafId && lenis) lenisRafId = requestAnimationFrame(raf); };
    lenis.on('scroll', wake);
    for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(ev, wake, { passive: true });
    lenisWake = wake;
    lenisRafId = requestAnimationFrame(raf);
}

function initCursor() {
    if (!cursorEl || window.matchMedia('(pointer: coarse)').matches) return;

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mousedown', () => cursorEl.classList.add('grow'));
    window.addEventListener('mouseup', () => cursorEl.classList.remove('grow'));
    document.documentElement.addEventListener('mouseleave', () => cursorEl.classList.add('hide'));
    document.documentElement.addEventListener('mouseenter', () => cursorEl.classList.remove('hide'));
}

// Material 3 hides this cursor and draws its own (js/m3.js): nothing to move then
function onMouseMove(e) {
    if (!cursorEl || document.documentElement.dataset.design === 'm3') return;
    cursorEl.style.left = e.clientX + 'px';
    cursorEl.style.top = e.clientY + 'px';
}

function initMagnetics() {
    magneticCleanups.forEach(fn => fn());
    magneticCleanups = [];

    if (window.matchMedia('(pointer: coarse)').matches || prefersReducedMotion()) return;

    document.querySelectorAll('.magnetic').forEach(el => {
        const strength = 0.3;
        let tweenMove = null;
        let tweenLeave = null;

        // The box is measured when the pointer comes in, not on every move; quickTo reuses one tween
        let rect = null;
        const toX = gsap.quickTo(el, 'x', { duration: 0.3, ease: 'power2.out' });
        const toY = gsap.quickTo(el, 'y', { duration: 0.3, ease: 'power2.out' });
        function onMove(e) {
            rect ||= el.getBoundingClientRect();
            if (tweenLeave) { tweenLeave.kill(); tweenLeave = null; }
            toX((e.clientX - rect.left - rect.width / 2) * strength);
            toY((e.clientY - rect.top - rect.height / 2) * strength);
            cursorEl?.classList.add('grow');
        }

        function onLeave() {
            rect = null;
            if (tweenMove) tweenMove.kill();
            tweenLeave = gsap.to(el, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)', overwrite: true });
            cursorEl?.classList.remove('grow');
        }

        el.addEventListener('mousemove', onMove, { passive: true });
        el.addEventListener('mouseleave', onLeave);

        magneticCleanups.push(() => {
            el.removeEventListener('mousemove', onMove);
            el.removeEventListener('mouseleave', onLeave);
            gsap.set(el, { x: 0, y: 0 });
        });
    });
}

function initScrollReveals() {
    if (!window.ScrollTrigger || prefersReducedMotion()) return;

    // Material 3 deals cards, rows and posts in with its own springs (css/m3.css), so they are left out there
    const m3 = document.documentElement.dataset.design === 'm3';
    const ownMotion = '.media-card, .activity-card, .list-entry, .schedule-item, .notif-item';
    document.querySelectorAll('.media-card, .activity-card, .list-entry, .schedule-item, .notif-item, .landing-feature, .stat-chart').forEach(el => {
        if (el._revealDone || (m3 && el.matches(ownMotion))) return;

        const tween = gsap.from(el, {
            y: 32,
            opacity: 0,
            duration: 0.6,
            ease: 'power2.out',
            // GSAP leaves inline `translate: none` + `transform` behind, which beats any CSS
            // :hover on the card (home covers stopped lifting). Hand the element back when done.
            clearProps: 'transform,translate,rotate,scale,opacity',
            scrollTrigger: {
                trigger: el,
                start: 'top 92%',
                once: true,
            }
        });

        if (tween.scrollTrigger) scrollTriggers.push(tween.scrollTrigger);
        el._revealDone = true;
    });
}

function initParallax() {
    if (!window.ScrollTrigger || prefersReducedMotion()) return;

    document.querySelectorAll('.detail-banner-img, .profile-banner img').forEach(el => {
        if (el._parallaxDone) return;

        const tween = gsap.to(el, {
            yPercent: 15,
            ease: 'none',
            scrollTrigger: {
                trigger: el.closest('.detail-banner, .profile-banner') || el,
                start: 'top top',
                end: 'bottom top',
                scrub: true,
            }
        });

        if (tween.scrollTrigger) scrollTriggers.push(tween.scrollTrigger);
        el._parallaxDone = true;
    });
}

// One observer for every page: a new one per page kept the old pages' numbers alive
let counterObserver = null;
function initSmoothCounter() {
    if (prefersReducedMotion()) return; // the numbers are already in the markup
    counterObserver?.disconnect();
    const observer = counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    document.querySelectorAll('.detail-stat-value, .profile-stat-num').forEach(el => {
        if (el._counterDone) return;
        el._counterDone = true;
        observer.observe(el);
    });
}

function animateCounter(el) {
    const text = el.textContent.trim();
    const match = text.match(/^([\d,.]+)(.*)$/);
    if (!match) return;

    const target = parseFloat(match[1].replace(',', '.'));
    const suffix = match[2] || '';
    const isDecimal = match[1].includes('.') || match[1].includes(',');
    const duration = 700;
    const start = performance.now();

    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = target * eased;

        el.textContent = isDecimal
            ? current.toFixed(1) + suffix
            : Math.round(current).toLocaleString() + suffix;

        if (progress < 1) requestAnimationFrame(update);
        else el.textContent = text;
    }

    requestAnimationFrame(update);
}
