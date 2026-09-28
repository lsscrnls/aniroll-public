import { prefersReducedMotion } from './animations.js?v=110';
import { getDesign, switchDesign } from './design.js?v=110';

// Landing page motion: the headline arrives word by word, the big clip tilts upright while it scrolls in,
// and the feature tour plays one clip after another. Clips (media/*.mp4) are recorded with tools/showcase.
// "Reduce motion": everything is shown at once, clips don't autoplay (posters + controls instead).

export const TOUR = [
    { key: 'list', title: 'Your list, one tap away', text: 'Covers first, +1 right on the card, search, sort and an “Airing” filter.' },
    { key: 'calendar', title: 'The week at a glance', text: 'Air times, finales and where you stand on every show — or everything that airs.' },
    { key: 'match', title: 'A match that knows your taste', text: 'Built only from your own scores, genres and tags, with the show it’s based on.' },
];

export function renderHeadline(lines, accentLast = true) {
    const words = lines.map(l => l.split(' '));
    const last = words.length - 1;
    return words.map((ws, li) => ws.map((w, wi) =>
        `<span class="lw${accentLast && li === last && wi === ws.length - 1 ? ' lw-accent' : ''}"><span>${w}</span></span>`).join(' ')).join('<br>');
}

export function renderStage() {
    return `<div class="landing-stage" aria-label="AniRoll rolling a show from a Planning list">
        <div class="landing-stage-glow" aria-hidden="true"></div>
        <div class="landing-stage-frame">
            <video class="landing-video" src="media/roll.mp4" poster="media/roll.jpg" muted loop playsinline preload="metadata"></video>
        </div>
    </div>`;
}

export function renderTour() {
    return `<section class="landing-tour">
        <div class="landing-tour-head">
            <h2 class="landing-tour-title">Everything around your list</h2>
            <p class="landing-tour-sub">AniRoll sits on top of your AniList account. Nothing to import, nothing to keep in sync.</p>
        </div>
        <div class="landing-tour-grid">
            <div class="landing-tour-list" role="tablist" aria-label="Features">
                ${TOUR.map((t, i) => `<button class="landing-tour-item${i ? '' : ' active'}" role="tab" aria-selected="${!i}" data-tour="${t.key}">
                    <span class="landing-tour-item-title">${t.title}</span>
                    <span class="landing-tour-item-text">${t.text}</span>
                    <span class="landing-tour-bar" aria-hidden="true"><span></span></span>
                </button>`).join('')}
            </div>
            <div class="landing-tour-frame">
                ${TOUR.map((t, i) => `<video class="landing-video${i ? '' : ' active'}" data-tour="${t.key}" src="media/${t.key}.mp4" poster="media/${t.key}.jpg" muted playsinline preload="${i ? 'none' : 'metadata'}"></video>`).join('')}
            </div>
        </div>
    </section>`;
}

// The two designs side by side, each with its own clip
export const DESIGNS = [
    { key: 'aniroll', name: 'AniRoll', text: 'Monochrome and cinematic, with one accent colour: pick a swatch or type any hex code.' },
    { key: 'm3', name: 'Material 3 Expressive', text: 'Google’s newest design language, dressed in the colours of the show you watched last. Springy, bright, alive.' },
];

export function renderDesigns() {
    return `<section class="landing-designs">
        <div class="landing-tour-head">
            <h2 class="landing-tour-title">Two looks. Your colours.</h2>
            <p class="landing-tour-sub">Try both right here. Later you switch in Settings, with your own colours in both.</p>
        </div>
        <div class="landing-designs-grid">
            ${DESIGNS.map(d => `<figure class="landing-design landing-design-${d.key}">
                <div class="landing-design-frame">
                    <video class="landing-video" src="media/design-${d.key}.mp4" poster="media/design-${d.key}.jpg" muted loop playsinline preload="none" aria-label="${d.name} design in action"></video>
                </div>
                <figcaption><strong>${d.name}</strong><span>${d.text}</span>
                    <button type="button" class="glass-btn ${getDesign() === d.key ? 'glass-btn-primary' : 'glass-btn-secondary'} landing-design-try" data-try-design="${d.key}" aria-pressed="${getDesign() === d.key}">${getDesign() === d.key ? 'In use' : 'Try this look'}</button>
                </figcaption>
            </figure>`).join('')}
        </div>
    </section>`;
}

