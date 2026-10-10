import * as api from '../api.js?v=161';
import { enhanceSelect } from '../select.js?v=161';
import { tasteMatch } from '../taste.js?v=161';
import { getState, toast, renderMediaCard, esc, titlePref, emitListChange, statusLabel, scoreInputHtml, fmtScore, emitWatched } from '../store.js?v=161';
import { getToken, isLoggedIn } from '../auth.js?v=161';
import { getActiveParty, startParty, createPartyLink } from './watchparty.js?v=161';
import { showConfirm } from '../a11y.js?v=161';

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
    setupDetailTabs(container);
    setupRelatedPlan(container, token);
    loadPlayButton(media, container);
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
    setupDetailTabs(content);
    setupRelatedPlan(content, token);
    loadPlayButton(media, content);
    loadFriendsStatus(media, token, content);
    loadTasteMatch(media, token, content);
}

// The episode to play next: after the last one watched, from the start once finished
function nextEpisode(media) {
    const entry = media.mediaListEntry;
    if (media.format === 'MOVIE' || !entry || entry.status === 'COMPLETED') return 1;
    const next = (entry.progress || 0) + 1;
    return media.episodes ? Math.min(next, media.episodes) : next;
}

// "Play episode N" from the user's own Jellyfin (js/player/playbutton.js)
async function loadPlayButton(media, root) {
    const slot = root.querySelector('#detail-play');
    if (!slot || media.type !== 'ANIME') return;
    try {
        const { mountPlayButton } = await import('../player/playbutton.js?v=161');
        await mountPlayButton(slot, media, nextEpisode(media));
    } catch (err) {
        console.warn('Jellyfin player unavailable:', err.message);
    }
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

// Overview first; the long parts (cast, reviews, numbers) wait behind their own tab
function detailTabsHtml(media) {
    const tabs = [['overview', 'Overview', true], ['characters', 'Characters', media.characters?.edges?.length],
        ['reviews', 'Reviews', media.reviews?.nodes?.length], ['stats', 'Stats', media.stats], ['trailer', 'Trailer', media.trailer?.site === 'youtube']].filter(t => t[2]);
    if (tabs.length < 2) return '';
    return `<div class="tab-group detail-tabs" role="tablist" aria-label="Sections">${tabs.map(([key, label], i) =>
        `<button class="tab-btn${i ? '' : ' active'}" role="tab" id="detail-tabbtn-${key}" aria-controls="detail-tab-${key}" aria-selected="${!i}" data-detail-tab="${key}">${label}</button>`).join('')}</div>`;
}

function setupDetailTabs(root) {
    const btns = [...root.querySelectorAll('[data-detail-tab]')];
    const select = (btn) => btns.forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        const panel = root.querySelector(`#detail-tab-${b.dataset.detailTab}`);
        if (panel) panel.hidden = !on;
    });
    btns.forEach((b, i) => {
        b.tabIndex = i ? -1 : 0;
        b.addEventListener('click', () => select(b));
        // Arrow keys move between tabs, as a tab list does
        b.addEventListener('keydown', (e) => {
            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            const to = btns[(i + step + btns.length) % btns.length];
            select(to);
            to.focus();
        });
    });
}

// The plain facts under the score as one line of text: they are information, not something to press, so they
// aren't chips (M3 keeps chips for actions, filters and choices). The next episode stands out in the accent
// The facts as two short phrases instead of a dotted row: what it is, then when, who made it and from what
function detailFactsHtml(media) {
    const isAnime = media.type === 'ANIME';
    const length = isAnime
        ? media.episodes && `${media.episodes} ${media.episodes === 1 ? 'episode' : 'episodes'}${media.duration ? ` of ${media.duration} min` : ''}`
        : media.chapters && `${media.chapters} chapters`;
    const what = [
        media.format && api.formatFormat(media.format),
        media.status && api.formatMediaStatus(media.status).toLowerCase(),
        length || (media.duration && `${media.duration} min`),
    ].filter(Boolean);
    const origin = [
        media.season && `${api.getSeasonName(media.season)} ${media.seasonYear}`,
        mainStudio(media),
        media.source && `from ${media.source.replace(/_/g, ' ').toLowerCase()}`,
    ].filter(Boolean);
    const next = media.nextAiringEpisode
        ? `<span class="detail-fact-next">Ep ${media.nextAiringEpisode.episode} in ${api.timeUntil(api.untilAiring(media.nextAiringEpisode))}</span>` : '';
    if (!what.length && !origin.length && !next) return '';
    return `<p class="detail-facts">${next}${[what, origin].filter(g => g.length).map(g => `<span>${esc(g.join(', '))}</span>`).join('')}</p>`;
}

