import * as api from '../api.js?v=133';
import { esc, titlePref } from '../store.js?v=133';
import { getToken } from '../auth.js?v=133';
import { openDialog } from '../a11y.js?v=133';
import { listEpisodes } from './library.js?v=133';

// "Episodes": every episode of a show that Jellyfin has, to start any of them — a rewatch, one skipped,
// one further back than where the list stands. AniList keeps each season as its own entry, so the
// seasons before and after are chips that switch the list over; what plays is tracked on that entry.
//   openEpisodes(media, base)   media: AniList media with relations and mediaListEntry
//   neighbours(media)           { before, after }: the prequel and sequel seasons (the player's end card)
const TICKS = 10_000_000;
const chevron = (dir) => `<svg data-icon="chevron_${dir}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px"><path d="${dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'}"/></svg>`;
const SEASON_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'OVA']);

// The directly neighbouring seasons: a prequel and a sequel that are series themselves
export function neighbours(media) {
    const edges = (media.relations?.edges || []).filter(e => e.node?.type === 'ANIME' && SEASON_FORMATS.has(e.node.format));
    return {
        before: edges.find(e => e.relationType === 'PREQUEL')?.node || null,
        after: edges.find(e => e.relationType === 'SEQUEL')?.node || null,
    };
}

// The episode Play would start: one past the list's progress, the first one when there is none.
// A finished show has none to point out: every episode is as good a start as any
function upNext(media) {
    const entry = media.mediaListEntry;
    if (entry?.status === 'COMPLETED') return null;
    if (!entry) return 1;
    const n = (entry.progress || 0) + 1;
    return media.episodes ? Math.min(n, media.episodes) : n;
}

const minutes = (ticks) => (ticks >= 60 * TICKS ? `${Math.round(ticks / TICKS / 60)} min` : '');

function rowHtml(media, ep, next) {
    const watched = ep.played || ep.episode <= (media.mediaListEntry?.progress || 0);
    const pct = !ep.played && ep.positionTicks && ep.runTimeTicks ? Math.min(100, (ep.positionTicks / ep.runTimeTicks) * 100) : 0;
    const number = ep.episodeEnd ? `${ep.episode}–${ep.episodeEnd}` : `${ep.episode}`;
    const name = ep.name && !/^episode \d+$/i.test(ep.name) ? ep.name : `Episode ${number}`;
    const meta = [minutes(ep.runTimeTicks), watched ? 'Watched' : pct ? 'Started' : ''].filter(Boolean).join(' · ');
    return `<a class="ep-row${ep.episode === next ? ' is-next' : ''}${watched ? ' is-watched' : ''}" href="#/play/${media.id}/${ep.episode}">
        <span class="ep-thumb">${ep.image ? `<img src="${esc(ep.image)}" alt="" loading="lazy" decoding="async">` : ''}
            ${pct ? `<span class="progress-bar ep-progress"><span class="progress-bar-fill" style="width:${pct}%"></span></span>` : ''}</span>
        <span class="ep-text">
            <span class="ep-title"><span class="ep-number">${esc(number)}</span>${esc(name)}</span>
            <span class="ep-meta">${ep.episode === next ? '<span class="ep-next">Up next</span>' : ''}${esc(meta)}</span>
        </span>
    </a>`;
}

export function openEpisodes(media, base) {
    const container = document.getElementById('modal-container');
    if (!container) return;
    container.hidden = false;
    container.innerHTML = `<div class="modal-backdrop">
        <div class="modal-content ep-dialog">
            <div class="ep-head">
                <h3 class="modal-title ep-heading"></h3>
                <button class="glass-btn glass-btn-secondary glass-btn-sm ep-close" data-close aria-label="Close">Close</button>
            </div>
            <div class="ep-seasons"></div>
            <div class="ep-list" aria-live="polite"></div>
        </div>
    </div>`;
    const box = container.querySelector('.ep-dialog');
    const list = box.querySelector('.ep-list');
    let ticket = 0;

    const close = () => {
        release();
        window.removeEventListener('hashchange', close);
        container.hidden = true;
        container.innerHTML = '';
    };
    const release = openDialog(box, { label: 'Episodes', onClose: close, focus: '.ep-row.is-next, .ep-row' });
    // Picking an episode navigates; the dialog goes with the page it was opened on
    window.addEventListener('hashchange', close);
    container.querySelector('.modal-backdrop').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) close(); });
    box.querySelector('[data-close]').addEventListener('click', close);

    async function show(m) {
        const mine = ++ticket;
        box.querySelector('.ep-heading').textContent = titlePref(m.title);
        const { before, after } = neighbours(m);
        box.querySelector('.ep-seasons').innerHTML = [
            before && `<button class="glass-btn glass-btn-secondary glass-btn-sm" data-season="${before.id}">${chevron('left')}${esc(titlePref(before.title))}</button>`,
            after && `<button class="glass-btn glass-btn-secondary glass-btn-sm is-after" data-season="${after.id}">${esc(titlePref(after.title))}${chevron('right')}</button>`,
        ].filter(Boolean).join('');
        list.innerHTML = '<div class="ep-empty"><div class="loader-spinner"></div></div>';
        let eps = [];
        try { eps = await listEpisodes(base, m); } catch { /* shown as empty */ }
        if (mine !== ticket || !box.isConnected) return;
        const next = upNext(m);
        list.innerHTML = eps.length
            ? eps.map(ep => rowHtml(m, ep, next)).join('')
            : '<p class="ep-empty">None of its episodes are in your Jellyfin library.</p>';
        list.querySelector('.ep-row.is-next')?.scrollIntoView({ block: 'center' });
    }

    box.querySelector('.ep-seasons').addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-season]');
        if (!btn) return;
        btn.disabled = true;
        try {
            // The detail query brings relations and the list entry, and it is cached
            const other = await api.getMedia(Number(btn.dataset.season), getToken());
            if (box.isConnected) await show(other);
        } catch {
            btn.disabled = false;
        }
    });

    show(media);
}
