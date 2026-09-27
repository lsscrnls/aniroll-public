import * as api from '../api.js?v=103';
import { getState, toast, esc, titlePref, statusLabel, emptyIcon, fmtScore, fmtScoreDiff, emitWatched } from '../store.js?v=103';
import { getToken, isLoggedIn } from '../auth.js?v=103';
import { enhanceSelect } from '../select.js?v=103';

// View, sort and the airing filter are remembered per browser; the search text is not
const VIEW_KEY = 'aniroll_list_view';
const SORT_KEY = 'aniroll_list_sort';
const AIRING_KEY = 'aniroll_list_airing';

const totalOf = (e) => e.media.episodes || e.media.chapters || 0;
const shareOf = (e) => (totalOf(e) ? e.progress / totalOf(e) : 0);
const nextAiringIn = (e) => (e.media.nextAiringEpisode ? api.untilAiring(e.media.nextAiringEpisode) ?? Infinity : Infinity);
const titleOf = (e) => titlePref(e.media.title) || '';

const SORTS = {
    updated: { label: 'Last updated', compare: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) },
    title: { label: 'Title A–Z', compare: (a, b) => titleOf(a).localeCompare(titleOf(b)) },
    score: { label: 'Your score', compare: (a, b) => (b.score || 0) - (a.score || 0) || titleOf(a).localeCompare(titleOf(b)) },
    progress: { label: 'Progress', compare: (a, b) => shareOf(b) - shareOf(a) || b.progress - a.progress },
    airing: { label: 'Next episode', compare: (a, b) => nextAiringIn(a) - nextAiringIn(b) },
};

const ICON_LIST = '<svg data-icon="view_list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>';
const ICON_GRID = '<svg data-icon="grid_view" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';

function readPref(key, fallback, allowed) {
    try {
        const value = localStorage.getItem(key);
        return allowed.includes(value) ? value : fallback;
    } catch { return fallback; }
}

function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

