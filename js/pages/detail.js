import * as api from '../api.js?v=113';
import { enhanceSelect } from '../select.js?v=113';
import { tasteMatch } from '../taste.js?v=113';
import { getState, toast, renderMediaCard, esc, titlePref, emitListChange, statusLabel, scoreInputHtml, fmtScore, emitWatched } from '../store.js?v=113';
import { getToken, isLoggedIn } from '../auth.js?v=113';
import { getActiveParty, startParty, createPartyLink } from './watchparty.js?v=113';
import { showConfirm } from '../a11y.js?v=113';

export async function renderPanel(id, container) {
    const token = getToken();
    const media = await api.getMedia(id, token);
    container.innerHTML = renderDetailHTML(media);
    fixBannerFit(container);
    // For the M3 design: the panel takes on the colours of this show's cover (js/m3.js)
    document.dispatchEvent(new CustomEvent('aniroll:media-shown', { detail: { media, root: container.closest('.detail-panel') || container, where: 'panel' } }));
    setupListActions(media, token, container);
    setupShare(media, container);
    setupSpoilerTags(container);
    loadFriendsStatus(media, token, container);
    loadTasteMatch(media, token, container);
}

export async function render({ params, content }) {
    const id = parseInt(params.id);
    const token = getToken();
    const media = await api.getMedia(id, token);

    content.innerHTML = `<div class="page-enter">${renderDetailHTML(media)}</div>`;
    fixBannerFit(content);
    document.dispatchEvent(new CustomEvent('aniroll:media-shown', { detail: { media, root: document.documentElement, where: 'page' } }));
    setupListActions(media, token, content);
    setupShare(media, content);
    setupSpoilerTags(content);
    loadFriendsStatus(media, token, content);
    loadTasteMatch(media, token, content);
}

function fixBannerFit(container) {
    const img = container.querySelector('.detail-banner-img');
    if (!img) return;
    const check = () => {
        if (img.naturalWidth && img.naturalHeight) {
            if (img.naturalWidth / img.naturalHeight < 2.5) {
                img.style.objectFit = 'contain';
            }
        }
    };
    if (img.complete) check();
    else img.addEventListener('load', check);
}

