import * as api from '../api.js?v=129';
import { esc, toast, getState, emptyIcon } from '../store.js?v=129';
import { openDialog } from '../a11y.js?v=129';
import { getToken, isLoggedIn } from '../auth.js?v=129';

// MAL list import works via the official XML export only.
// (Jikan's user-list endpoints are gone and MAL's own endpoints block CORS.)

const IMPORT_DELAY = 700; // spacing between writes; the shared request budget (20/min) does the real pacing

const MAL_STATUS_MAP = {
    watching: 'CURRENT',
    reading: 'CURRENT',
    completed: 'COMPLETED',
    on_hold: 'PAUSED',
    dropped: 'DROPPED',
    plan_to_watch: 'PLANNING',
    plan_to_read: 'PLANNING',
};

const MAL_STATUS_LABELS = {
    watching: 'Watching',
    reading: 'Reading',
    completed: 'Completed',
    on_hold: 'On Hold',
    dropped: 'Dropped',
    plan_to_watch: 'Plan to Watch',
    plan_to_read: 'Plan to Read',
};

const XML_STATUS_MAP = {
    'Watching': 'watching',
    'Reading': 'reading',
    'Completed': 'completed',
    'On-Hold': 'on_hold',
    'Dropped': 'dropped',
    'Plan to Watch': 'plan_to_watch',
    'Plan to Read': 'plan_to_read',
};

async function readExportFile(file) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const isGzip = head[0] === 0x1f && head[1] === 0x8b;
    if (!isGzip) return file.text();
    if (typeof DecompressionStream === 'undefined') throw new Error('Your browser cannot unpack .gz files — please extract the XML first');
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