// Returns a cleanup for the router
export function initLanding(root) {
    const reduce = prefersReducedMotion();
    const cleanups = [];
    const hasGsap = typeof gsap !== 'undefined';

    // Headline: each word rises out of a blur, then the rest of the hero follows
    if (hasGsap && !reduce) {
        const words = root.querySelectorAll('.landing-title .lw > span');
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
            .from(words, { yPercent: 60, opacity: 0, filter: 'blur(14px)', duration: 0.9, stagger: 0.09, clearProps: 'all' })
            .from(root.querySelectorAll('.landing-sub, .landing-hero .glass-btn'), { y: 18, opacity: 0, duration: 0.7, stagger: 0.08, clearProps: 'all' }, '-=0.45')
            .from(root.querySelector('.landing-stage'), { y: 60, opacity: 0, duration: 1, clearProps: 'opacity' }, '-=0.5');
        cleanups.push(() => tl.kill());

        // The big frame lies tilted back and straightens up while it scrolls into view
        const frame = root.querySelector('.landing-stage-frame');
        if (window.ScrollTrigger && frame) {
            const tilt = gsap.fromTo(frame, { rotateX: 18, scale: 0.9 }, {
                rotateX: 0, scale: 1, ease: 'none',
                scrollTrigger: { trigger: root.querySelector('.landing-stage'), start: 'top 95%', end: 'top 25%', scrub: 0.6 },
            });
            cleanups.push(() => { tilt.scrollTrigger?.kill(); tilt.kill(); });
        }
    }

    // Videos only run while they are on screen
    const stageVideo = root.querySelector('.landing-stage video');
    const visible = new Map();
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) visible.set(e.target, e.isIntersecting);
        syncPlayback();
    }, { threshold: 0.25 });

    const tourFrame = root.querySelector('.landing-tour-frame');
    const items = [...root.querySelectorAll('.landing-tour-item')];
    const videos = [...root.querySelectorAll('.landing-tour-frame video')];
    let current = 0;
    let raf = 0;

    const designVideos = [...root.querySelectorAll('.landing-designs video')];
    function syncPlayback() {
        if (reduce) return;
        designVideos.forEach(v => {
            if (!visible.get(v)) return v.pause();
            if (v.preload === 'none') v.preload = 'auto';
            play(v);
        });
        if (stageVideo) visible.get(stageVideo) ? play(stageVideo) : stageVideo.pause();
        const v = videos[current];
        if (v) visible.get(tourFrame) ? play(v) : v.pause();
    }
    function play(v) { v.play().catch(() => { /* autoplay refused: the poster stays */ }); }

    function select(i, { restart = true } = {}) {
        current = i;
        items.forEach((el, j) => {
            el.classList.toggle('active', j === i);
            el.setAttribute('aria-selected', String(j === i));
            el.querySelector('.landing-tour-bar span').style.transform = 'scaleX(0)';
        });
        videos.forEach((v, j) => {
            v.classList.toggle('active', j === i);
            if (j !== i) v.pause();
        });
        const v = videos[i];
        if (v.preload === 'none') v.preload = 'auto';
        if (restart) { try { v.currentTime = 0; } catch { /* not loaded yet */ } }
        syncPlayback();
    }

    items.forEach((el, i) => el.addEventListener('click', () => select(i)));

    // Try a design before logging in: the page changes right here, the choice is kept for later
    root.querySelectorAll('[data-try-design]').forEach(btn => btn.addEventListener('click', async (e) => {
        const design = btn.dataset.tryDesign;
        const r = btn.getBoundingClientRect();
        const from = { x: e.clientX || r.left + r.width / 2, y: e.clientY || r.top + r.height / 2 };
        await switchDesign(design, false, from);
        root.querySelectorAll('[data-try-design]').forEach(b => {
            const on = b.dataset.tryDesign === design;
            b.className = `glass-btn ${on ? 'glass-btn-primary' : 'glass-btn-secondary'} landing-design-try`;
            b.setAttribute('aria-pressed', String(on));
            b.textContent = on ? 'In use' : 'Try this look';
        });
    }));
    // Arrow keys move between the tabs
    root.querySelector('.landing-tour-list')?.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const next = (current + d + items.length) % items.length;
        select(next);
        items[next].focus();
    });

    if (reduce) {
        [...videos, ...designVideos].forEach(v => { v.controls = true; });
        if (stageVideo) stageVideo.controls = true;
    } else {
        // One after another; the bar under the active item shows how far its clip is
        videos.forEach((v, i) => v.addEventListener('ended', () => { if (i === current) select((i + 1) % videos.length); }));
        const tick = () => {
            const v = videos[current];
            if (v?.duration) items[current].querySelector('.landing-tour-bar span').style.transform = `scaleX(${v.currentTime / v.duration})`;
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        if (hasGsap && window.ScrollTrigger) {
            const reveal = gsap.from(root.querySelectorAll('.landing-tour-head > *, .landing-tour-item, .landing-tour-frame'), {
                y: 40, opacity: 0, filter: 'blur(8px)', duration: 0.8, stagger: 0.08, ease: 'power3.out', clearProps: 'all',
                scrollTrigger: { trigger: root.querySelector('.landing-tour'), start: 'top 80%', once: true },
            });
            cleanups.push(() => { reveal.scrollTrigger?.kill(); reveal.kill(); });
        }
    }

    if (stageVideo) io.observe(stageVideo);
    if (tourFrame) io.observe(tourFrame);
    designVideos.forEach(v => io.observe(v));
    if (hasGsap && window.ScrollTrigger && !reduce) {
        const designs = gsap.from(root.querySelectorAll('.landing-designs .landing-tour-head > *, .landing-design'), {
            y: 48, opacity: 0, filter: 'blur(8px)', duration: 0.9, stagger: 0.1, ease: 'power3.out', clearProps: 'all',
            scrollTrigger: { trigger: root.querySelector('.landing-designs'), start: 'top 80%', once: true },
        });
        cleanups.push(() => { designs.scrollTrigger?.kill(); designs.kill(); });
    }
    cleanups.push(() => { io.disconnect(); cancelAnimationFrame(raf); root.querySelectorAll('video').forEach(v => v.pause()); });

    return () => cleanups.forEach(fn => fn());
}