function renderDetailHTML(media) {
    const isAnime = media.type === 'ANIME';
    return `
        ${media.bannerImage ? `<div class="detail-banner">
            <img class="detail-banner-img" src="${media.bannerImage}" alt="">
            <div class="detail-banner-gradient"></div>
        </div>` : ''}

        <div class="detail-header${media.bannerImage ? '' : ' no-banner'}">
            <div class="detail-cover">
                <img src="${media.coverImage?.extraLarge || media.coverImage?.large}" alt="${esc(titlePref(media.title))}">
            </div>
            <div class="detail-info">
                <h1 class="detail-title">${esc(titlePref(media.title))}</h1>
                ${media.title?.english && media.title.english !== titlePref(media.title) ? `<div class="detail-sub">${esc(media.title.english)}</div>` : ''}
                ${media.title?.native ? `<div class="detail-sub" style="font-size:0.85rem">${esc(media.title.native)}</div>` : ''}
                <div class="detail-meta">
                    ${media.format ? `<span class="detail-tag">${api.formatFormat(media.format)}</span>` : ''}
                    ${media.status ? `<span class="detail-tag">${api.formatMediaStatus(media.status)}</span>` : ''}
                    ${isAnime && media.episodes ? `<span class="detail-tag">${media.episodes} Episodes</span>` : ''}
                    ${!isAnime && media.chapters ? `<span class="detail-tag">${media.chapters} Chapters</span>` : ''}
                    ${media.duration ? `<span class="detail-tag">${media.duration} min/ep</span>` : ''}
                    ${media.season ? `<span class="detail-tag">${api.getSeasonName(media.season)} ${media.seasonYear}</span>` : ''}
                    ${mainStudio(media) ? `<span class="detail-tag">${esc(mainStudio(media))}</span>` : ''}
                    ${media.source ? `<span class="detail-tag">Source: ${media.source.replace(/_/g, ' ')}</span>` : ''}
                </div>
                <div class="taste-match" id="taste-match" hidden></div>
                <div class="detail-actions">
                    <span class="detail-actions-inner" id="detail-actions">${renderListButton(media)}</span>
                    <button class="glass-btn glass-btn-secondary" id="detail-share" title="Copy a link that previews this title">
                        <svg data-icon="share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-2px;margin-right:6px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>Share
                    </button>
                </div>
            </div>
        </div>

        <div class="box detail-stats" style="margin:var(--space-xl) 0;padding:var(--space-lg);background:var(--bg-secondary)">
            ${media.meanScore ? `<div class="detail-stat"><div class="detail-stat-value" style="color:var(--user-accent)">${media.meanScore}%</div><div class="detail-stat-label">Score</div></div>` : ''}
            ${media.popularity ? `<div class="detail-stat"><div class="detail-stat-value">${(media.popularity / 1000).toFixed(1)}K</div><div class="detail-stat-label">Popularity</div></div>` : ''}
            ${media.nextAiringEpisode ? `<div class="detail-stat"><div class="detail-stat-value">Ep ${media.nextAiringEpisode.episode}</div><div class="detail-stat-label">in ${api.timeUntil(api.untilAiring(media.nextAiringEpisode))}</div></div>` : ''}
            ${isAnime && media.episodes ? `<div class="detail-stat"><div class="detail-stat-value">${media.episodes}</div><div class="detail-stat-label">Episodes</div></div>` : ''}
            ${!isAnime && media.chapters ? `<div class="detail-stat"><div class="detail-stat-value">${media.chapters}</div><div class="detail-stat-label">Chapters</div></div>` : ''}
        </div>

        <div id="friends-status-section"></div>

        ${media.description ? `<div class="box" style="padding:var(--space-lg);margin-bottom:var(--space-xl);">
            <h3 style="margin-bottom:var(--space-sm);font-size:1rem">Description</h3>
            <div class="detail-description">${cleanDescription(media.description)}</div>
        </div>` : ''}

        ${studiosHtml(media)}
        ${relatedHtml(media)}

        ${media.genres?.length ? `<div style="margin-bottom:var(--space-xl)">
            <div class="genre-chips">${media.genres.map(g => `<a href="#/search?genre=${encodeURIComponent(g)}" class="genre-chip">${esc(g)}</a>`).join('')}</div>
        </div>` : ''}

        ${media.characters?.edges?.length ? `<div style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Characters</h3>
            <div class="char-grid">${media.characters.edges.map(e => `
                <div class="char-card">
                    <img class="char-img" src="${e.node?.image?.medium || ''}" alt="${esc(e.node?.name?.full)}" loading="lazy">
                    <div class="char-info">
                        <div class="char-name">${esc(e.node?.name?.full)}</div>
                        <div class="char-role">${esc(e.role)}</div>
                    </div>
                    ${e.voiceActors?.[0] ? `<a class="char-va" href="#/staff/${e.voiceActors[0].id}" title="More roles of ${esc(e.voiceActors[0].name?.full)}">
                        <span class="char-info"><span class="char-name">${esc(e.voiceActors[0].name?.full)}</span><span class="char-role">Voice</span></span>
                        <img class="char-img" src="${e.voiceActors[0].image?.medium || ''}" alt="" loading="lazy">
                    </a>` : ''}
                </div>`).join('')}</div>
        </div>` : ''}

        ${media.recommendations?.nodes?.length ? `<div style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Recommendations</h3>
            <div class="scroll-row">${media.recommendations.nodes.filter(r => r.mediaRecommendation).map(r => `
                <div style="flex:0 0 150px">${renderMediaCard(r.mediaRecommendation)}</div>`).join('')}</div>
        </div>` : ''}

        ${renderExternalLinks(media.externalLinks)}

        ${media.tags?.length ? `<div style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Tags</h3>
            <div class="genre-chips">${media.tags
                .map(t => `<span class="genre-chip${t.isMediaSpoiler ? ' spoiler-tag' : ''}" style="cursor:default"${t.isMediaSpoiler ? ' hidden' : ''}>${esc(t.name)} <small style="opacity:0.6">${t.rank}%</small></span>`).join('')}
                ${spoilerCount(media) ? `<button class="genre-chip spoiler-toggle" aria-expanded="false">Show ${spoilerCount(media)} spoiler tag${spoilerCount(media) === 1 ? '' : 's'}</button>` : ''}</div>
        </div>` : ''}

        ${media.stats ? renderDistribution(media.stats, media.type) : ''}

        ${media.reviews?.nodes?.length ? `<div style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Reviews</h3>
            ${media.reviews.nodes.map(r => `
                <div class="box" style="padding:var(--space-md);margin-bottom:var(--space-sm);">
                    <div class="activity-header" style="margin-bottom:var(--space-sm)">
                        <img class="activity-avatar" src="${r.user?.avatar?.medium || ''}" alt="${esc(r.user?.name)}" style="width:32px;height:32px">
                        <div>
                            <a href="#/user/${esc(r.user?.name)}" class="activity-user" style="font-size:0.85rem">${esc(r.user?.name)}</a>
                            <div style="font-size:0.75rem;color:var(--text-secondary)">${r.score}/100</div>
                        </div>
                    </div>
                    <p style="font-size:0.85rem;color:var(--text-secondary)">${esc(r.summary)}</p>
                </div>`).join('')}
        </div>` : ''}

        ${media.trailer?.site === 'youtube' ? `<div style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Trailer</h3>
            <div class="box box-media" style="overflow:hidden;aspect-ratio:16/9">
                <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${media.trailer.id}" frameborder="0" allowfullscreen style="display:block"></iframe>
            </div>
        </div>` : ''}

        <span class="detail-fullscreen-btn" data-type="${media.type === 'MANGA' ? 'manga' : 'anime'}" hidden></span>
        <div style="text-align:center;padding:var(--space-lg)">
            <a href="https://anilist.co/${media.type === 'MANGA' ? 'manga' : 'anime'}/${media.id}" target="_blank" rel="noopener" class="glass-btn glass-btn-secondary">View on AniList</a>
        </div>`;
}

