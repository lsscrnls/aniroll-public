import { esc } from './store.js?v=160';

// What Jellyfin is playing right now (from the webhook state in js/jellyfin.js):
// the chip in the navbar and the card on Home.
const PLAY_ICON = '<svg data-icon="play_arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const TICKS_PER_MIN = 600000000;

export function sessionTitle(s) {
    return s.match?.title || (s.type === 'Movie' ? s.name : s.series) || s.name || 'Jellyfin';
}

export function sessionEpisode(s) {
    if (s.type === 'Movie') return 'Movie';
    const ep = s.episodeEnd && s.episodeEnd !== s.episode ? `${s.episode}–${s.episodeEnd}` : (s.episode ?? '?');
    return `${s.season > 1 ? `Season ${s.season} · ` : ''}Episode ${ep}`;
}

export function nowLabel(s) {
    return s.type === 'Movie' ? sessionTitle(s) : `${sessionTitle(s)} · E${s.episode ?? '?'}`;
}

function trackingText(s, trackAt) {
    if (s.tracked === 'saved') return s.rewatch ? 'Saved to AniList as a rewatch' : 'Saved to AniList';
    if (s.tracked === 'already') return 'Already on your AniList';
    if (s.tracked === 'completed') {
        return s.type === 'Movie' ? 'Already counted as watched today' : 'Completed before, play episode 1 to track a rewatch';
    }
    if (s.tracked === 'pending' || s.tracked === 'saving') return 'Saving to AniList soon';
    if (s.tracked === 'unmatched' || s.unmatched === 'not-found') return 'Not found on AniList, not tracked';
    if (s.unmatched === 'private') return 'Your AniList is private, cannot match it';
    if (!s.match) return 'Looking it up on AniList';
    if (s.stopped) return 'Stopped before the end, not tracked';
    return `Counts toward AniList at ${Math.round(trackAt * 100)}%`;
}

// Not matched on AniList: a series can be linked by hand (movies cannot, they have no episodes to offset)
const unmatched = (s) => s.type === 'Episode' && (s.tracked === 'unmatched' || s.unmatched === 'not-found');

function minutesLeft(s) {
    if (!s.runtime || s.stopped) return '';
    const min = Math.max(0, Math.round((s.runtime - s.position) / TICKS_PER_MIN));
    return min ? `${min} min left` : '';
}

export function renderNowChip(chip, state) {
    if (!chip) return;
    const s = state?.sessions?.find(x => !x.stopped);
    chip.hidden = !s;
    if (!s) return;
    chip.classList.toggle('paused', s.paused);
    chip.querySelector('.jf-now-chip-text').textContent = nowLabel(s);
    chip.title = `${s.paused ? 'Paused' : 'Watching'} on ${s.device || 'Jellyfin'}${s.client ? ` (${s.client})` : ''}`;
    chip.setAttribute('aria-label', `${chip.title}: ${nowLabel(s)}`);
    chip.onclick = () => {
        if (s.match && window.__openDetailPanel) window.__openDetailPanel(s.match.mediaId);
        else window.location.hash = '#/settings?tab=jellyfin';
    };
}

export function renderNowCard(section, state) {
    if (!section) return;
    const s = state?.sessions?.[0];
    section.hidden = !s;
    if (!s) {
        section.innerHTML = '';
        return;
    }
    const trackAt = state.trackAt || 0.9;
    const pct = s.runtime ? Math.min(100, Math.round((s.position / s.runtime) * 100)) : 0;
    const done = s.tracked === 'saved' || s.tracked === 'already' || s.tracked === 'completed';
    const kicker = s.stopped ? 'Just watched on Jellyfin' : s.paused ? 'Paused on Jellyfin' : 'Now watching on Jellyfin';
    const epName = s.type === 'Episode' && s.name && !/^episode\s*\d+$/i.test(s.name) ? ` · ${s.name}` : '';
    const meta = [trackingText(s, trackAt), minutesLeft(s), s.device].filter(Boolean).join(' · ');

    section.innerHTML = `<div class="jf-now-card${s.paused || s.stopped ? ' paused' : ''}${done ? ' done' : ''}"${s.match ? ` data-media-id="${s.match.mediaId}" role="button" tabindex="0"` : ''}>
        ${s.match?.cover
            ? `<img class="jf-now-cover" src="${esc(s.match.cover)}" alt="">`
            : `<div class="jf-now-cover">${PLAY_ICON}</div>`}
        <div class="jf-now-body">
            <div class="jf-now-kicker"><span class="jf-now-dot"></span>${esc(kicker)}</div>
            <div class="jf-now-title">${esc(sessionTitle(s))}</div>
            <div class="jf-now-sub">${esc(sessionEpisode(s) + epName)}</div>
            <div class="jf-now-bar" style="--p:${pct}%;--pn:${pct / 100}" title="${pct}%"><span></span><i style="left:${Math.round(trackAt * 100)}%"></i></div>
            <div class="jf-now-meta">${esc(meta)}</div>
            ${unmatched(s) ? `<button type="button" class="glass-btn glass-btn-sm glass-btn-secondary jf-now-link">Link to AniList</button>` : ''}
        </div>
    </div>`;
    section.querySelector('.jf-now-link')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const { openLinkDialog } = await import('./jflink-dialog.js?v=160');
        openLinkDialog(s);
    });

    const card = section.querySelector('[data-media-id]');
    const open = () => window.__openDetailPanel?.(Number(card.dataset.mediaId));
    card?.addEventListener('click', open);
    card?.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
}
