// Home in AniRoll's own design: the show you're on, then a stats box. Same idea as Material 3's hero and widgets
// (js/m3.js), built from AniRoll's own pieces so it reads like the rest of the app: the detail page's banner,
// cover and stats box, Roll's red kicker, the usual pill buttons. Material 3 hides this section.
import * as api from './api.js?v=120';
import { esc, titlePref } from './store.js?v=120';
import { prefersReducedMotion } from './animations.js?v=120';
import { upNext, glance, greeting } from './upnext.js?v=120';

const imgOf = (m) => m?.coverImage?.extraLarge || m?.coverImage?.large || '';

let clockTimer = 0;
let untilAt = 0;

export function renderCinema(section, entries, name) {
    if (!section) return () => {};
    const first = entries[0];
    const before = section.querySelector('.ar-home-head') ? 'shown' : null;
    section.hidden = false;
    section.innerHTML = `${first ? heroHtml(first, name) : emptyHtml(name)}${entries.length ? stripHtml(entries) : ''}`;
    if (!prefersReducedMotion()) animateIn(section, before);
    startClock(section);
    return stop;
}

export function stop() {
    clearInterval(clockTimer);
    clockTimer = 0;
}

function heroHtml(entry, name) {
    const { m, next, total, progress, done, status, canWatch } = upNext(entry);
    const pct = total ? Math.min(100, progress / total * 100) : 0;
    const title = titlePref(m.title);
    const tags = [
        m.format ? api.formatFormat(m.format) : '',
        total ? `${progress} / ${total} watched` : progress ? `${progress} watched` : '',
        ...(m.genres || []).slice(0, 2),
    ].filter(Boolean);
    return `${m.bannerImage ? `<div class="ar-home-banner" aria-hidden="true">
            <img class="ar-home-banner-img" src="${esc(m.bannerImage)}" alt="">
            <div class="detail-banner-gradient"></div>
        </div>` : ''}
        <div class="ar-home-head${m.bannerImage ? '' : ' no-banner'}" data-media-id="${m.id}">
            <div class="detail-cover ar-home-cover"><img src="${esc(imgOf(m))}" alt="${esc(title)}"></div>
            <div class="detail-info ar-home-info">
                <div class="roll-result-kicker">${done ? 'All caught up' : `Up next · Episode ${next}${total ? ` of ${total}` : ''}`}</div>
                <h2 class="detail-title">${esc(title)}</h2>
                <div class="detail-sub">${esc(greeting())}${name ? `, ${esc(name)}` : ''}${status ? ` · ${esc(status)}` : ''}</div>
                <div class="detail-meta">${tags.map(t => `<span class="detail-tag">${esc(t)}</span>`).join('')}</div>
                ${total ? `<div class="ar-home-progress" aria-label="${progress} of ${total} episodes watched"><span style="width:${pct}%"></span></div>` : ''}
                <div class="detail-actions">
                    ${canWatch ? `<button class="glass-btn glass-btn-primary" data-ar-inc="${entry.id}">Watched episode ${next}</button>` : ''}
                    <button class="glass-btn glass-btn-secondary" data-open="${m.id}">Details</button>
                </div>
            </div>
        </div>`;
}

function emptyHtml(name) {
    return `<div class="ar-home-head no-banner">
        <div class="detail-info ar-home-info">
            <div class="roll-result-kicker">${esc(greeting())}${name ? `, ${esc(name)}` : ''}</div>
            <h2 class="detail-title">Nothing on the go</h2>
            <div class="detail-sub">Let AniRoll pick tonight's show from your Planning list.</div>
            <div class="detail-actions"><a class="glass-btn glass-btn-primary" href="#/roll">Roll something</a></div>
        </div>
    </div>`;
}

// The detail page's stats box: values centred, the countdown is the one in the accent colour
function stripHtml(entries) {
    const { next, airing, waitingTotal } = glance(entries);
    untilAt = next ? next.media.nextAiringEpisode.airingAt : 0;
    const stat = (value, label, attrs = '') => `<div class="detail-stat"${attrs}><div class="detail-stat-value">${value}</div><div class="detail-stat-label">${label}</div></div>`;
    return `<div class="box detail-stats ar-home-stats">
        ${next ? `<button class="detail-stat ar-home-stat" data-open="${next.media.id}" title="${esc(titlePref(next.media.title))}">
            <div class="detail-stat-value ar-clock" style="color:var(--user-accent)"></div>
            <div class="detail-stat-label">Until episode ${next.media.nextAiringEpisode.episode}</div>
            <div class="ar-home-stat-title">${esc(titlePref(next.media.title))}</div>
        </button>` : stat('—', 'Nothing airing')}
        <a class="detail-stat ar-home-stat" href="#/list"><div class="detail-stat-value">${waitingTotal}</div><div class="detail-stat-label">Ready to watch</div></a>
        <a class="detail-stat ar-home-stat" href="#/calendar"><div class="detail-stat-value">${airing.length}</div><div class="detail-stat-label">Airing this week</div></a>
        <a class="detail-stat ar-home-stat" href="#/list"><div class="detail-stat-value">${entries.length}</div><div class="detail-stat-label">Watching</div></a>
    </div>`;
}

// The countdown ticks every second: 2d 04:12:09
function startClock(section) {
    stop();
    const el = section.querySelector('.ar-clock');
    if (!el || !untilAt) return;
    const tick = () => {
        if (!el.isConnected) return stop();
        const left = Math.max(0, untilAt - Date.now() / 1000);
        const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = Math.floor(left % 60);
        const pad = (n) => String(n).padStart(2, '0');
        el.textContent = `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
    };
    tick();
    clockTimer = setInterval(tick, 1000);
}

// The banner settles, the header and the stats rise in (the same rhythm as the rest of the app)
function animateIn(section, before) {
    if (typeof gsap === 'undefined' || before != null) return;
    gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from(section.querySelectorAll('.ar-home-banner-img'), { scale: 1.08, duration: 1.6, ease: 'power2.out', clearProps: 'transform' }, 0)
        .from(section.querySelectorAll('.ar-home-cover'), { y: 30, opacity: 0, duration: 0.8, clearProps: 'all' }, 0.1)
        .from(section.querySelectorAll('.ar-home-info > *'), { y: 18, opacity: 0, duration: 0.6, stagger: 0.06, clearProps: 'all' }, 0.2)
        .from(section.querySelectorAll('.ar-home-progress span'), { width: 0, duration: 1, ease: 'power2.inOut', clearProps: 'width' }, 0.5)
        .from(section.querySelectorAll('.ar-home-stat, .ar-home-stats > .detail-stat'), { y: 20, opacity: 0, duration: 0.6, stagger: 0.07, clearProps: 'all' }, 0.45);
}