// Same colors as the status distribution chart further down the panel
const STATUS_COLORS = {
    CURRENT: 'var(--user-accent)',
    REPEATING: 'var(--user-accent)',
    PLANNING: 'var(--text-tertiary)',
    COMPLETED: 'var(--success)',
    PAUSED: 'var(--warning)',
    DROPPED: 'var(--danger)',
};

const ICON_STUDIO = '<svg data-icon="movie" class="detail-studio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 8l2.5-4.5L9 8M9 3.5 12 8M14 3.5 17 8M19 3.5 21 8"/></svg>';
const ICON_PRODUCER = '<svg data-icon="apartment" class="detail-studio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 10h4a1 1 0 0 1 1 1v10M3 21h18M8 8h3M8 12h3M8 16h3"/></svg>';
const ICON_ARROW = '<svg data-icon="arrow_forward" class="detail-studio-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

// Tags that give away the story stay hidden until someone asks for them
const spoilerCount = media => (media.tags || []).filter(t => t.isMediaSpoiler).length;

function setupSpoilerTags(root) {
    const btn = root.querySelector('.spoiler-toggle');
    btn?.addEventListener('click', () => {
        const show = btn.getAttribute('aria-expanded') !== 'true';
        root.querySelectorAll('.spoiler-tag').forEach(t => { t.hidden = !show; });
        btn.setAttribute('aria-expanded', String(show));
        const n = root.querySelectorAll('.spoiler-tag').length;
        btn.textContent = show ? 'Hide spoiler tags' : `Show ${n} spoiler tag${n === 1 ? '' : 's'}`;
    });
}

// The main animation studio's name, for the tags under the title
const mainStudio = (media) => (media.studios?.edges || []).find(e => e.isMain && e.node?.isAnimationStudio)?.node.name || '';

