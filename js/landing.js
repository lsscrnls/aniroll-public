import { prefersReducedMotion, lenisScrollTo } from './animations.js?v=138';
import { SEEDS, SHOW_SEED, previewSeed, reveal } from './design.js?v=138';

// The landing page, in Material 3 Expressive (the only design logged out): the headline arrives word by word,
// covers of what's trending pop into shaped tiles, the big clip tilts upright while it scrolls in, and the
// feature tour plays one clip after another. Clips (media/*.mp4) are recorded with tools/showcase.
// "Reduce motion": everything is shown at once, clips don't autoplay (posters + controls instead).

export const TOUR = [
    { key: 'list', title: 'Your list, one tap away', text: 'Covers first, +1 right on the card, search, sort and an “Airing” filter.' },
    { key: 'calendar', title: 'The week at a glance', text: 'Air times, finales and where you stand on every show — or everything that airs.' },
    { key: 'match', title: 'A match that knows your taste', text: 'Built only from your own scores, genres and tags, with the show it’s based on.' },
    { key: 'player', title: 'Play from your Jellyfin', text: 'Your own server, right here: subtitles as the release styled them, Skip intro, and your list moves on by itself.' },
];

// Shaped tiles for the hero, as Material 3 does it: pictures in calm shapes that suit a portrait poster
// (arch, squircle, a soft 12-scallop), the playful shapes only as colour; covers from what's trending
const TILES = [
    { shape: 'arch', img: true }, { shape: 'squircle', img: true }, { shape: 'cookie12', img: true },
    { shape: 'flower' }, { shape: 'sunny' }, { shape: 'clover4' },
];
export function renderCollage() {
    return `<div class="lp-collage" aria-hidden="true">
        ${TILES.map((t, i) => `<span class="lp-tile lp-tile-${i + 1} lp-shape-${t.shape}${t.img ? ' lp-tile-img' : ''}"></span>`).join('')}
    </div>`;
}
export function fillCollage(root, media) {
    const tiles = [...root.querySelectorAll('.lp-tile-img')];
    media.filter(m => m.coverImage?.extraLarge || m.coverImage?.large).slice(0, tiles.length).forEach((m, i) => {
        const url = m.coverImage.extraLarge || m.coverImage.large;
        const img = new Image();
        img.onload = () => { tiles[i].style.backgroundImage = `url("${url.replace(/"/g, '')}")`; tiles[i].classList.add('has-cover'); };
        img.src = url;
    });
}

// Material 3 takes its colours from the show you watched last: the clip shows it, and each shape below it
// turns the whole page into its palette for a look (nothing is kept)
const SWATCH_SHAPES = ['cookie9', 'flower', 'clover4', 'cookie12', 'sunny', 'arch', 'burst', 'squircle'];
export function renderColour() {
    return `<section class="lp-colour">
        <div class="lp-colour-text">
            <h2 class="landing-tour-title">In the colours of what you watch</h2>
            <p class="landing-tour-sub">Finish an episode and AniRoll takes on its colours: the cover becomes your wallpaper, every surface follows. Or pick a palette of your own.</p>
            <div class="lp-swatches" role="group" aria-label="Try a palette">
                <button type="button" class="lp-swatch-reset" data-preview-seed="" aria-pressed="true">From the show</button>
                ${SEEDS.filter(x => x.hex !== SHOW_SEED).map((x, i) => `<button type="button" class="lp-swatch lp-shape-${SWATCH_SHAPES[i % SWATCH_SHAPES.length]}" style="--c:${x.hex}" data-preview-seed="${x.hex}" aria-pressed="false" aria-label="${x.name}" title="${x.name}"></button>`).join('')}
            </div>
        </div>
        <div class="lp-colour-frame">
            <video class="landing-video" src="media/m3.mp4" poster="media/m3.jpg" muted loop playsinline preload="none" aria-label="AniRoll taking on the colours of a show"></video>
        </div>
    </section>`;
}

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
    return `<section class="landing-tour" id="lp-tour">
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
            .from(root.querySelectorAll('.lp-eyebrow, .landing-sub, .lp-actions > *'), { y: 18, opacity: 0, duration: 0.7, stagger: 0.08, clearProps: 'all' }, '-=0.45')
            // The shaped tiles pop in one after another, a little turned, and spring into place
            // (only its own properties are cleared: the cover is an inline background image)
            .from(root.querySelectorAll('.lp-tile'), { scale: 0.4, rotate: -25, opacity: 0, duration: 0.9, stagger: 0.07, ease: 'back.out(1.8)', clearProps: 'transform,opacity' }, '-=0.9')
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

    const designVideos = [...root.querySelectorAll('.lp-colour video')];
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

    // The palette shapes: the page takes on the picked colours, spreading from the shape
    const swatches = [...root.querySelectorAll('[data-preview-seed]')];
    let previewing = false;
    swatches.forEach(btn => btn.addEventListener('click', (e) => {
        const hex = btn.dataset.previewSeed || null;
        swatches.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        const r = btn.getBoundingClientRect();
        previewing = !!hex;
        reveal(() => previewSeed(hex), { x: e.clientX || r.left + r.width / 2, y: e.clientY || r.top + r.height / 2 });
    }));
    cleanups.push(() => { if (previewing) previewSeed(null); });

    // "See what's inside": down to the tour (a hash link would go to the router)
    root.querySelector('[data-scroll-to]')?.addEventListener('click', (e) => {
        const target = document.getElementById(e.currentTarget.dataset.scrollTo);
        if (!target) return;
        lenisScrollTo(target, { offset: -80 });
    });

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
        const designs = gsap.from(root.querySelectorAll('.lp-colour-text > *, .lp-colour-frame'), {
            y: 48, opacity: 0, filter: 'blur(8px)', duration: 0.9, stagger: 0.1, ease: 'power3.out', clearProps: 'all',
            scrollTrigger: { trigger: root.querySelector('.lp-colour'), start: 'top 80%', once: true },
        });
        cleanups.push(() => { designs.scrollTrigger?.kill(); designs.kill(); });
    }
    cleanups.push(() => { io.disconnect(); cancelAnimationFrame(raf); root.querySelectorAll('video').forEach(v => v.pause()); });

    return () => cleanups.forEach(fn => fn());
}
