import * as api from './api.js?v=141';
import { esc, titlePref, toast } from './store.js?v=141';
import { getToken } from './auth.js?v=141';
import { openDialog } from './a11y.js?v=141';
import { getConfig, jfAuth } from './jellyfin.js?v=141';
import { setLink } from './jflinks.js?v=141';

// "Link to AniList" for a Jellyfin series the title rules could not match: search AniList (on demand,
// one request per search), pick the entry, say which Jellyfin episode is its first. session: a now
// playing item from the webhook ({ itemId, series, season, episode })
export async function openLinkDialog(session) {
    const container = document.getElementById('modal-container');
    const cfg = getConfig();
    if (!container || !cfg) return;
    container.hidden = false;
    container.innerHTML = `<div class="modal-backdrop">
        <div class="modal-content jf-link" style="max-width:520px">
            <h3 class="modal-title">Link to AniList</h3>
            <p class="jf-link-text">Jellyfin: <strong>${esc(session.series || session.name || '')}</strong>${session.season > 1 ? `, season ${session.season}` : ''}. Pick the AniList entry it is.</p>
            <form class="jf-link-search"><input class="glass-input" name="q" value="${esc(session.series || session.name || '')}" aria-label="Search AniList" autocomplete="off">
                <button class="glass-btn glass-btn-secondary" type="submit">Search</button></form>
            <div class="jf-link-results" role="listbox" aria-label="AniList entries"></div>
            <label class="jf-link-offset">The entry's first episode is Jellyfin episode
                <input class="glass-input" type="number" min="1" max="2000" value="1" name="first" style="width:80px"></label>
            <div style="display:flex;gap:var(--space-sm);justify-content:flex-end;margin-top:var(--space-md)">
                <button class="glass-btn glass-btn-secondary" id="modal-cancel">Cancel</button>
                <button class="glass-btn glass-btn-primary" id="modal-confirm" disabled>Link</button>
            </div>
        </div>
    </div>`;
    const box = container.querySelector('.jf-link');
    const results = box.querySelector('.jf-link-results');
    const confirm = box.querySelector('#modal-confirm');
    let picked = null;
    const release = openDialog(box, { label: 'Link to AniList', onClose: () => close(), focus: 'input[name="q"]' });
    function close() {
        release();
        container.hidden = true;
        container.innerHTML = '';
    }

    async function search(q) {
        if (q.trim().length < 2) return;
        results.innerHTML = '<div class="activity-replies-status">Searching…</div>';
        try {
            const data = await api.searchMedia(q.trim(), 'ANIME', 1, 8, getToken());
            results.innerHTML = (data.media || []).map(m => `<button type="button" class="jf-link-item" role="option" aria-selected="false" data-id="${m.id}">
                <img src="${esc(m.coverImage?.large || '')}" alt="" loading="lazy">
                <span><strong>${esc(titlePref(m.title))}</strong><small>${[api.formatFormat(m.format), m.seasonYear || m.startDate?.year, m.episodes ? `${m.episodes} Ep` : ''].filter(Boolean).join(' · ')}</small></span>
            </button>`).join('') || '<div class="activity-replies-status">Nothing found</div>';
        } catch (err) {
            results.innerHTML = `<div class="activity-replies-status">${esc(err.message)}</div>`;
        }
    }
    box.querySelector('.jf-link-search').addEventListener('submit', (ev) => {
        ev.preventDefault();
        search(ev.target.q.value);
    });
    results.addEventListener('click', (ev) => {
        const item = ev.target.closest('.jf-link-item');
        if (!item) return;
        results.querySelectorAll('.jf-link-item').forEach(x => x.setAttribute('aria-selected', String(x === item)));
        picked = Number(item.dataset.id);
        confirm.disabled = false;
    });
    box.querySelector('#modal-cancel').addEventListener('click', close);
    container.querySelector('.modal-backdrop').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) close(); });
    confirm.addEventListener('click', async () => {
        if (!picked) return;
        confirm.disabled = true;
        const first = Math.max(1, parseInt(box.querySelector('input[name="first"]').value, 10) || 1);
        // The series' id in Jellyfin, so the player finds it without searching
        let seriesId = null;
        try {
            const { availability } = await import('./player/availability.js?v=141');
            const avail = await availability();
            if (avail && session.itemId) {
                const res = await fetch(`${avail.base}/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(session.itemId)}`,
                    { headers: jfAuth(cfg.apiKey), signal: AbortSignal.timeout(6000) });
                if (res.ok) seriesId = (await res.json()).SeriesId || null;
            }
        } catch { /* the webhook and the sync still use the link */ }
        setLink(session.series, session.season ?? 1, picked, first - 1, seriesId);
        toast('Linked. AniRoll tracks it from the next episode on', 'success');
        close();
    });
    search(session.series || session.name || '');
}