// Everyone who made the show, as cards that open the studio's page: animation studios first, then producers
function studiosHtml(media) {
    const seen = new Set();
    const edges = (media.studios?.edges || [])
        .filter(e => e.node && !seen.has(e.node.id) && seen.add(e.node.id))
        .sort((a, b) => (b.node.isAnimationStudio - a.node.isAnimationStudio) || (b.isMain - a.isMain));
    if (!edges.length) return '';
    return `<div class="detail-studios" role="list" aria-label="Studios">${edges.slice(0, 8).map(e => `
        <a class="box detail-studio" role="listitem" href="#/studio/${e.node.id}">
            ${e.node.isAnimationStudio ? ICON_STUDIO : ICON_PRODUCER}
            <span class="detail-studio-text">
                <span class="detail-studio-name">${esc(e.node.name)}</span>
                <span class="detail-studio-role">${e.node.isAnimationStudio ? 'Animation studio' : 'Producer'}</span>
            </span>
            ${ICON_ARROW}
        </a>`).join('')}</div>`;
}

// Sequels, prequels and the rest as a row of covers: what comes before and after at a glance
function relatedHtml(media) {
    const edges = (media.relations?.edges || []).filter(e => e.node);
    if (!edges.length) return '';
    const kind = (t) => { const s = String(t || '').replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
    return `<section class="detail-related" aria-label="Related">
        <h3 class="detail-related-title">Related</h3>
        <div class="detail-related-row">${edges.map(e => `
            <button type="button" class="detail-related-item" data-open="${e.node.id}" title="${esc(titlePref(e.node.title))}">
                <img src="${esc(e.node.coverImage?.large || '')}" alt="${esc(titlePref(e.node.title))}" loading="lazy">
                <span class="detail-related-kind">${esc(kind(e.relationType))}</span>
            </button>`).join('')}</div>
    </section>`;
}

function renderListButton(media) {
    if (!isLoggedIn()) {
        return `<button class="glass-btn glass-btn-primary" data-login>Log in to track</button>`;
    }

    const entry = media.mediaListEntry;
    if (entry) {
        return `
            <select class="glass-select" id="status-select" style="min-width:150px">
                ${['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].map(s =>
                    `<option value="${s}" ${entry.status === s ? 'selected' : ''}>${statusLabel(s, media.type)}</option>`).join('')}
            </select>
            <div class="list-entry-progress">
                <button class="progress-btn" id="dec-progress">−</button>
                <span class="progress-text" id="progress-display">${entry.progress}/${media.episodes || media.chapters || '?'}</span>
                <button class="progress-btn" id="inc-progress">+</button>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-sm)">
                <span style="font-size:0.85rem;color:var(--text-secondary)">Score:</span>
                ${scoreInputHtml(entry.score)}
            </div>
            <button class="glass-btn glass-btn-sm glass-btn-secondary" id="remove-entry" style="color:var(--danger);padding:6px 10px" title="Remove from list"><svg data-icon="delete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
            ${media.type === 'ANIME' && ['CURRENT', 'REPEATING', 'COMPLETED'].includes(entry.status) ? `<button class="glass-btn glass-btn-sm glass-btn-secondary" id="start-watchparty" style="border-color:var(--user-accent);color:var(--user-accent);display:inline-flex;align-items:center;gap:4px;padding:6px 10px"><svg data-icon="live_tv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>Watch Party</button>` : ''}`;
    }

    return `
        <button class="glass-btn glass-btn-primary" id="add-to-list">+ Add to List</button>
        <button class="glass-btn glass-btn-secondary" id="add-planning">${media.type === 'MANGA' ? 'Plan to Read' : 'Plan to Watch'}</button>`;
}

// Hands the display fields to our backend so a shared link previews the title itself,
// then copies the short URL. The backend cannot ask AniList for this (it is blocked).
async function publishShare(media) {
    const meta = [
        media.format ? api.formatFormat(media.format) : '',
        media.type === 'MANGA'
            ? (media.chapters ? `${media.chapters} Ch` : '')
            : (media.episodes ? `${media.episodes} Ep` : ''),
        media.meanScore ? `${media.meanScore}% on AniList` : '',
    ].filter(Boolean).join(' · ');
    const synopsis = String(media.description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 170);

    await fetch('/share/anime', {
        method: 'POST',
        // Only a confirmed account may replace a preview someone else already stored
        headers: { 'Content-Type': 'application/json', ...(isLoggedIn() ? { Authorization: 'Bearer ' + getToken() } : {}) },
        body: JSON.stringify({
            id: media.id,
            type: media.type === 'MANGA' ? 'MANGA' : 'ANIME',
            title: titlePref(media.title),
            cover: media.coverImage?.extraLarge || media.coverImage?.large || '',
            description: [meta, synopsis].filter(Boolean).join(' — '),
        }),
        signal: AbortSignal.timeout(8000),
    });
}

function setupShare(media, root = document) {
    const btn = root.querySelector('#detail-share');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        const url = `${window.location.origin}/a/${media.id}`;
        const title = titlePref(media.title);
        try {
            await publishShare(media);
        } catch {
            // Link still works, the preview just falls back to the generic AniRoll card
        }
        try {
            if (navigator.share) await navigator.share({ title, url });
            else {
                await navigator.clipboard.writeText(url);
                toast('Share link copied', 'success');
            }
        } catch (err) {
            if (err?.name !== 'AbortError') toast(url, 'info');
        }
        btn.disabled = false;
    });
}

