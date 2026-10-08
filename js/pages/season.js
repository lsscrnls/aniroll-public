import * as api from '../api.js?v=151';
import { enhanceSelect } from '../select.js?v=151';
import { renderMediaCard, esc, renderPageSwitch, toast } from '../store.js?v=151';
import { getToken } from '../auth.js?v=151';

// TV counts TV shorts too, as on My List
const FORMATS = { TV: ['TV', 'TV_SHORT'], MOVIE: ['MOVIE'], OVA: ['OVA'], ONA: ['ONA'], SPECIAL: ['SPECIAL'] };
const FORMAT_LABELS = { TV: 'TV', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' };

export async function render({ params, content }) {
    const token = getToken();
    let season = params.season?.toUpperCase() || api.getCurrentSeason();
    let year = parseInt(params.year) || new Date().getFullYear();
    let sort = 'POPULARITY_DESC';

    content.innerHTML = `<div class="page-enter discover-page">
        ${renderPageSwitch('season')}
        <h1 class="section-title season-title" style="margin-bottom:var(--space-lg)">Season</h1>
        <div class="season-controls">
            <button class="season-nav-btn" id="prev-season">
                <svg data-icon="chevron_left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="season-label" id="season-label">${api.getSeasonName(season)} ${year}</span>
            <button class="season-nav-btn" id="next-season">
                <svg data-icon="chevron_right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <select class="glass-select" id="season-sort">
                <option value="POPULARITY_DESC">Popularity</option>
                <option value="SCORE_DESC">Score</option>
                <option value="TRENDING_DESC">Trending</option>
                <option value="START_DATE">Start Date</option>
            </select>
        </div>
        <div class="list-formats season-formats" id="season-formats" role="group" aria-label="Format">${Object.keys(FORMATS).map(f =>
            `<button class="list-chip" data-format="${f}" aria-pressed="false">${FORMAT_LABELS[f]}</button>`).join('')}
            <button class="list-chip" id="season-not-listed" aria-pressed="false" title="Only shows that are not on your list">Not on my list</button></div>
        <div id="season-grid" class="media-grid media-grid-lg"></div>
        <div class="season-more" id="season-more" hidden><button class="glass-btn glass-btn-secondary" id="season-more-btn">Show more</button></div>
    </div>`;

    let shown = [];
    let page = 1;
    let hasNext = false;
    let format = 'ALL';
    let notListed = false;
    const visible = () => shown.filter(m => (format === 'ALL' || FORMATS[format].includes(m.format)) && (!notListed || !m.mediaListEntry));
    function paintGrid() {
        const grid = document.getElementById('season-grid');
        if (!grid) return;
        const list = visible();
        grid.innerHTML = list.map(m => renderMediaCard(m, true)).join('')
            || `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-sub">${shown.length ? 'Nothing matches these filters' : 'No anime for this season'}</div></div>`;
        document.getElementById('season-more').hidden = !hasNext;
        // Only the formats this season has
        const present = new Set(shown.map(m => m.format));
        document.querySelectorAll('#season-formats [data-format]').forEach(b => {
            b.hidden = !FORMATS[b.dataset.format].some(f => present.has(f));
            b.classList.toggle('active', b.dataset.format === format);
            b.setAttribute('aria-pressed', String(b.dataset.format === format));
        });
    }
    document.getElementById('season-formats')?.addEventListener('click', (ev) => {
        const chip = ev.target.closest('[data-format]');
        if (chip) { format = format === chip.dataset.format ? 'ALL' : chip.dataset.format; paintGrid(); return; }
        const nl = ev.target.closest('#season-not-listed');
        if (nl) { notListed = !notListed; nl.classList.toggle('active', notListed); nl.setAttribute('aria-pressed', String(notListed)); paintGrid(); }
    });
    document.getElementById('season-not-listed').hidden = !getToken();
    document.getElementById('season-more-btn')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
            const next = await api.getSeason(season, year, sort, token, page + 1);
            page++;
            const ids = new Set(shown.map(m => m.id));
            shown = shown.concat(next.media.filter(m => !ids.has(m.id)));
            hasNext = next.hasNext;
            paintGrid();
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    });

    async function loadSeason() {
        const grid = document.getElementById('season-grid');
        const label = document.getElementById('season-label');
        if (!grid || !label) return;

        label.textContent = `${api.getSeasonName(season)} ${year}`;
        grid.innerHTML = Array(12).fill('<div class="skeleton skeleton-card"></div>').join('');

        try {
            const first = await api.getSeason(season, year, sort, token);
            shown = first.media;
            hasNext = first.hasNext;
            page = 1;
            paintGrid();
        } catch (err) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
        }
    }

    document.getElementById('prev-season')?.addEventListener('click', () => {
        const prev = api.getPrevSeason(season, year);
        season = prev.season;
        year = prev.year;
        loadSeason();
    });

    document.getElementById('next-season')?.addEventListener('click', () => {
        const next = api.getNextSeason(season, year);
        season = next.season;
        year = next.year;
        loadSeason();
    });

    enhanceSelect(document.getElementById('season-sort'));
    document.getElementById('season-sort')?.addEventListener('change', (e) => {
        sort = e.target.value;
        loadSeason();
    });

    loadSeason();
}