function renderDetailHTML(media) {
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
                ${media.meanScore ? `<div class="detail-score" title="Average score on AniList"><span class="detail-score-value">${media.meanScore}%</span><span class="detail-score-label">score${media.popularity ? ` from ${(media.popularity / 1000).toFixed(1)}K members` : ''}</span></div>` : ''}
                ${detailFactsHtml(media)}
                <div class="taste-match" id="taste-match" hidden></div>
                <div class="detail-actions">
                    <span class="detail-play-slot" id="detail-play" hidden></span>
                    <span class="detail-actions-inner" id="detail-actions">${renderListButton(media)}</span>
                    <button class="glass-btn glass-btn-secondary" id="detail-share" title="Copy a link that previews this title">
                        <svg data-icon="share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-2px;margin-right:6px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>Share
                    </button>
                </div>
            </div>
        </div>

        ${detailTabsHtml(media)}

        <div class="detail-tabpanel" id="detail-tab-overview" role="tabpanel" aria-labelledby="detail-tabbtn-overview">
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

        ${media.recommendations?.nodes?.length ? `<div class="detail-recs" style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Recommendations</h3>
            <div class="scroll-row">${media.recommendations.nodes.filter(r => r.mediaRecommendation).map(r => `
                <div style="flex:0 0 150px">${renderMediaCard(r.mediaRecommendation, true)}</div>`).join('')}</div>
        </div>` : ''}

        ${tagsHtml(media)}

        ${renderExternalLinks(media.externalLinks, media)}

        </div>
        ${media.characters?.edges?.length ? `<div class="detail-tabpanel" id="detail-tab-characters" role="tabpanel" aria-labelledby="detail-tabbtn-characters" hidden>
        ${media.characters?.edges?.length ? `<div style="margin-bottom:var(--space-xl)">
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
        </div>` : ''}
        ${media.reviews?.nodes?.length ? `<div class="detail-tabpanel" id="detail-tab-reviews" role="tabpanel" aria-labelledby="detail-tabbtn-reviews" hidden>
        ${media.reviews?.nodes?.length ? `<div style="margin-bottom:var(--space-xl)">
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
        </div>` : ''}
        ${media.stats ? `<div class="detail-tabpanel" id="detail-tab-stats" role="tabpanel" aria-labelledby="detail-tabbtn-stats" hidden>
        ${media.stats ? renderDistribution(media.stats, media.type, media.mediaListEntry?.score) : ''}
        </div>` : ''}
        ${media.trailer?.site === 'youtube' ? `<div class="detail-tabpanel" id="detail-tab-trailer" role="tabpanel" aria-labelledby="detail-tabbtn-trailer" hidden>
        ${media.trailer?.site === 'youtube' ? `<div style="margin-bottom:var(--space-xl)">
            <div class="box box-media" style="overflow:hidden;aspect-ratio:16/9">
                <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${media.trailer.id}" frameborder="0" allowfullscreen loading="lazy" style="display:block"></iframe>
            </div>
        </div>` : ''}
        </div>` : ''}

        <span class="detail-fullscreen-btn" data-type="${media.type === 'MANGA' ? 'manga' : 'anime'}" hidden></span>`;
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

// "+ Plan" under a sequel in Related: one save, the label turns into the list it went to
function setupRelatedPlan(root, token) {
    root.querySelector('.detail-related-row')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-plan-id]');
        if (!btn) return;
        ev.stopPropagation();
        const mediaId = Number(btn.dataset.planId);
        btn.disabled = true;
        try {
            const saved = await api.saveMediaListEntry({ mediaId, status: 'PLANNING' }, token, { mirror: false });
            emitListChange({ mediaId, status: saved.status, progress: saved.progress });
            const where = btn.parentElement.querySelector('.detail-related-where');
            if (where) { where.textContent = 'Planning'; where.classList.add('is-listed'); }
            btn.remove();
            toast('Added to Planning', 'success');
        } catch (err) {
            btn.disabled = false;
            toast(err.queued ? err.message : `AniList: ${err.message}`, 'error');
        }
    });
}

// The tags that say most about a show come first (AniList ranks them); the rest wait behind "Show all"
const TAGS_SHOWN = 8;
function tagsHtml(media) {
    if (!media.tags?.length) return '';
    let shown = 0;
    const chips = media.tags.map(t => {
        const extra = !t.isMediaSpoiler && ++shown > TAGS_SHOWN;
        return `<a href="#/search?type=${media.type}&tag=${encodeURIComponent(t.name)}" class="genre-chip${t.isMediaSpoiler ? ' spoiler-tag' : ''}${extra ? ' tag-extra' : ''}" title="${t.rank}% relevant. Browse by this tag"${t.isMediaSpoiler || extra ? ' hidden' : ''}>${esc(t.name)}</a>`;
    }).join('');
    const more = shown - TAGS_SHOWN;
    return `<div style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Tags</h3>
            <div class="genre-chips">${chips}
                ${more > 0 ? `<button class="genre-chip tags-more-toggle">Show all ${shown} tags</button>` : ''}
                ${spoilerCount(media) ? `<button class="genre-chip spoiler-toggle" aria-expanded="false">Show ${spoilerCount(media)} spoiler tag${spoilerCount(media) === 1 ? '' : 's'}</button>` : ''}</div>
        </div>`;
}

function setupSpoilerTags(root) {
    const more = root.querySelector('.tags-more-toggle');
    more?.addEventListener('click', () => {
        root.querySelectorAll('.tag-extra').forEach(t => { t.hidden = false; });
        more.remove();
    });
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
// The next and the previous part come first, each saying where it stands on your list, and a sequel you
// have not added yet gets a Plan button: finishing a show, you see what comes next and keep it with one tap
const RELATION_ORDER = ['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'ADAPTATION', 'SOURCE'];
function relatedHtml(media) {
    const edges = (media.relations?.edges || []).filter(e => e.node);
    if (!edges.length) return '';
    const kind = (t) => { const s = String(t || '').replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
    const rank = (t) => (RELATION_ORDER.indexOf(t) + 1) || 99;
    const sorted = [...edges].sort((a, b) => rank(a.relationType) - rank(b.relationType));
    // Only what is on your list gets a line: "Not on your list" under every other cover said nothing new
    const where = (n) => (n.mediaListEntry?.status ? statusLabel(n.mediaListEntry.status, n.type) : '');
    return `<section class="detail-related" aria-label="Related">
        <h3 class="detail-related-title">Related</h3>
        <div class="detail-related-row">${sorted.map(e => {
            const n = e.node;
            const plan = isLoggedIn() && !n.mediaListEntry && ['SEQUEL', 'PREQUEL'].includes(e.relationType) && n.type === media.type;
            return `<div class="detail-related-cell">
            <button type="button" class="detail-related-item" data-open="${n.id}" title="${esc(titlePref(n.title))}">
                <img src="${esc(n.coverImage?.large || '')}" alt="${esc(titlePref(n.title))}" loading="lazy">
                <span class="detail-related-kind">${esc(kind(e.relationType))}</span>
            </button>
            ${where(n) ? `<span class="detail-related-where${n.mediaListEntry ? ' is-listed' : ''}">${esc(where(n))}</span>` : ''}
            ${plan ? `<button type="button" class="detail-related-plan" data-plan-id="${n.id}" aria-label="Add ${esc(titlePref(n.title))} to Planning">+ Plan</button>` : ''}
        </div>`;
        }).join('')}</div>
    </section>`;
}

// "Remove from list" sits at the end of the status menu instead of as its own red button next to it
const REMOVE = 'REMOVE';

function renderListButton(media) {
    if (!isLoggedIn()) {
        return `<button class="glass-btn glass-btn-primary" data-login>Log in to track</button>`;
    }

    const entry = media.mediaListEntry;
    if (entry) {
        return `
            <select class="glass-select" id="status-select" style="min-width:150px" aria-label="Status on your list">
                ${['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].map(s =>
                    `<option value="${s}" ${entry.status === s ? 'selected' : ''}>${statusLabel(s, media.type)}</option>`).join('')}
                <option value="${REMOVE}">Remove from list</option>
            </select>
            <div class="detail-entry">
                <div class="list-entry-progress">
                    <button class="progress-btn" id="dec-progress" aria-label="One ${media.type === 'MANGA' ? 'chapter' : 'episode'} less">−</button>
                    <span class="progress-text" id="progress-display">${entry.progress}/${media.episodes || media.chapters || '?'}</span>
                    <button class="progress-btn" id="inc-progress" aria-label="One ${media.type === 'MANGA' ? 'chapter' : 'episode'} more">+</button>
                </div>
                <label class="detail-entry-score"><span>Score</span>${scoreInputHtml(entry.score)}</label>
            </div>
            ${media.type === 'ANIME' && ['CURRENT', 'REPEATING', 'COMPLETED'].includes(entry.status) ? `<button class="glass-btn glass-btn-secondary" id="start-watchparty"><svg data-icon="group" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-2px;margin-right:6px"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 4 6"/></svg>Watch Party</button>` : ''}`;
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
        loadPlayButton(media, root);
    }

    q('#add-to-list')?.addEventListener('click', async () => {
        try {
            const saved = await api.saveMediaListEntry({ mediaId: media.id, status: 'CURRENT' }, token);
            toast('Added to list', 'success');
            emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress });
            refreshActions(saved);
        } catch (e) { toast(e.message, 'error'); }
    });

    q('#add-planning')?.addEventListener('click', async () => {
        try {
            const saved = await api.saveMediaListEntry({ mediaId: media.id, status: 'PLANNING' }, token);
            toast('Added to planning', 'success');
            emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress });
            refreshActions(saved);
        } catch (e) { toast(e.message, 'error'); }
    });

    q('#status-select')?.addEventListener('change', async (e) => {
        if (e.target.value === REMOVE) return removeEntry();
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
                emitWatched(media, saved.progress);
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
            const saved = await api.saveMediaListEntry({ id: entry.id, scoreRaw }, token);
            entry.score = scoreRaw;
            emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress, score: scoreRaw });
            toast(scoreRaw ? `Score saved: ${fmtScore(scoreRaw)}` : 'Score removed', 'success');
        } catch (err) { toast(err.message, 'error'); }
    };
    q('#score-input')?.addEventListener('change', (e) => {
        const scoreRaw = Math.min(100, Math.round(Math.max(0, parseFloat(e.target.value) || 0)));
        e.target.value = scoreRaw || '';
        saveScore(scoreRaw);
    });

    async function removeEntry() {
        const ok = await showConfirm({
            title: 'Remove from List',
            message: `Remove "${titlePref(media.title)}" from your list?`,
            confirmText: 'Remove',
            danger: true
        });
        // Cancelled: the row is drawn again, so the menu shows the real status instead of "Remove from list"
        if (!ok) return refreshActions(entry);
        try {
            await api.deleteMediaListEntry(entry.id, token);
            toast('Removed from list', 'success');
            emitListChange({ mediaId: media.id, removed: true });
            refreshActions(null);
        } catch (e) { toast(e.message, 'error'); refreshActions(entry); }
    }

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
        try {
            await startParty(media.id, titlePref(media.title), user.name, startEp, media.coverImage?.large);
        } catch (e) { return toast(e.message, 'error'); }
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

// Where to watch and where to read more, as plain links: they leave the app, nothing here to toggle or pick
function renderExternalLinks(links = [], media) {
    const link = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)}</a>`;
    const streaming = (links || []).filter(l => l.type === 'STREAMING');
    const info = (links || []).filter(l => l.type !== 'STREAMING');
    const anilist = { url: `https://anilist.co/${media.type === 'MANGA' ? 'manga' : 'anime'}/${media.id}`, site: 'AniList' };
    return `<div class="detail-links">
        ${streaming.length ? `<p class="detail-ext-info"><span class="detail-links-label">Watch on</span>${streaming.map(link).join('')}</p>` : ''}
        <p class="detail-ext-info"><span class="detail-links-label">More on</span>${[anilist, ...info].map(link).join('')}</p>
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

        // Friends at about the same episode (one apart at most): start a Watch Party with them from here
        const mine = media.mediaListEntry;
        const near = isAnime && mine && ['CURRENT', 'REPEATING'].includes(mine.status)
            ? friends.filter(f => ['CURRENT', 'REPEATING'].includes(f.status) && Math.abs((f.progress || 0) - (mine.progress || 0)) <= 1)
            : [];
        const together = near.length && root.querySelector('#start-watchparty')
            ? `<div class="friends-together">
                <span>${esc(near.slice(0, 2).map(f => f.user.name).join(' and '))}${near.length > 2 ? ` and ${near.length - 2} more` : ''} ${near.length > 1 ? 'are' : 'is'} where you are</span>
                <button type="button" class="glass-btn glass-btn-sm glass-btn-primary" data-watch-together>Watch together</button>
            </div>` : '';

        section.innerHTML = `<div class="friends-status" style="margin-bottom:var(--space-xl)">
            <h3 class="section-title" style="margin-bottom:var(--space-md)">Friends</h3>
            ${together}
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
        section.querySelector('[data-watch-together]')?.addEventListener('click', () => root.querySelector('#start-watchparty')?.click());
    } catch (e) {
        console.error('Friends status load failed:', e);
    }
}