function setupListActions(media, token, root = document) {
    const isAnime = media.type === 'ANIME';
    let entry = media.mediaListEntry;
    let progress = entry?.progress || 0;

    const q = (sel) => root.querySelector(sel);
    enhanceSelect(q('#status-select'), { colors: STATUS_COLORS });

    function refreshActions(newEntry) {
        media.mediaListEntry = newEntry;
        entry = newEntry;
        progress = newEntry?.progress || 0;
        const actionsEl = q('#detail-actions');
        if (actionsEl) {
            actionsEl.innerHTML = renderListButton(media);
            setupListActions(media, token, root);
        }
    }

    q('#add-to-list')?.addEventListener('click', async () => {
        try {
            const saved = await api.saveMediaListEntry({ mediaId: media.id, status: 'CURRENT' }, token);
            toast('Added to list', 'success');
            refreshActions(saved);
        } catch (e) { toast(e.message, 'error'); }
    });

    q('#add-planning')?.addEventListener('click', async () => {
        try {
            const saved = await api.saveMediaListEntry({ mediaId: media.id, status: 'PLANNING' }, token);
            toast('Added to planning', 'success');
            refreshActions(saved);
        } catch (e) { toast(e.message, 'error'); }
    });

    q('#status-select')?.addEventListener('change', async (e) => {
        try {
            const saved = await api.saveMediaListEntry({ id: entry.id, status: e.target.value }, token);
            toast('Status updated', 'success');
            emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress });
            entry.status = e.target.value;
            refreshActions({ ...entry, ...saved });
        } catch (e2) { toast(e2.message, 'error'); }
    });

    const max = isAnime ? media.episodes : media.chapters;

    // Serialize saves so rapid clicks can't land out of order on AniList
    let saveChain = Promise.resolve();
    function saveProgress() {
        const target = progress;
        saveChain = saveChain.then(async () => {
            if (target !== progress) return; // a newer click will save
            const vars = api.progressVars(entry, target, max);
            try {
                const saved = await api.saveMediaListEntry(vars, token);
                emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress });
                emitWatched(media);
                const statusChanged = saved.status !== entry.status;
                Object.assign(entry, saved);
                if (vars.status === 'COMPLETED') toast('Completed!', 'success');
                if (statusChanged && target === progress) refreshActions({ ...entry });
            } catch (e) { toast(e.message, 'error'); }
        });
    }

    q('#inc-progress')?.addEventListener('click', () => {
        if (max && progress >= max) return;
        progress++;
        updateProgressDisplay(progress, max, root);
        saveProgress();
    });

    q('#dec-progress')?.addEventListener('click', () => {
        if (progress <= 0) return;
        progress--;
        updateProgressDisplay(progress, max, root);
        saveProgress();
    });

    // Scores are out of 100 in AniRoll, whatever the AniList format (store.js)
    const saveScore = async (scoreRaw) => {
        try {
            await api.saveMediaListEntry({ id: entry.id, scoreRaw }, token);
            entry.score = scoreRaw;
            toast(scoreRaw ? `Score saved: ${fmtScore(scoreRaw)}` : 'Score removed', 'success');
        } catch (err) { toast(err.message, 'error'); }
    };
    q('#score-input')?.addEventListener('change', (e) => {
        const scoreRaw = Math.min(100, Math.round(Math.max(0, parseFloat(e.target.value) || 0)));
        e.target.value = scoreRaw || '';
        saveScore(scoreRaw);
    });

    q('#remove-entry')?.addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Remove from List',
            message: `Remove "${titlePref(media.title)}" from your list?`,
            confirmText: 'Remove',
            danger: true
        });
        if (!ok) return;
        try {
            await api.deleteMediaListEntry(entry.id, token);
            toast('Removed from list', 'success');
            emitListChange({ mediaId: media.id, removed: true });
            refreshActions(null);
        } catch (e) { toast(e.message, 'error'); }
    });

    q('#start-watchparty')?.addEventListener('click', async () => {
        const { user } = getState();
        if (!user?.name) return toast('Not logged in', 'error');
        const activeParty = getActiveParty();
        if (activeParty) {
            const ok = await showConfirm({
                title: 'Replace Watch Party',
                message: 'You already have an active Watch Party. Starting a new one will end the current party.',
                confirmText: 'Start New',
                danger: true
            });
            if (!ok) return;
        }
        // A completed show watched again with friends: the party runs as a rewatch from episode 0
        let startEp = progress;
        if (entry.status === 'COMPLETED') {
            const rewatch = await showConfirm({
                title: 'Start a rewatch party',
                message: 'You completed this before. Your entry is set to Rewatching at episode 0, members follow your counter, and finishing counts a rewatch.',
                confirmText: 'Start rewatch',
            });
            if (!rewatch) return;
            try {
                const saved = await api.saveMediaListEntry({ id: entry.id, status: 'REPEATING', progress: 0 }, token);
                Object.assign(entry, saved);
                startEp = 0;
            } catch (e) { return toast(e.message, 'error'); }
        }
        let link;
        try {
            link = await startParty(media.id, titlePref(media.title), user.name, startEp, media.coverImage?.large);
        } catch (e) { return toast(e.message, 'error'); }
        navigator.clipboard?.writeText(link).catch(() => {});
        toast('Watch Party started! Link copied.', 'success');
        window.location.hash = '#/watchparty';
    });
}

