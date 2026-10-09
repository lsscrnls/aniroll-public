import { prefersReducedMotion, lenisScrollTo } from './animations.js?v=157';
import { SEEDS, SHOW_SEED, previewSeed, reveal } from './design.js?v=157';

// The landing page, in Material 3 Expressive (the only design logged out): the headline arrives word by word,
// a roll to try sits next to it, the feature tour plays one clip after another, and Watch Party shows up as the
// invite people actually get. Clips (media/*.mp4) are recorded with tools/showcase.
// "Reduce motion": everything is shown at once, clips don't autoplay (posters + controls instead).

export const TOUR = [
    { key: 'list', title: 'Your list, one tap away', text: 'Covers first, +1 right on the card, search, sort and an “Airing” filter.' },
    { key: 'calendar', title: 'The week at a glance', text: 'Air times, finales and where you stand on every show — or everything that airs.' },
    { key: 'match', title: 'A match that knows your taste', text: 'Built only from your own scores, genres and tags, with the show it’s based on.' },
    { key: 'player', title: 'Play from your Jellyfin', text: 'Your own server, right here: subtitles as the release styled them, Skip intro, and your list moves on by itself.' },
];

// The hero's right half is the thing itself: a roll to try, over this week's trending shows (logged in it rolls
// the Planning list). Two colour shapes sit behind the reel; the window shows a cover before the first roll
export function renderMachine() {
    return `<div class="lp-machine" id="landing-try">
        <span class="lp-tile lp-tile-a lp-shape-flower" aria-hidden="true"></span>
        <span class="lp-tile lp-tile-b lp-shape-sunny" aria-hidden="true"></span>
        <div class="roll-window lp-machine-window" id="try-window"><div class="roll-reel" id="try-reel"></div></div>
        <button class="lp-btn lp-btn-filled lp-machine-btn" id="try-roll" type="button" disabled>Roll a show</button>
        <p class="lp-machine-result" id="try-result" role="status">Can’t decide? Roll one of this week’s trending shows.</p>
    </div>`;
}

// Watch Party, shown the way people meet it: an invite pasted in a chat, with the preview AniRoll's link
// unfurls into (same wording as the server's /w/ preview)
export function renderParty() {
    return `<section class="lp-party" aria-labelledby="lp-party-title">
        <div class="lp-party-text">
            <h2 class="landing-tour-title" id="lp-party-title">Watch together, wherever your friends are</h2>
            <p class="landing-tour-sub">Start a Watch Party and paste the link. The host counts the episodes, and everyone’s AniList follows, even with the tab closed.</p>
            <ul class="lp-party-points">
                <li>Join from the invite or right from the player</li>
                <li>Vote on what to watch next</li>
                <li>Write a post about it when the party ends</li>
            </ul>
        </div>
        <figure class="lp-invite" aria-label="A Watch Party invite as it looks in a chat">
            <div class="lp-invite-msg">
                <span class="lp-invite-avatar" aria-hidden="true">M</span>
                <div class="lp-invite-body">
                    <div class="lp-invite-name">Mika</div>
                    <p class="lp-invite-text">Episode 5 tonight? <span class="lp-invite-link">aniroll.app/w/mika</span></p>
                    <div class="lp-invite-embed">
                        <div class="lp-invite-site">AniRoll</div>
                        <div class="lp-invite-title">Mika is hosting a Watch Party</div>
                        <p class="lp-invite-desc"><span class="lp-invite-show">Frieren</span> · at episode 5 · 3 watching. Join and your episode counter follows along.</p>
                        <span class="lp-invite-cover" aria-hidden="true"></span>
                    </div>
                </div>
            </div>
        </figure>
    </section>
    <section class="lp-also">
        <p><strong>Tracked from your own Jellyfin.</strong> Watch on your server, in any app, and the episode lands on your AniList by itself.</p>
        <p><strong>Friends in the loop.</strong> See what the people you follow are watching, reply, like and compare lists.</p>
    </section>`;
}
// The invite shows a real cover: the first trending show the page loaded anyway
export function fillInvite(root, media) {
    const m = media.find(x => x.coverImage?.large);
    const cover = root.querySelector('.lp-invite-cover');
    if (!m || !cover) return;
    cover.style.backgroundImage = `url("${m.coverImage.large.replace(/"/g, '')}")`;
    const title = m.title?.english || m.title?.romaji;
    if (title) root.querySelector('.lp-invite-show').textContent = title;
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
        <div class="lp-colour-frame" style="background-image:url(media/m3.jpg)">
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
            <div class="landing-tour-frame" style="background-image:url(media/${TOUR[0].key}.jpg)">
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
            .from(root.querySelectorAll('.lp-machine-window, .lp-machine-btn'), { y: 30, opacity: 0, duration: 0.8, stagger: 0.08, clearProps: 'transform,opacity' }, '-=0.8');
        cleanups.push(() => tl.kill());
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
