import * as api from '../api.js?v=101';
import { enhanceSelect } from '../select.js?v=101';
import { renderMediaCard, esc, renderPageSwitch } from '../store.js?v=101';
import { getToken } from '../auth.js?v=101';

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
        <div id="season-grid" class="media-grid media-grid-lg"></div>
    </div>`;

    async function loadSeason() {
        const grid = document.getElementById('season-grid');
        const label = document.getElementById('season-label');
        if (!grid || !label) return;

        label.textContent = `${api.getSeasonName(season)} ${year}`;
        grid.innerHTML = Array(12).fill('<div class="skeleton skeleton-card"></div>').join('');

        try {
            const media = await api.getSeason(season, year, sort, token);
            grid.innerHTML = media.map(m => renderMediaCard(m, true)).join('') ||
                '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-sub">No anime for this season</div></div>';
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