function updateProgressDisplay(progress, max, root = document) {
    const el = root.querySelector('#progress-display');
    if (el) el.textContent = `${progress}/${max || '?'}`;
}

function cleanDescription(desc) {
    return desc
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n').filter(l => l.trim()).map(l => `<p style="margin-bottom:0.5em">${l.trim()}</p>`).join('');
}

function renderExternalLinks(links) {
    if (!links?.length) return '';
    const streaming = links.filter(l => l.type === 'STREAMING');
    const info = links.filter(l => l.type !== 'STREAMING');
    if (!streaming.length && !info.length) return '';

    return `<div style="margin-bottom:var(--space-xl)">
        ${streaming.length ? `<h3 class="section-title" style="margin-bottom:var(--space-md)">Streaming</h3>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-sm);margin-bottom:var(--space-md)">
            ${streaming.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="glass-btn glass-btn-secondary" style="font-size:0.8rem">${esc(l.site)}</a>`).join('')}
        </div>` : ''}
        ${info.length ? `<div style="display:flex;flex-wrap:wrap;gap:var(--space-sm)">
            ${info.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="glass-btn glass-btn-secondary glass-btn-sm">${esc(l.site)}</a>`).join('')}
        </div>` : ''}
    </div>`;
}

// "87% Match": how well this show fits the user's taste (js/taste.js). Anime only. The profile is
// one cached request; the show's own genres and tags already came with the panel.
async function loadTasteMatch(media, token, root) {
    const el = root.querySelector('#taste-match');
    const user = getState().user;
    if (!el || !token || !user?.id || media.type !== 'ANIME') return;
    try {
        const result = tasteMatch(await api.getTasteProfile(user.id, token), media);
        if (!result) return;
        const why = [
            result.fits.length ? `Fits: ${result.fits.map(esc).join(', ')}` : '',
            result.misses.length ? `Less: ${result.misses.map(esc).join(', ')}` : '',
        ].filter(Boolean).join(' · ');
        el.innerHTML = `<span class="taste-match-badge" title="How well this fits your taste, from the genres and tags of the shows on your list. Not the AniList score, and not a verdict on quality.">${result.match}% Match</span>
            ${why ? `<span class="taste-match-why">${why}</span>` : ''}`;
        el.hidden = false;
    } catch {
        // An extra — the panel is complete without it
    }
}