export async function render({ params, content }) {
    const token = getToken();
    const user = getState().user;

    if (!params.username && (!isLoggedIn() || !user)) {
        content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('lock')}</div><div class="empty-state-text">Log in to view your list</div></div>`;
        return;
    }

    const username = params.username || user?.name;
    const isOwn = user && username === user.name;
    let targetUser = isOwn ? user : await api.getUserProfile(username, token);

    // Covers are the default look; the compact list stays one click away and is remembered
    let view = readPref(VIEW_KEY, 'grid', ['list', 'grid']);
    let sort = readPref(SORT_KEY, 'updated', Object.keys(SORTS));
    let airingOnly = readPref(AIRING_KEY, 'off', ['on', 'off']) === 'on';
    let search = '';

    content.innerHTML = `<div class="page-enter">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);flex-wrap:wrap;gap:var(--space-md)">
            <h1 class="section-title">${isOwn ? 'My List' : `${esc(username)}'s List`}</h1>
            <div class="tab-group">
                <button class="tab-btn active" id="tab-anime">Anime</button>
                <button class="tab-btn" id="tab-manga">Manga</button>
            </div>
        </div>
        <div id="list-tabs" class="list-controls"></div>
        <div class="list-roll" id="list-roll" hidden>
            <span>Can't decide what to watch next?</span>
            <a href="#/roll" class="glass-btn glass-btn-secondary glass-btn-sm">Roll from this list</a>
        </div>
        <div class="list-toolbar" id="list-toolbar">
            <input class="glass-input list-search" id="list-search" type="search" placeholder="Search in list…" autocomplete="off" aria-label="Search in list">
            <select class="glass-select" id="list-sort" aria-label="Sort">
                ${Object.entries(SORTS).map(([key, s]) => `<option value="${key}" ${key === sort ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
            <button class="list-chip${airingOnly ? ' active' : ''}" id="list-airing" aria-pressed="${airingOnly}" title="Only shows that are airing right now">Airing</button>
            <div class="list-view-toggle" role="group" aria-label="View">
                <button class="list-view-btn${view === 'list' ? ' active' : ''}" data-view="list" aria-pressed="${view === 'list'}" title="List">${ICON_LIST}</button>
                <button class="list-view-btn${view === 'grid' ? ' active' : ''}" data-view="grid" aria-pressed="${view === 'grid'}" title="Covers">${ICON_GRID}</button>
            </div>
        </div>
        <div id="list-content" class="list-content"></div>
        <div id="compare-view" hidden></div>
    </div>
    ${!isOwn && user ? `<button class="compare-fab" id="compare-btn">
        <svg data-icon="compare_arrows" class="compare-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/></svg>
        <span class="compare-fab-label">Compare</span>
    </button>` : ''}`;

    const listContent = document.getElementById('list-content');
    const toolbar = document.getElementById('list-toolbar');
    const airingChip = document.getElementById('list-airing');

    let currentType = 'ANIME';
    let lists = null;
    let activeIndex = 0;

    async function loadList(type) {
        currentType = type;
        const tabsEl = document.getElementById('list-tabs');
        if (!listContent || !tabsEl) return;
        // Manga have no airing schedule
        airingChip.hidden = type !== 'ANIME';

        listContent.classList.remove('is-grid');
        listContent.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

        try {
            lists = await api.getMediaList(targetUser.id, type, token);
        } catch (err) {
            tabsEl.innerHTML = '';
            listContent.innerHTML = `<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
            return;
        }

        const statusOrder = ['CURRENT', 'REPEATING', 'PLANNING', 'PAUSED', 'COMPLETED', 'DROPPED'];
        lists.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
        activeIndex = 0;

        tabsEl.innerHTML = lists.map((l, i) =>
            `<button class="list-tab${i === 0 ? ' active' : ''}" data-index="${i}">${esc(l.name)} <small style="opacity:0.6">(${l.entries.length})</small></button>`
        ).join('');

        tabsEl.querySelectorAll('.list-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                tabsEl.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                activeIndex = Number(tab.dataset.index);
                renderEntries();
            });
        });

        renderEntries();
    }

    function visibleEntries(entries) {
        const q = search.trim().toLowerCase();
        let out = entries;
        if (q) {
            out = out.filter(e => {
                const t = e.media.title || {};
                return [t.userPreferred, t.romaji, t.english, t.native].some(s => s && s.toLowerCase().includes(q));
            });
        }
        if (airingOnly && currentType === 'ANIME') out = out.filter(e => e.media.nextAiringEpisode);
        return [...out].sort(SORTS[sort].compare);
    }

    const unitOf = () => (currentType === 'ANIME' ? 'Ep' : 'Ch');
    const airingText = (m) => (m.nextAiringEpisode
        ? `Ep ${m.nextAiringEpisode.episode} in ${api.timeUntil(api.untilAiring(m.nextAiringEpisode))}`
        : '');
    const cardSub = (e) => [
        `${e.progress}${totalOf(e) ? `/${totalOf(e)}` : ''} ${unitOf()}`,
        airingText(e.media),
    ].filter(Boolean).join(' · ');

    function listRow(e) {
        const m = e.media;
        const total = totalOf(e);
        const pct = total ? (e.progress / total * 100) : 0;
        const airing = airingText(m) ? `<span style="color:var(--success);font-size:0.7rem;margin-left:4px">${airingText(m)}</span>` : '';
        return `<div class="list-entry" data-entry-id="${e.id}" data-media-id="${m.id}">
            <img class="list-entry-img" src="${esc(m.coverImage?.large || '')}" alt="${esc(titlePref(m.title))}" loading="lazy" data-open="${m.id}">
            <div class="list-entry-info">
                <div class="list-entry-title" data-open="${m.id}" role="button" tabindex="0">${esc(titlePref(m.title))}</div>
                <div class="list-entry-meta">${api.formatFormat(m.format) || ''}${m.meanScore ? ` · ${m.meanScore}%` : ''}${airing}</div>
                <div class="progress-bar" style="margin-top:4px;width:100%;max-width:200px">
                    <div class="progress-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>
            <div class="list-entry-progress">
                ${isOwn ? `<button class="progress-btn" data-action="dec" data-entry="${e.id}">−</button>` : ''}
                <span class="progress-text">${e.progress}/${total || '?'}</span>
                ${isOwn ? `<button class="progress-btn" data-action="inc" data-entry="${e.id}">+</button>` : ''}
            </div>
            <div class="list-entry-score">${e.score ? fmtScore(e.score) : '—'}</div>
        </div>`;
    }

    function gridCard(e) {
        const m = e.media;
        const total = totalOf(e);
        const pct = total ? (e.progress / total * 100) : 0;
        const unitWord = currentType === 'ANIME' ? 'episode' : 'chapter';
        return `<div class="media-card list-card" data-entry-id="${e.id}" data-media-id="${m.id}" data-open="${m.id}" role="button" tabindex="0">
            <img class="media-card-img" src="${esc(m.coverImage?.large || '')}" alt="${esc(titlePref(m.title))}" loading="lazy">
            ${e.score ? `<div class="media-card-score" title="Your score">${fmtScore(e.score)}</div>` : ''}
            ${isOwn ? `<div class="list-card-actions">
                <button class="cw-inc" data-action="dec" data-entry="${e.id}" title="One ${unitWord} back" ${e.progress <= 0 ? 'hidden' : ''}>−</button>
                <button class="cw-inc" data-action="inc" data-entry="${e.id}" title="Mark next ${unitWord} done" ${total && e.progress >= total ? 'hidden' : ''}>+1</button>
            </div>` : ''}
            <div class="media-card-overlay">
                <div class="media-card-title">${esc(titlePref(m.title))}</div>
                <div class="media-card-sub">${esc(cardSub(e))}</div>
            </div>
            <div class="progress-bar list-card-progress"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    function renderEntries() {
        if (!listContent || !lists) return;
        const all = lists[activeIndex]?.entries || [];
        const entries = visibleEntries(all);
        // Roll picks from your own Planning anime; offer it right where that list is
        const rollBar = document.getElementById('list-roll');
        if (rollBar) rollBar.hidden = !(isOwn && currentType === 'ANIME' && lists[activeIndex]?.status === 'PLANNING' && all.length > 1);
        listContent.classList.toggle('is-grid', view === 'grid' && entries.length > 0);

        if (!entries.length) {
            listContent.innerHTML = `<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">${all.length ? 'No matching entries' : 'No entries'}</div></div>`;
            return;
        }
        listContent.innerHTML = view === 'grid'
            ? `<div class="media-grid list-grid">${entries.map(gridCard).join('')}</div>`
            : entries.map(listRow).join('');
    }

    function findEntry(entryId) {
        for (const list of lists || []) {
            const entry = list.entries.find(e => e.id === entryId);
            if (entry) return entry;
        }
        return null;
    }

    // An entry can sit in several custom lists — update every copy that is on screen
    function updateEntryViews(entry) {
        const max = totalOf(entry);
        listContent.querySelectorAll(`[data-entry-id="${entry.id}"]`).forEach(el => {
            const text = el.querySelector('.progress-text');
            if (text) text.textContent = `${entry.progress}/${max || '?'}`;
            const sub = el.querySelector('.media-card-sub');
            if (sub) sub.textContent = cardSub(entry);
            const fill = el.querySelector('.progress-bar-fill');
            if (fill && max) fill.style.width = `${entry.progress / max * 100}%`;
            el.querySelectorAll('.list-card-actions [data-action="inc"]').forEach(b => { b.hidden = !!max && entry.progress >= max; });
            el.querySelectorAll('.list-card-actions [data-action="dec"]').forEach(b => { b.hidden = entry.progress <= 0; });
        });
    }

    // −/+ in both views. Capture phase, so a card's own onclick (open detail) never fires;
    // saves are serialized per entry so rapid clicks can't land out of order on AniList.
    const chains = new Map();
    listContent.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn || !isOwn) return;
        ev.stopPropagation();
        const entry = findEntry(Number(btn.dataset.entry));
        if (!entry) return;
        const max = totalOf(entry);
        const next = entry.progress + (btn.dataset.action === 'inc' ? 1 : -1);
        if (next < 0 || (max && next > max)) return;

        entry.progress = next;
        updateEntryViews(entry);
        if (btn.dataset.action === 'inc') emitWatched(entry.media);

        const target = next;
        chains.set(entry.id, (chains.get(entry.id) || Promise.resolve()).then(async () => {
            if (target !== entry.progress) return; // a newer click will save
            const vars = api.progressVars(entry, target, max || undefined);
            try {
                const saved = await api.saveMediaListEntry(vars, token);
                Object.assign(entry, { status: saved.status, startedAt: saved.startedAt, completedAt: saved.completedAt, repeat: saved.repeat });
                if (vars.status === 'COMPLETED') toast(`Completed ${titlePref(entry.media.title)}`, 'success');
            } catch (err) { toast(err.message, 'error'); }
        }));
    }, true);

    // ===== Toolbar =====
    let searchTimer = null;
    document.getElementById('list-search')?.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            search = e.target.value;
            renderEntries();
        }, 120);
    });

    const sortSelect = document.getElementById('list-sort');
    enhanceSelect(sortSelect);
    sortSelect?.addEventListener('change', () => {
        sort = sortSelect.value;
        writePref(SORT_KEY, sort);
        renderEntries();
    });

    airingChip?.addEventListener('click', () => {
        airingOnly = !airingOnly;
        writePref(AIRING_KEY, airingOnly ? 'on' : 'off');
        airingChip.classList.toggle('active', airingOnly);
        airingChip.setAttribute('aria-pressed', String(airingOnly));
        renderEntries();
    });

    toolbar?.querySelectorAll('.list-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            view = btn.dataset.view;
            writePref(VIEW_KEY, view);
            toolbar.querySelectorAll('.list-view-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-pressed', String(b === btn));
            });
            renderEntries();
        });
    });

    document.getElementById('tab-anime')?.addEventListener('click', () => {
        document.getElementById('tab-anime').classList.add('active');
        document.getElementById('tab-manga').classList.remove('active');
        loadList('ANIME');
    });

    document.getElementById('tab-manga')?.addEventListener('click', () => {
        document.getElementById('tab-manga').classList.add('active');
        document.getElementById('tab-anime').classList.remove('active');
        loadList('MANGA');
    });

    // The compare view replaces the list; the toolbar belongs to the list and goes with it
    const compareBtn = document.getElementById('compare-btn');
    compareBtn?.addEventListener('click', async () => {
        const compareView = document.getElementById('compare-view');
        if (toolbar) toolbar.hidden = compareView?.hidden !== false;
        await openCompare(targetUser, user, currentType, token, content);
        if (toolbar) toolbar.hidden = compareView?.hidden === false;
    });

    loadList('ANIME');
}