// yours: your own score (0-100), marked on its bar with where it stands among everyone's
function renderDistribution(stats, type, yours = 0) {
    const scoreDist = stats.scoreDistribution || [];
    const statusDist = stats.statusDistribution || [];
    if (!scoreDist.length && !statusDist.length) return '';

    const maxScore = Math.max(...scoreDist.map(s => s.amount), 1);
    const maxStatus = Math.max(...statusDist.map(s => s.amount), 1);
    // AniList buckets scores by ten: 85 sits in the 80 bar
    const bucket = yours ? Math.max(10, Math.min(100, Math.floor(yours / 10) * 10)) : 0;
    const raters = scoreDist.reduce((sum, s) => sum + s.amount, 0);
    const above = scoreDist.filter(s => s.score > bucket).reduce((sum, s) => sum + s.amount, 0);
    const below = scoreDist.filter(s => s.score < bucket).reduce((sum, s) => sum + s.amount, 0);
    const standing = yours && raters
        ? (above >= below
            ? `Your ${Math.round(yours)} is harsher than ${Math.round(above / raters * 100)}% of raters`
            : `Your ${Math.round(yours)} is kinder than ${Math.round(below / raters * 100)}% of raters`)
        : '';

    return `<div class="stats-grid detail-dist" style="margin-bottom:var(--space-xl)">
        <div class="box stat-chart" style="background:var(--bg-secondary)">
            <div class="stat-chart-title">Score Distribution</div>
            ${standing ? `<div class="stat-chart-note">${standing}</div>` : ''}
            <div class="stat-bar-chart">
                ${scoreDist.map(s => `<div class="stat-bar-row${s.score === bucket ? ' is-yours' : ''}"${s.score === bucket ? ' title="Your score is in this bar"' : ''}>
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
                    <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.amount / maxStatus * 100)}%;background:${STATUS_COLORS[s.status] || 'var(--user-accent)'}"></div></div>
                    <span class="stat-bar-value">${s.amount}</span>
                </div>`).join('')}
            </div>
        </div>
    </div>`;
}
