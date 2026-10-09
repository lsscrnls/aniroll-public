// @ts-check
// A studio's page (#/studio/<id>): its anime, most popular first, from the studio cards on a detail page.
import * as api from '../api.js?v=160';
import { renderMediaCard, esc, emptyIcon, historyLine } from '../store.js?v=160';
import { getToken, isLoggedIn } from '../auth.js?v=160';

export async function render({ params, content }) {
    const token = getToken();
    const id = parseInt(params.id);
    content.innerHTML = `<div class="page-enter studio-page">
        <div class="studio-kicker roll-result-kicker" id="studio-kicker">Studio</div>
        <h1 class="section-title studio-title" id="studio-title">&nbsp;</h1>
        <p class="studio-history" id="history-line" hidden></p>
        <div id="studio-grid" class="media-grid media-grid-lg">${Array(12).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>
        <div class="studio-more" id="studio-more" hidden><button class="glass-btn glass-btn-secondary" id="studio-more-btn">Show more</button></div>
    </div>`;
    const grid = content.querySelector('#studio-grid');
    const more = content.querySelector('#studio-more');
    let page = 1;
    const loaded = [];

    async function load() {
        try {
            const studio = await api.getStudio(id, page, token);
            if (!studio) throw new Error('Studio not found');
            if (page === 1) {
                content.querySelector('#studio-title').textContent = studio.name;
                content.querySelector('#studio-kicker').textContent = studio.isAnimationStudio ? 'Animation studio' : 'Studio';
                document.title = `${studio.name} · AniRoll`;
                grid.innerHTML = '';
            }
            const cards = studio.media.edges.map(e => renderMediaCard(e.node, true)).join('');
            grid.insertAdjacentHTML('beforeend', cards);
            if (page === 1 && !studio.media.edges.length) grid.innerHTML = `<div class="empty-state">${emptyIcon('tv')}<p>No anime listed for this studio yet.</p></div>`;
            loaded.push(...studio.media.edges.map(e => e.node));
            const line = isLoggedIn() ? historyLine(loaded) : '';
            const lineEl = content.querySelector('#history-line');
            lineEl.hidden = !line;
            lineEl.textContent = line;
            more.hidden = !studio.media.pageInfo.hasNextPage;
        } catch (err) {
            grid.innerHTML = `<div class="empty-state">${emptyIcon('alert')}<p>${esc(err.message)}</p></div>`;
            more.hidden = true;
        }
    }
    content.querySelector('#studio-more-btn').addEventListener('click', () => { page++; load(); });
    await load();
}