const STATUS_LABELS = {
    ALL: 'All',
    CURRENT: 'Watching',
    PLANNING: 'Planning',
    COMPLETED: 'Completed',
    PAUSED: 'Paused',
    DROPPED: 'Dropped',
    REPEATING: 'Rewatching'
};

async function openCompare(friendUser, myUser, type, token, content) {
    const compareView = document.getElementById('compare-view');
    const listContent = document.getElementById('list-content');
    const listTabs = document.getElementById('list-tabs');
    const compareBtn = document.getElementById('compare-btn');
    if (!compareView) return;

    if (!compareView.hidden) {
        compareView.hidden = true;
        listContent.hidden = false;
        listTabs.hidden = false;
        compareBtn.classList.remove('active');
        return;
    }

    compareBtn.classList.add('active');
    listContent.hidden = true;
    listTabs.hidden = true;
    compareView.hidden = false;
    compareView.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

    try {
        const [friendLists, myLists] = await Promise.all([
            api.getMediaList(friendUser.id, type, token),
            api.getMediaList(myUser.id, type, token)
        ]);

        const friendMap = new Map();
        for (const list of friendLists) {
            for (const e of list.entries) {
                friendMap.set(e.media.id, e);
            }
        }

        const myMap = new Map();
        for (const list of myLists) {
            for (const e of list.entries) {
                myMap.set(e.media.id, e);
            }
        }

        const allMediaIds = new Set([...friendMap.keys(), ...myMap.keys()]);
        const combined = [];
        for (const mediaId of allMediaIds) {
            const f = friendMap.get(mediaId);
            const m = myMap.get(mediaId);
            combined.push({
                media: (f || m).media,
                friend: f || null,
                mine: m || null,
            });
        }

        combined.sort((a, b) => (titlePref(a.media.title) || '').localeCompare(titlePref(b.media.title) || ''));

        let activeFilter = 'ALL';
        let activeScope = 'ALL';

        function renderCompare() {
            let scoped = combined;
            if (activeScope === 'SHARED') scoped = combined.filter(c => c.friend && c.mine);
            else if (activeScope === 'ONLY_FRIEND') scoped = combined.filter(c => c.friend && !c.mine);
            else if (activeScope === 'ONLY_ME') scoped = combined.filter(c => !c.friend && c.mine);

            const filtered = activeFilter === 'ALL'
                ? scoped
                : scoped.filter(c =>
                    c.friend?.status === activeFilter || c.mine?.status === activeFilter
                );

            const bothCount = combined.filter(c => c.friend && c.mine).length;
            const onlyFriend = combined.filter(c => c.friend && !c.mine).length;
            const onlyMe = combined.filter(c => !c.friend && c.mine).length;

            const isAnime = type === 'ANIME';

            compareView.innerHTML = `
                <div class="compare-summary">
                    <div class="compare-stat ${activeScope === 'SHARED' ? 'active' : ''}" data-scope="SHARED" style="cursor:pointer"><span class="compare-stat-num">${bothCount}</span> Shared</div>
                    <div class="compare-stat ${activeScope === 'ONLY_FRIEND' ? 'active' : ''}" data-scope="ONLY_FRIEND" style="cursor:pointer"><span class="compare-stat-num">${onlyFriend}</span> Only ${esc(friendUser.name)}</div>
                    <div class="compare-stat ${activeScope === 'ONLY_ME' ? 'active' : ''}" data-scope="ONLY_ME" style="cursor:pointer"><span class="compare-stat-num">${onlyMe}</span> Only You</div>
                </div>
                <div class="list-controls" style="margin-bottom:var(--space-md)">
                    ${Object.entries(STATUS_LABELS).map(([key, label]) =>
                        `<button class="list-tab ${key === activeFilter ? 'active' : ''}" data-filter="${key}">${key === 'ALL' ? label : statusLabel(key, type)}</button>`
                    ).join('')}
                </div>
                <div class="box" style="padding:var(--space-sm)">
                    ${filtered.length ? filtered.map(c => {
                        const m = c.media;
                        const total = isAnime ? m.episodes : m.chapters;
                        const fProgress = c.friend ? `${c.friend.progress}/${total || '?'}` : '—';
                        const mProgress = c.mine ? `${c.mine.progress}/${total || '?'}` : '—';
                        const fScore = fmtScore(c.friend?.score) || '—';
                        const mScore = fmtScore(c.mine?.score) || '—';
                        const fStatus = c.friend ? statusLabel(c.friend.status, type) : '';
                        const mStatus = c.mine ? statusLabel(c.mine.status, type) : '';
                        const scoreDiff = c.friend?.score && c.mine?.score
                            ? fmtScoreDiff(c.mine.score, c.friend.score)
                            : null;
                        const diffLabel = scoreDiff !== null
                            ? `<span class="compare-diff ${scoreDiff.value > 0 ? 'pos' : scoreDiff.value < 0 ? 'neg' : ''}">${scoreDiff.text}</span>`
                            : '';

                        return `<div class="compare-row">
                            <img class="list-entry-img" src="${m.coverImage?.large || ''}" alt="${esc(titlePref(m.title))}" loading="lazy" data-open="${m.id}">
                            <div class="compare-row-info">
                                <div class="list-entry-title" data-open="${m.id}" role="button" tabindex="0">${esc(titlePref(m.title))}</div>
                                <div class="compare-row-users">
                                    <div class="compare-user-col">
                                        <img class="compare-mini-avatar" src="${friendUser.avatar?.medium || ''}" alt="${esc(friendUser.name)}">
                                        <span class="compare-status">${fStatus}</span>
                                        <span class="compare-progress">${fProgress}</span>
                                        <span class="compare-score">${fScore}</span>
                                    </div>
                                    <div class="compare-user-col">
                                        <img class="compare-mini-avatar" src="${myUser.avatar?.medium || myUser.avatar?.large || ''}" alt="You">
                                        <span class="compare-status">${mStatus}</span>
                                        <span class="compare-progress">${mProgress}</span>
                                        <span class="compare-score">${mScore}</span>
                                    </div>
                                    ${diffLabel}
                                </div>
                            </div>
                        </div>`;
                    }).join('') : '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">No matching entries</div></div>'}
                </div>`;

            compareView.querySelectorAll('[data-filter]').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeFilter = btn.dataset.filter;
                    renderCompare();
                });
            });

            compareView.querySelectorAll('[data-scope]').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeScope = activeScope === btn.dataset.scope ? 'ALL' : btn.dataset.scope;
                    renderCompare();
                });
            });
        }

        renderCompare();
    } catch (err) {
        compareView.innerHTML = `<div class="empty-state"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
    }
}
