import * as api from '../api.js?v=137';
import { getState, toast, esc, titlePref, statusLabel, emptyIcon, fmtScore, fmtScoreDiff, emitWatched, emitListChange, LIST_EVENT, loginState } from '../store.js?v=137';
import { getToken, isLoggedIn } from '../auth.js?v=137';
import { enhanceSelect } from '../select.js?v=137';
import { showScorePrompt } from '../a11y.js?v=137';

// View, sort and the airing filter are remembered per browser; the search text is not
const VIEW_KEY = 'aniroll_list_view';
const SORT_KEY = 'aniroll_list_sort';
const AIRING_KEY = 'aniroll_list_airing';
const BEHIND_KEY = 'aniroll_list_behind';
const FORMAT_KEY = 'aniroll_list_format';
// Anime formats to filter by; TV counts TV shorts too
const FORMATS = { TV: ['TV', 'TV_SHORT'], MOVIE: ['MOVIE'], OVA: ['OVA'], ONA: ['ONA'], SPECIAL: ['SPECIAL'] };
const FORMAT_LABELS = { TV: 'TV', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' };

const totalOf = (e) => e.media.episodes || e.media.chapters || 0;
const shareOf = (e) => (totalOf(e) ? e.progress / totalOf(e) : 0);
const nextAiringIn = (e) => (e.media.nextAiringEpisode ? api.untilAiring(e.media.nextAiringEpisode) ?? Infinity : Infinity);
const titleOf = (e) => titlePref(e.media.title) || '';
const dateNum = (d) => (d?.year ? d.year * 10000 + (d.month || 0) * 100 + (d.day || 0) : 0);
// Aired episodes not watched yet: the next one to air minus one, minus what was watched
export const behindOf = (e) => {
    const next = e.media?.nextAiringEpisode?.episode;
    if (!next || !['CURRENT', 'REPEATING', 'PAUSED'].includes(e.status)) return 0;
    return Math.max(0, next - 1 - (e.progress || 0));
};

const SORTS = {
    updated: { label: 'Last updated', compare: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) },
    title: { label: 'Title A–Z', compare: (a, b) => titleOf(a).localeCompare(titleOf(b)) },
    score: { label: 'Your score', compare: (a, b) => (b.score || 0) - (a.score || 0) || titleOf(a).localeCompare(titleOf(b)) },
    progress: { label: 'Progress', compare: (a, b) => shareOf(b) - shareOf(a) || b.progress - a.progress },
    airing: { label: 'Next episode', compare: (a, b) => nextAiringIn(a) - nextAiringIn(b) },
    behind: { label: 'Most behind', compare: (a, b) => behindOf(b) - behindOf(a) || nextAiringIn(a) - nextAiringIn(b) },
    started: { label: 'Started', compare: (a, b) => dateNum(b.startedAt) - dateNum(a.startedAt) },
    finished: { label: 'Finished', compare: (a, b) => dateNum(b.completedAt) - dateNum(a.completedAt) },
    mean: { label: 'AniList score', compare: (a, b) => (b.media.meanScore || 0) - (a.media.meanScore || 0) },
    year: { label: 'Release year', compare: (a, b) => dateNum(b.media.startDate) - dateNum(a.media.startDate) },
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
        content.innerHTML = loginState(emptyIcon('lock'), 'Log in to view your list', 'Your AniList, with one tap per episode and your progress on every device.');
        return;
    }

    const username = params.username || user?.name;
    const isOwn = user && username === user.name;
    let targetUser = isOwn ? user : await api.getUserProfile(username, token);

    // Covers are the default look; the compact list stays one click away and is remembered
    let view = readPref(VIEW_KEY, 'grid', ['list', 'grid']);
    let sort = readPref(SORT_KEY, 'updated', Object.keys(SORTS));
    let airingOnly = readPref(AIRING_KEY, 'off', ['on', 'off']) === 'on';
    let behindOnly = readPref(BEHIND_KEY, 'off', ['on', 'off']) === 'on';
    let genre = '';
    let format = readPref(FORMAT_KEY, 'ALL', ['ALL', ...Object.keys(FORMATS)]);
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
            <select class="glass-select" id="list-genre" aria-label="Genre"><option value="">All genres</option></select>
            <button class="list-chip${airingOnly ? ' active' : ''}" id="list-airing" aria-pressed="${airingOnly}" title="Only shows that are airing right now">Airing</button>
            <button class="list-chip${behindOnly ? ' active' : ''}" id="list-behind" aria-pressed="${behindOnly}" title="Only shows with aired episodes you have not watched">Behind</button>
            <div class="list-formats" id="list-formats" role="group" aria-label="Format">${Object.keys(FORMATS).map(f =>
                `<button class="list-chip${format === f ? ' active' : ''}" data-format="${f}" aria-pressed="${format === f}">${FORMAT_LABELS[f]}</button>`).join('')}</div>
            ${isOwn ? `<button class="list-chip" id="list-export" title="Download this list as a MyAnimeList XML file (for MAL or a backup)">Export</button>` : ''}
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
    const behindChip = document.getElementById('list-behind');
    const genreSelect = document.getElementById('list-genre');
    const formatChips = document.getElementById('list-formats');

    let currentType = 'ANIME';
    let lists = null;
    let activeIndex = 0;

    async function loadList(type) {
        currentType = type;
        const tabsEl = document.getElementById('list-tabs');
        if (!listContent || !tabsEl) return;
        // Manga have no airing schedule, and formats of their own
        airingChip.hidden = type !== 'ANIME';
        behindChip.hidden = type !== 'ANIME';
        formatChips.hidden = type !== 'ANIME';

        listContent.classList.remove('is-grid');
        listContent.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

        try {
            // A copy of the outer array: the "All" tab added below must not end up in the cached answer
            lists = [...await api.getMediaList(targetUser.id, type, token)];
        } catch (err) {
            tabsEl.innerHTML = '';
            listContent.innerHTML = `<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
            return;
        }

        // Only the formats this list has; a remembered one it lacks is let go
        const present = new Set(lists.flatMap(l => l.entries.map(e => e.media.format)));
        formatChips.querySelectorAll('[data-format]').forEach(b => { b.hidden = !FORMATS[b.dataset.format].some(f => present.has(f)); });
        if (format !== 'ALL' && formatChips.querySelector(`[data-format="${format}"]`).hidden) setFormat('ALL');

        // Status lists first, in the usual order; custom lists after them, in the order the user gave
        // them on AniList (they have no status, so they would otherwise jump to the front)
        const statusOrder = ['CURRENT', 'REPEATING', 'PLANNING', 'PAUSED', 'COMPLETED', 'DROPPED'];
        const options = targetUser?.mediaListOptions?.[type === 'ANIME' ? 'animeList' : 'mangaList'] || {};
        const customOrder = options.customLists || [];
        const rank = (l) => (l.isCustomList || !l.status
            ? 100 + (customOrder.indexOf(l.name) + 1 || 99)
            : statusOrder.indexOf(l.status) + 1 || 50);
        lists.sort((a, b) => rank(a) - rank(b));
        // "All": every entry once, whatever lists it sits in
        const seen = new Set();
        const everything = lists.flatMap(l => l.entries).filter(e => !seen.has(e.id) && seen.add(e.id));
        if (lists.length > 1) lists.push({ name: 'All', status: null, isAll: true, entries: everything });
        activeIndex = 0;

        // Genres of this list, for the genre filter
        const genres = [...new Set(everything.flatMap(e => e.media.genres || []))].sort();
        if (genre && !genres.includes(genre)) genre = '';
        genreSelect.innerHTML = `<option value="">All genres</option>` + genres.map(g => `<option value="${esc(g)}"${g === genre ? ' selected' : ''}>${esc(g)}</option>`).join('');

        paintTabs();
        renderEntries();
    }

    function paintTabs() {
        const tabsEl = document.getElementById('list-tabs');
        if (!tabsEl || !lists) return;
        tabsEl.innerHTML = lists.map((l, i) =>
            `<button class="list-tab${i === activeIndex ? ' active' : ''}" data-index="${i}" aria-pressed="${i === activeIndex}">${esc(l.name)} <small style="opacity:0.6">(${l.entries.length})</small></button>`
        ).join('');
    }
    document.getElementById('list-tabs')?.addEventListener('click', (ev) => {
        const tab = ev.target.closest('.list-tab');
        if (!tab) return;
        activeIndex = Number(tab.dataset.index);
        paintTabs();
        renderEntries();
    });

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
        if (behindOnly && currentType === 'ANIME') out = out.filter(e => behindOf(e) > 0);
        if (genre) out = out.filter(e => (e.media.genres || []).includes(genre));
        if (format !== 'ALL' && currentType === 'ANIME') out = out.filter(e => FORMATS[format].includes(e.media.format));
        return [...out].sort(SORTS[sort].compare);
    }

    const unitOf = () => (currentType === 'ANIME' ? 'Ep' : 'Ch');
    const airingText = (m) => (m.nextAiringEpisode
        ? `Ep ${m.nextAiringEpisode.episode} in ${api.timeUntil(api.untilAiring(m.nextAiringEpisode))}`
        : '');
    const behindText = (e) => (behindOf(e) ? `${behindOf(e)} behind` : '');
    const cardSub = (e) => [
        `${e.progress}${totalOf(e) ? `/${totalOf(e)}` : ''} ${unitOf()}`,
        behindText(e) || airingText(e.media),
    ].filter(Boolean).join(' · ');

    function listRow(e) {
        const m = e.media;
        const total = totalOf(e);
        const pct = total ? (e.progress / total * 100) : 0;
        const airing = airingText(m) ? `<span style="color:var(--success);font-size:0.7rem;margin-left:4px">${airingText(m)}</span>` : '';
        const behind = behindOf(e) ? `<span class="behind-badge" title="Aired, not watched yet">${behindOf(e)} behind</span>` : '';
        const volumes = currentType === 'MANGA' && (e.progressVolumes || m.volumes) ? ` · Vol ${e.progressVolumes || 0}${m.volumes ? `/${m.volumes}` : ''}` : '';
        return `<div class="list-entry" data-entry-id="${e.id}" data-media-id="${m.id}">
            <img class="list-entry-img" src="${esc(m.coverImage?.large || '')}" alt="" loading="lazy" data-open="${m.id}">
            <div class="list-entry-info">
                <div class="list-entry-title" data-open="${m.id}" role="button" tabindex="0">${esc(titlePref(m.title))}</div>
                <div class="list-entry-meta">${api.formatFormat(m.format) || ''}${m.meanScore ? ` · ${m.meanScore}%` : ''}${volumes}${airing}${behind}</div>
                <div class="progress-bar" style="margin-top:4px;width:100%;max-width:200px">
                    <div class="progress-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>
            <div class="list-entry-progress">
                ${isOwn ? `<button class="progress-btn" data-action="dec" data-entry="${e.id}">−</button>` : ''}
                <span class="progress-text">${e.progress}/${total || '?'}</span>
                ${isOwn ? `<button class="progress-btn" data-action="inc" data-entry="${e.id}">+</button>` : ''}
            </div>
            ${isOwn
                ? `<button class="list-entry-score is-editable" data-score-entry="${e.id}" title="Change your score" aria-label="Your score: ${e.score ? fmtScore(e.score) : 'none'}. Change it">${e.score ? fmtScore(e.score) : '—'}</button>`
                : `<div class="list-entry-score">${e.score ? fmtScore(e.score) : '—'}</div>`}
        </div>`;
    }

    function gridCard(e) {
        const m = e.media;
        const total = totalOf(e);
        const pct = total ? (e.progress / total * 100) : 0;
        const unitWord = currentType === 'ANIME' ? 'episode' : 'chapter';
        // Not a button itself when it holds −/+1: the title opens the show, from the keyboard too
        const own = isOwn;
        return `<div class="media-card list-card" data-entry-id="${e.id}" data-media-id="${m.id}" data-open="${m.id}"${own ? '' : ' role="button" tabindex="0"'}>
            <img class="media-card-img" src="${esc(m.coverImage?.large || '')}" alt="" loading="lazy">
            ${e.score ? `<div class="media-card-score" title="Your score">${fmtScore(e.score)}</div>` : ''}
            ${isOwn ? `<div class="list-card-actions">
                <button class="cw-inc" data-action="dec" data-entry="${e.id}" title="One ${unitWord} back" ${e.progress <= 0 ? 'hidden' : ''}>−</button>
                <button class="cw-inc" data-action="inc" data-entry="${e.id}" title="Mark next ${unitWord} done" ${total && e.progress >= total ? 'hidden' : ''}>+1</button>
            </div>` : ''}
            <div class="media-card-overlay">
                <div class="media-card-title"${own ? ` data-open="${m.id}" role="button" tabindex="0"` : ''}>${esc(titlePref(m.title))}</div>
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
    // A score on the 100 scale, asked in a dialog; saved with one request
    async function askScore(entry, message = '') {
        const score = await showScorePrompt({ title: titleOf(entry), value: entry.score, message });
        if (score === null || score === Math.round(entry.score || 0)) return;
        try {
            const saved = await api.saveMediaListEntry({ id: entry.id, scoreRaw: score }, token, { mirror: false });
            entry.score = saved.score;
            emitListChange({ mediaId: entry.media.id, status: saved.status, progress: saved.progress, score: saved.score });
            toast(score ? `Score saved: ${score}` : 'Score removed', 'success');
            renderEntries();
        } catch (err) { toast(err.queued ? err.message : err.message, 'error'); }
    }

    listContent.addEventListener('click', (ev) => {
        const scoreBtn = ev.target.closest('[data-score-entry]');
        if (scoreBtn && isOwn) {
            ev.stopPropagation();
            const entry = findEntry(Number(scoreBtn.dataset.scoreEntry));
            if (entry) askScore(entry);
            return;
        }
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
                if (vars.status === 'COMPLETED') {
                    toast(`Completed ${titlePref(entry.media.title)}`, 'success');
                    // Finishing is the moment people rate a show: ask once, when it has no score yet
                    if (!entry.score) askScore(entry, 'You finished it. How was it?');
                }
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

    // One format at a time; the chosen one again shows all
    function setFormat(next) {
        format = next;
        writePref(FORMAT_KEY, format);
        formatChips.querySelectorAll('[data-format]').forEach(b => {
            b.classList.toggle('active', b.dataset.format === format);
            b.setAttribute('aria-pressed', String(b.dataset.format === format));
        });
    }
    formatChips?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-format]');
        if (!chip) return;
        setFormat(format === chip.dataset.format ? 'ALL' : chip.dataset.format);
        renderEntries();
    });

    behindChip?.addEventListener('click', () => {
        behindOnly = !behindOnly;
        writePref(BEHIND_KEY, behindOnly ? 'on' : 'off');
        behindChip.classList.toggle('active', behindOnly);
        behindChip.setAttribute('aria-pressed', String(behindOnly));
        renderEntries();
    });

    enhanceSelect(genreSelect);
    genreSelect?.addEventListener('change', () => {
        genre = genreSelect.value;
        renderEntries();
    });

    document.getElementById('list-export')?.addEventListener('click', () => {
        if (!lists) return;
        const all = lists.find(l => l.isAll)?.entries || lists.flatMap(l => l.entries);
        downloadMalXml(all, currentType, user);
    });

    // A change made elsewhere (the detail panel, the player, Home) shows here at once: the entry moves to
    // its new list, a removed one goes. A show that was not on the list yet needs the list read again.
    const onListChange = (ev) => {
        if (!listContent.isConnected) return window.removeEventListener(LIST_EVENT, onListChange);
        const d = ev.detail || {};
        if (!lists || !isOwn || !d.mediaId) return;
        const copies = lists.flatMap(l => l.entries).filter(e => e.media.id === d.mediaId);
        if (!copies.length) {
            if (!d.removed) loadList(currentType);
            return;
        }
        for (const l of lists) {
            if (d.removed) { l.entries = l.entries.filter(e => e.media.id !== d.mediaId); continue; }
            for (const e of l.entries.filter(x => x.media.id === d.mediaId)) {
                if (d.progress != null) e.progress = d.progress;
                if (d.score != null) e.score = d.score;
                if (d.status) e.status = d.status;
                e.updatedAt = Math.floor(Date.now() / 1000);
            }
        }
        // Status lists hold an entry by its status: move it over
        const entry = copies[0];
        if (!d.removed && d.status) {
            for (const l of lists) {
                if (l.isCustomList || l.isAll || !l.status) continue;
                const has = l.entries.some(e => e.id === entry.id);
                if (l.status === d.status && !has) l.entries.unshift(entry);
                if (l.status !== d.status && has) l.entries = l.entries.filter(e => e.id !== entry.id);
            }
        }
        const allTab = lists.find(l => l.isAll);
        if (allTab && d.removed) allTab.entries = allTab.entries.filter(e => e.media.id !== d.mediaId);
        paintTabs();
        renderEntries();
    };
    window.addEventListener(LIST_EVENT, onListChange);

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

// The list as MyAnimeList's export file, built from what is on screen already (no request). MAL and
// AniRoll's own import read it; entries without a MAL id are left out, MAL could not place them.
const MAL_STATUS = { CURRENT: 'Watching', REPEATING: 'Watching', PLANNING: 'Plan to Watch', COMPLETED: 'Completed', PAUSED: 'On-Hold', DROPPED: 'Dropped' };
const MAL_STATUS_MANGA = { ...MAL_STATUS, CURRENT: 'Reading', REPEATING: 'Reading', PLANNING: 'Plan to Read' };
function downloadMalXml(entries, type, user) {
    const anime = type === 'ANIME';
    const x = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const date = (d) => (d?.year ? `${d.year}-${String(d.month || 0).padStart(2, '0')}-${String(d.day || 0).padStart(2, '0')}` : '0000-00-00');
    const statusWords = anime ? MAL_STATUS : MAL_STATUS_MANGA;
    const rows = entries.filter(e => e.media.idMal).map(e => {
        const m = e.media;
        const score = Math.round((e.score || 0) / 10);
        return anime ? `
    <anime>
        <series_animedb_id>${m.idMal}</series_animedb_id>
        <series_title><![CDATA[${titlePref(m.title)}]]></series_title>
        <series_episodes>${m.episodes || 0}</series_episodes>
        <my_watched_episodes>${e.progress || 0}</my_watched_episodes>
        <my_start_date>${date(e.startedAt)}</my_start_date>
        <my_finish_date>${date(e.completedAt)}</my_finish_date>
        <my_score>${score}</my_score>
        <my_status>${statusWords[e.status] || 'Plan to Watch'}</my_status>
        <my_times_watched>${e.repeat || 0}</my_times_watched>
        <my_rewatching>${e.status === 'REPEATING' ? 1 : 0}</my_rewatching>
        <my_comments><![CDATA[${(e.notes || '').replace(/]]>/g, ']] >')}]]></my_comments>
        <update_on_import>1</update_on_import>
    </anime>` : `
    <manga>
        <manga_mangadb_id>${m.idMal}</manga_mangadb_id>
        <manga_title><![CDATA[${titlePref(m.title)}]]></manga_title>
        <manga_chapters>${m.chapters || 0}</manga_chapters>
        <manga_volumes>${m.volumes || 0}</manga_volumes>
        <my_read_chapters>${e.progress || 0}</my_read_chapters>
        <my_read_volumes>${e.progressVolumes || 0}</my_read_volumes>
        <my_start_date>${date(e.startedAt)}</my_start_date>
        <my_finish_date>${date(e.completedAt)}</my_finish_date>
        <my_score>${score}</my_score>
        <my_status>${statusWords[e.status] || 'Plan to Read'}</my_status>
        <my_times_read>${e.repeat || 0}</my_times_read>
        <my_comments><![CDATA[${(e.notes || '').replace(/]]>/g, ']] >')}]]></my_comments>
        <update_on_import>1</update_on_import>
    </manga>`;
    }).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
    <myinfo>
        <user_name>${x(user?.name || '')}</user_name>
        <user_export_type>${anime ? 1 : 2}</user_export_type>
    </myinfo>${rows}
</myanimelist>
`;
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `aniroll-${anime ? 'anime' : 'manga'}-${new Date().toISOString().slice(0, 10)}.xml`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const left = entries.length - entries.filter(e => e.media.idMal).length;
    toast(`Exported ${entries.length - left} entries${left ? ` (${left} without a MAL id left out)` : ''}`, 'success');
}

// The compare view's status filter: every status, in this order (labels from statusLabel)
const COMPARE_FILTERS = ['ALL', 'CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'REPEATING'];

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
                    ${COMPARE_FILTERS.map(key =>
                        `<button class="list-tab ${key === activeFilter ? 'active' : ''}" data-filter="${key}">${key === 'ALL' ? 'All' : statusLabel(key, type)}</button>`
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