async function loadFriendsStatus(media, token, root) {
    if (!token || localStorage.getItem('aniroll_friends_status') === 'off') return;

    const { user } = getState();
    if (!user?.id) return;

    const section = root.querySelector('#friends-status-section');
    if (!section) return;

    try {
        const allFriends = await api.getFriendsMediaStatus(media.id, user.id, token);
        const friends = allFriends.filter(f => f.user.id !== user.id);
        if (!friends.length) return;

        const isAnime = media.type === 'ANIME';
        const maxEp = isAnime ? media.episodes : media.chapters;
        const unit = isAnime ? 'Ep' : 'Ch';

        section.innerHTML = `<div class="friends-status" style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Friends</h3>
            <div class="friends-status-list">
                ${friends.map(f => {
                    const status = statusLabel(f.status, media.type);
                    const progressText = f.progress ? `${unit} ${f.progress}${maxEp ? '/' + maxEp : ''}` : '';
                    // The score has its own badge — keep the meta line short so pills stay compact
                    const meta = [status, progressText].filter(Boolean).join(' · ');
                    return `<a href="#/user/${esc(f.user.name)}" class="friend-status-card">
                        <img class="friend-status-avatar" src="${f.user.avatar?.medium || ''}" alt="${esc(f.user.name)}" loading="lazy">
                        <div class="friend-status-info">
                            <div class="friend-status-name">${esc(f.user.name)}</div>
                            <div class="friend-status-meta">${meta}</div>
                        </div>
                        ${f.score ? `<div class="friend-status-score" style="color:${f.score >= 75 ? 'var(--success)' : f.score >= 50 ? 'var(--warning)' : 'var(--danger)'}">${fmtScore(f.score)}</div>` : ''}
                    </a>`;
                }).join('')}
            </div>
        </div>`;
    } catch (e) {
        console.error('Friends status load failed:', e);
    }
}

function renderDistribution(stats, type) {
    const scoreDist = stats.scoreDistribution || [];
    const statusDist = stats.statusDistribution || [];
    if (!scoreDist.length && !statusDist.length) return '';

    const maxScore = Math.max(...scoreDist.map(s => s.amount), 1);
    const maxStatus = Math.max(...statusDist.map(s => s.amount), 1);

    const statusColors = { CURRENT: 'var(--user-accent)', PLANNING: 'var(--text-tertiary)', COMPLETED: 'var(--success)', DROPPED: 'var(--danger)', PAUSED: 'var(--warning)' };

    return `<div class="stats-grid" style="margin-bottom:var(--space-xl)">
        <div class="box stat-chart" style="background:var(--bg-secondary)">
            <div class="stat-chart-title">Score Distribution</div>
            <div class="stat-bar-chart">
                ${scoreDist.map(s => `<div class="stat-bar-row">
                    <span class="stat-bar-label">${s.score}</span>
                    <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.amount / maxScore * 100)}%"></div></div>
                    <span class="stat-bar-value">${s.amount}</span>
                </div>`).join('')}
            </div>
        </div>
        <div class="box stat-chart" style="background:var(--bg-secondary)">
            <div class="stat-chart-title">Status Distribution</div>
            <div class="stat-bar-chart">
                ${statusDist.map(s => `<div class="stat-bar-row">
                    <span class="stat-bar-label">${statusLabel(s.status, type)}</span>
                    <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.amount / maxStatus * 100)}%;background:${statusColors[s.status] || 'var(--user-accent)'}"></div></div>
                    <span class="stat-bar-value">${s.amount}</span>
                </div>`).join('')}
            </div>
        </div>
    </div>`;
}