export async function startXMLImport(file) {
    const container = document.getElementById('mal-content');
    if (!container) return;

    container.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

    try {
        const text = await readExportFile(file);
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        if (xml.querySelector('parsererror')) throw new Error('Invalid XML file');

        const username = xml.querySelector('myinfo user_name')?.textContent || 'MAL User';
        const animeList = Array.from(xml.querySelectorAll('anime')).map(n => xmlNodeToEntry(n, 'anime'));
        const mangaList = Array.from(xml.querySelectorAll('manga')).map(n => xmlNodeToEntry(n, 'manga'));
        if (!animeList.length && !mangaList.length) throw new Error('No entries found — is this a MAL export?');

        renderMALList(container, username, animeList, mangaList);
        toast(`XML loaded: ${animeList.length} Anime, ${mangaList.length} Manga`, 'success');
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('alert')}</div><div class="empty-state-text">${esc(err.message)}</div></div>`;
    }
}

function xmlNodeToEntry(node, type) {
    const tag = (name) => node.querySelector(name)?.textContent || '';
    const num = (name) => parseInt(tag(name)) || 0;
    const isAnime = type === 'anime';
    return {
        malId: num(isAnime ? 'series_animedb_id' : 'series_mangadb_id'),
        title: tag('series_title'),
        status: XML_STATUS_MAP[tag('my_status')] || (isAnime ? 'plan_to_watch' : 'plan_to_read'),
        score: num('my_score'),
        progress: num(isAnime ? 'my_watched_episodes' : 'my_read_chapters'),
        total: num(isAnime ? 'series_episodes' : 'series_chapters'),
    };
}

function renderMALList(container, username, animeList, mangaList) {
    let currentType = 'anime';
    let currentFilter = 'all';
    let importing = false;

    const currentList = () => currentType === 'anime' ? animeList : mangaList;
    const mediaType = () => currentType === 'anime' ? 'ANIME' : 'MANGA';

    function renderView() {
        const list = currentList();
        const groups = {};
        for (const e of list) {
            const label = MAL_STATUS_LABELS[e.status] || e.status;
            (groups[label] ||= []).push(e);
        }
        const filtered = currentFilter === 'all' ? list : list.filter(e => (MAL_STATUS_LABELS[e.status] || e.status) === currentFilter);

        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);flex-wrap:wrap">
                <div>
                    <div style="font-weight:700;font-size:1.1rem">${esc(username)}</div>
                    <div style="font-size:0.8rem;color:var(--text-secondary)">${animeList.length} Anime · ${mangaList.length} Manga on MAL</div>
                </div>
                <a href="https://myanimelist.net/profile/${encodeURIComponent(username)}" target="_blank" rel="noopener" class="glass-btn glass-btn-secondary glass-btn-sm" style="margin-left:auto">MAL Profile</a>
            </div>

            <div class="tab-group" style="margin-bottom:var(--space-md)">
                <button class="tab-btn ${currentType === 'anime' ? 'active' : ''}" data-mal-type="anime">Anime (${animeList.length})</button>
                <button class="tab-btn ${currentType === 'manga' ? 'active' : ''}" data-mal-type="manga">Manga (${mangaList.length})</button>
            </div>

            <div class="list-controls" style="margin-bottom:var(--space-md)">
                <button class="list-tab ${currentFilter === 'all' ? 'active' : ''}" data-mal-filter="all">All (${list.length})</button>
                ${Object.entries(groups).map(([label, entries]) =>
                    `<button class="list-tab ${currentFilter === label ? 'active' : ''}" data-mal-filter="${esc(label)}">${esc(label)} (${entries.length})</button>`
                ).join('')}
            </div>

            ${isLoggedIn() ? `<div style="margin-bottom:var(--space-md);display:flex;gap:var(--space-sm);align-items:center">
                <button class="glass-btn glass-btn-primary glass-btn-sm" id="mal-import-all" ${filtered.length ? '' : 'disabled'}>Import ${filtered.length} to AniList</button>
                <span id="mal-import-status" style="font-size:0.8rem;color:var(--text-secondary)"></span>
            </div>` : `<div class="box box-note" style="margin-bottom:var(--space-md);padding:var(--space-sm) var(--space-md);font-size:0.85rem;color:var(--text-secondary)">
                Log in to AniList to import entries.
            </div>`}

            <div class="box" id="mal-list" style="padding:var(--space-sm)">
                ${filtered.length ? filtered.map(e => renderMALEntry(e, list.indexOf(e))).join('') :
                    '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">No entries</div></div>'}
            </div>`;

        container.querySelectorAll('[data-mal-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (importing) return toast('Import in progress…', 'info');
                currentType = btn.dataset.malType;
                currentFilter = 'all';
                renderView();
            });
        });

        container.querySelectorAll('[data-mal-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (importing) return toast('Import in progress…', 'info');
                currentFilter = btn.dataset.malFilter;
                renderView();
            });
        });

        container.querySelectorAll('.mal-open').forEach(el => {
            el.addEventListener('click', () => openOnAniList(list[+el.dataset.idx].malId, mediaType()));
        });

        container.querySelectorAll('.mal-import-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const entry = list[+btn.dataset.idx];
                showImportConfirm(1, (mode) => runImport([entry], mediaType(), mode, { [entry.malId]: btn }));
            });
        });

        document.getElementById('mal-import-all')?.addEventListener('click', () => {
            const buttons = {};
            container.querySelectorAll('.mal-import-btn').forEach(b => { buttons[list[+b.dataset.idx].malId] = b; });
            showImportConfirm(filtered.length, (mode) => runImport(filtered, mediaType(), mode, buttons));
        });
    }

    async function runImport(entries, type, mode, buttons) {
        const token = getToken();
        const user = getState().user;
        if (!token || !user) return toast('Log in to AniList first', 'error');
        if (importing) return;
        importing = true;

        const allBtn = document.getElementById('mal-import-all');
        const statusEl = document.getElementById('mal-import-status');
        const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
        const setBtn = (malId, text, color) => {
            const b = buttons[malId];
            if (!b) return;
            b.disabled = true;
            b.textContent = text;
            if (color) b.style.color = color;
        };
        if (allBtn) allBtn.disabled = true;
        Object.values(buttons).forEach(b => { b.disabled = true; });

        let done = 0, skipped = 0, failed = 0;
        let next = 0; // first entry not handled yet — everything from here gets its button back on a stop
        const report = (prefix = '') => {
            const parts = [`${done} imported`];
            if (skipped) parts.push(`${skipped} skipped`);
            if (failed) parts.push(`${failed} failed`);
            setStatus(`${prefix}${parts.join(', ')} (${done + skipped + failed}/${entries.length})`);
        };
        const releaseRest = () => {
            for (const entry of entries.slice(next)) {
                const b = buttons[entry.malId];
                if (!b) continue;
                b.disabled = false;
                b.textContent = 'Import';
                b.style.color = '';
            }
            if (allBtn) allBtn.disabled = false;
        };

        // No retry queue here: it keeps only 50 changes, so a big import would push out the
        // user's own edits. The shared request budget paces the writes; a 429 pauses the import.
        const save = async (vars) => {
            for (let attempt = 1; ; attempt++) {
                try {
                    return await api.saveMediaListEntry(vars, token, { queue: false });
                } catch (err) {
                    if (!err.throttled || attempt >= 3) throw err;
                    setStatus('Waiting for a free AniList request…');
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
        };

        try {
            setStatus('Matching titles on AniList…');
            const idMap = await api.resolveMalIds(entries.map(e => e.malId).filter(Boolean), type);

            let existing = new Set();
            if (mode === 'merge') {
                setStatus('Checking your AniList list…');
                const lists = await api.getMediaList(user.id, type, token);
                existing = new Set(lists.flatMap(l => l.entries.map(e => e.mediaId)));
            }

            for (; next < entries.length; next++) {
                const entry = entries[next];
                const anilistId = idMap.get(entry.malId);
                if (!anilistId) {
                    failed++;
                    setBtn(entry.malId, 'Not found', 'var(--danger)');
                } else if (existing.has(anilistId)) {
                    skipped++;
                    setBtn(entry.malId, 'Exists', 'var(--text-secondary)');
                } else {
                    const vars = { mediaId: anilistId, status: MAL_STATUS_MAP[entry.status] || 'PLANNING', progress: entry.progress };
                    if (entry.score > 0) vars.scoreRaw = entry.score * 10;
                    try {
                        await save(vars);
                        done++;
                        setBtn(entry.malId, 'Added', 'var(--success)');
                    } catch (err) {
                        if (err.rateLimited || err.throttled) throw err;
                        failed++;
                        setBtn(entry.malId, 'Error', 'var(--danger)');
                        console.error('MAL import failed for', entry.title, err);
                    }
                    await new Promise(r => setTimeout(r, IMPORT_DELAY));
                }
                report();
            }

            report('Done! ');
            if (allBtn) allBtn.textContent = `Done (${done})`;
            toast(`Imported ${done} entries to AniList`, 'success');
        } catch (err) {
            releaseRest();
            if (err.rateLimited || err.throttled) {
                const left = entries.length - next;
                report(`Paused, AniList is rate limiting — ${left} left. Import again in a few minutes; "Add new only" skips what is already there. `);
                toast(`Import paused: ${left} entries left, try again in a few minutes`, 'error');
            } else {
                toast(err.message, 'error');
                report('Stopped: ');
            }
        } finally {
            importing = false;
        }
    }

    renderView();
}

function renderMALEntry(entry, idx) {
    const statusLabel = MAL_STATUS_LABELS[entry.status] || entry.status || '';
    return `<div class="list-entry" style="align-items:center">
        <div class="list-entry-info" style="flex:1;min-width:0">
            <div class="list-entry-title mal-open" style="cursor:pointer" data-idx="${idx}">${esc(entry.title)}</div>
            <div class="list-entry-meta">
                <span style="color:var(--text-secondary)">${esc(statusLabel)}</span>
                · ${entry.progress}/${entry.total || '?'}
                ${entry.score ? ` · <span style="color:var(--user-accent)">${entry.score}/10</span>` : ''}
            </div>
        </div>
        ${isLoggedIn() ? `<button class="glass-btn glass-btn-secondary glass-btn-sm mal-import-btn" data-idx="${idx}" style="flex-shrink:0">Import</button>` : ''}
    </div>`;
}

async function openOnAniList(malId, type) {
    try {
        const id = (await api.resolveMalIds([malId], type)).get(malId);
        if (id) window.__openDetailPanel(id);
        else toast('Not found on AniList', 'error');
    } catch {
        toast('Could not find on AniList', 'error');
    }
}

function showImportConfirm(count, onConfirm) {
    const container = document.getElementById('modal-container');
    if (!container) return;

    const label = count === 1 ? 'this entry' : `${count} entries`;
    container.innerHTML = `<div class="modal-backdrop">
        <div class="modal-content" style="text-align:center">
            <div class="modal-title">Confirm import</div>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-lg);font-size:0.9rem">
                Import ${esc(label)} to AniList?
            </p>
            <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
                <button class="glass-btn glass-btn-primary" id="mal-confirm-merge">
                    Add new only
                    <span style="display:block;font-size:0.75rem;font-weight:400;opacity:0.7;margin-top:2px">Only add what is not on your list yet, keep existing entries</span>
                </button>
                <button class="glass-btn glass-btn-secondary" id="mal-confirm-overwrite">
                    Overwrite
                    <span style="display:block;font-size:0.75rem;font-weight:400;opacity:0.7;margin-top:2px">Import everything, replacing existing entries with the MAL data</span>
                </button>
                <button class="glass-btn glass-btn-secondary" id="mal-confirm-cancel" style="margin-top:var(--space-xs)">Cancel</button>
            </div>
        </div>
    </div>`;
    container.hidden = false;

    const release = openDialog(container.querySelector('.modal-content'), { label: 'Confirm import', onClose: () => close(), focus: '#mal-confirm-cancel' });
    const close = () => { release(); container.hidden = true; container.innerHTML = ''; };

    document.getElementById('mal-confirm-merge').addEventListener('click', () => { close(); onConfirm('merge'); });
    document.getElementById('mal-confirm-overwrite').addEventListener('click', () => { close(); onConfirm('overwrite'); });
    document.getElementById('mal-confirm-cancel').addEventListener('click', close);
    container.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
}
