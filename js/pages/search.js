import * as api from '../api.js?v=136';
import { enhanceSelect } from '../select.js?v=136';
import { renderMediaCard, getState, esc, emptyIcon, renderPageSwitch } from '../store.js?v=136';
import { getToken } from '../auth.js?v=136';

export async function render({ content, query: params }) {
    const token = getToken();
    const type = params.type || 'ANIME';
    const sort = params.sort || 'TRENDING_DESC';
    const genre = params.genre || '';
    // A tag from a show's page: browse everything carrying it, until the chip is switched off
    let tag = params.tag || '';
    const search = params.q || '';

    let genres = getState().genreCache;
    if (!genres) {
        genres = await api.getGenres();
    }

    content.innerHTML = `<div class="page-enter discover-page">
        ${renderPageSwitch('search')}
        <h1 class="section-title" style="margin-bottom:var(--space-lg)">Browse</h1>
        <div class="tab-group">
            <button class="tab-btn ${type === 'ANIME' ? 'active' : ''}" data-type="ANIME">Anime</button>
            <button class="tab-btn ${type === 'MANGA' ? 'active' : ''}" data-type="MANGA">Manga</button>
        </div>
        <div class="filter-row">
            <input class="glass-input" id="browse-search" type="text" placeholder="Search..." value="${esc(search)}" style="min-width:200px">
            <select class="glass-select" id="browse-sort">
                <option value="TRENDING_DESC" ${sort === 'TRENDING_DESC' ? 'selected' : ''}>Trending</option>
                <option value="POPULARITY_DESC" ${sort === 'POPULARITY_DESC' ? 'selected' : ''}>Popularity</option>
                <option value="SCORE_DESC" ${sort === 'SCORE_DESC' ? 'selected' : ''}>Score</option>
                <option value="START_DATE_DESC" ${sort === 'START_DATE_DESC' ? 'selected' : ''}>Newest</option>
                <option value="FAVOURITES_DESC" ${sort === 'FAVOURITES_DESC' ? 'selected' : ''}>Favorites</option>
            </select>
            <select class="glass-select" id="browse-genre">
                <option value="">All Genres</option>
                ${genres.filter(g => g !== 'Hentai').map(g => `<option value="${esc(g)}" ${genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
        </div>
        <div class="genre-chips taste-chips" id="taste-chips" hidden></div>
        ${tag ? `<div class="genre-chips" style="margin-bottom:var(--space-lg)">
            <button class="genre-chip active" id="browse-tag" title="Remove tag filter">Tag: ${esc(tag)}</button>
        </div>` : ''}
        <div id="browse-grid" class="media-grid media-grid-lg"></div>
        <div id="browse-more" style="text-align:center;margin-top:var(--space-xl)" hidden>
            <button class="glass-btn glass-btn-secondary" id="load-more-btn">Load More</button>
        </div>
    </div>`;

    let currentPage = 1;
    let currentType = type;

    // What your list says you like most: a few genres and tags to browse by, one tap each. The taste
    // profile is the same as Home's recommendations, usually already read
    const user = getState().user;
    if (user?.id && token && type === 'ANIME' && !tag && !genre) {
        api.getTasteProfile(user.id, token).then(profile => {
            const box = document.getElementById('taste-chips');
            if (!profile || !box) return;
            const top = [...profile.affinity.entries()]
                .map(([key, a]) => ({ key, score: a * (profile.idf.get(key) || 1) }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score);
            const pick = [...top.filter(x => x.key.startsWith('g:')).slice(0, 2), ...top.filter(x => x.key.startsWith('t:')).slice(0, 3)];
            if (!pick.length) return;
            box.innerHTML = `<span class="taste-chips-label">Because you liked</span>` + pick.map(x => {
                const name = x.key.slice(2);
                const href = x.key.startsWith('g:') ? `#/search?type=ANIME&genre=${encodeURIComponent(name)}` : `#/search?type=ANIME&tag=${encodeURIComponent(name)}`;
                return `<a class="genre-chip" href="${href}">${esc(name)}</a>`;
            }).join('');
            box.hidden = false;
        }).catch(() => { /* no chips */ });
    }

    async function loadResults(page = 1, append = false) {
        const vars = {
            page,
            perPage: 24,
            type: currentType,
            sort: [document.getElementById('browse-sort')?.value || sort],
        };

        const searchVal = document.getElementById('browse-search')?.value?.trim();
        if (searchVal && searchVal.length > 0 && searchVal.length < 4) {
            const grid = document.getElementById('browse-grid');
            if (grid) {
                grid.innerHTML = '<div class="empty-state"><div class="empty-state-sub" style="color:var(--text-secondary)">Type at least 4 characters…</div></div>';
            }
            const moreBtn = document.getElementById('browse-more');
            if (moreBtn) moreBtn.hidden = true;
            return;
        }
        if (searchVal) vars.search = searchVal;

        const genreVal = document.getElementById('browse-genre')?.value;
        if (genreVal) vars.genre_in = [genreVal];
        if (tag) vars.tag_in = [tag];

        try {
            const result = await api.browseMedia(vars, token);
            const grid = document.getElementById('browse-grid');
            if (!grid) return;

            const html = result.media.map(m => renderMediaCard(m, true)).join('');
            if (append) grid.innerHTML += html;
            else grid.innerHTML = html || `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('search')}</div><div class="empty-state-text">No results found</div></div>`;

            const moreBtn = document.getElementById('browse-more');
            if (moreBtn) moreBtn.hidden = !result.pageInfo.hasNextPage;
            currentPage = page;
        } catch (err) {
            const grid = document.getElementById('browse-grid');
            if (grid) {
                grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('alert')}</div><div class="empty-state-text" style="color:var(--error)">${esc(err.message)}</div></div>`;
            }
            const moreBtn = document.getElementById('browse-more');
            if (moreBtn) moreBtn.hidden = true;
        }
    }

    loadResults();

    content.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            content.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = btn.dataset.type;
            loadResults(1);
        });
    });

    let searchTimeout;
    document.getElementById('browse-search')?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadResults(1), 400);
    });

    enhanceSelect(document.getElementById('browse-sort'));
    enhanceSelect(document.getElementById('browse-genre'));
    document.getElementById('browse-sort')?.addEventListener('change', () => loadResults(1));
    document.getElementById('browse-genre')?.addEventListener('change', () => loadResults(1));
    document.getElementById('browse-tag')?.addEventListener('click', e => {
        tag = '';
        e.currentTarget.parentElement.remove();
        loadResults(1);
    });
    document.getElementById('load-more-btn')?.addEventListener('click', () => loadResults(currentPage + 1, true));
}
