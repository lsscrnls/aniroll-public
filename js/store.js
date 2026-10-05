import { untilAiring } from './api.js?v=142';
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(str) { return str ? String(str).replace(/[&<>"']/g, c => ESC_MAP[c]) : ''; }

// Line icons for empty states (the UI uses no emojis)
const EMPTY_ICONS = {
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    search: '<circle cx="10.5" cy="10.5" r="7"/><path d="M21 21l-5.2-5.2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M17 2l-5 5-5-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
};
// Material Symbols names for the M3 design (css/m3-icons.css swaps the drawing)
const EMPTY_M3 = { lock: 'lock', alert: 'warning', bell: 'notifications', search: 'search', list: 'list', tv: 'live_tv', user: 'person' };
export function emptyIcon(name) {
    return `<svg data-icon="${EMPTY_M3[name] || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${EMPTY_ICONS[name] || ''}</svg>`;
}

// Browse, Season and Calendar are one tab (Discover); this switch sits on top of all three
export function renderPageSwitch(active) {
    const link = (page, label) =>
        `<a href="#/${page}" class="list-tab${active === page ? ' active' : ''}"${active === page ? ' aria-current="page"' : ''}>${label}</a>`;
    return `<nav class="page-switch" aria-label="Discover">${link('search', 'Browse')}${link('season', 'Season')}${link('calendar', 'Calendar')}</nav>`;
}

export function titlePref(title) {
    if (!title) return '';
    const lang = localStorage.getItem('aniroll_title_lang') || 'romaji';
    if (lang === 'english') return title.english || title.romaji || title.userPreferred || '';
    if (lang === 'native') return title.native || title.userPreferred || title.romaji || '';
    return title.userPreferred || title.romaji || '';
}

// App-wide signal that a list entry changed, so other views (e.g. Continue Watching) can follow.
// detail: { mediaId, status?, progress?, removed? }
export const LIST_EVENT = 'aniroll:list-changed';
export function emitListChange(detail) {
    window.dispatchEvent(new CustomEvent(LIST_EVENT, { detail }));
}
// "You just watched this": the M3 design takes its colours from the show you watched last (js/m3.js)
export const WATCHED_EVENT = 'aniroll:watched';
export function emitWatched(media) {
    if (media) document.dispatchEvent(new CustomEvent(WATCHED_EVENT, { detail: { media } }));
}

let state = {
    user: null,
    token: null,
    theme: null,
    mediaLists: {},
    genreCache: null,
};

export function getState() { return state; }

export function setState(partial) {
    state = { ...state, ...partial };
}

export function getTheme() {
    return state.theme || localStorage.getItem('aniroll_theme') || 'system';
}

export function setTheme(theme) {
    localStorage.setItem('aniroll_theme', theme);
    setState({ theme });
    applyTheme(theme);
}

export function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        root.setAttribute('data-theme', 'light');
    } else {
        root.removeAttribute('data-theme');
    }
}

export function cycleTheme() {
    const current = getTheme();
    const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
    setTheme(next);
    return next;
}

const ACCENT_COLORS = [
    { name: 'Red', hex: '#d13438' },
    { name: 'Orange', hex: '#e8740c' },
    { name: 'Gold', hex: '#c19c00' },
    { name: 'Green', hex: '#0e9e6e' },
    { name: 'Teal', hex: '#0099bc' },
    { name: 'Blue', hex: '#3b82f6' },
    { name: 'Indigo', hex: '#6366f1' },
    { name: 'Purple', hex: '#9333ea' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'Mono', hex: '#737373' },
];

export function getAccentColors() { return ACCENT_COLORS; }

export function getAccentColor() {
    return localStorage.getItem('aniroll_accent') || '#d13438';
}

export function setAccentColor(hex) {
    localStorage.setItem('aniroll_accent', hex);
    applyAccentColor(hex);
}

export function applyAccentColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty('--user-accent', hex);
    document.documentElement.style.setProperty('--user-accent-dim', `rgba(${r},${g},${b},0.12)`);
}

// action: { label, run } — a button in the toast (Undo); the toast then stays a little longer.
// Screen readers hear every toast: errors at once (role="alert"), the rest when they are free.
export function toast(message, type = 'info', { action = null } = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.textContent = message;
    el.append(text);
    const leave = () => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        el.style.transition = '0.3s ease';
        setTimeout(() => el.remove(), 300);
    };
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => { action.run(); clearTimeout(timer); leave(); });
        el.append(btn);
    }
    container.appendChild(el);
    const timer = setTimeout(leave, action ? 6000 : 3000);
}

// `rec` ({ match, because }) turns the card into a recommendation card
// `note` replaces the line under the title (a voice actor's page puts the character there)
export function renderMediaCard(media, showStatus = false, rec = null, note = null) {
    // Recommendation cards show only the taste match — the AniList score next to it was too much
    const score = media.meanScore && !rec ? `<div class="media-card-score" title="AniList average score">${media.meanScore}%</div>` : '';
    const match = rec ? `<div class="media-card-match" data-match="${rec.match}" title="How well this fits your taste (not the AniList score)">${rec.match}% Match</div>` : '';
    const because = rec?.because ? `<div class="media-card-sub media-card-because">Because you watched ${esc(titlePref(rec.because))}</div>` : '';
    const status = showStatus && media.mediaListEntry?.status
        ? `<div class="media-card-status status-${media.mediaListEntry.status.toLowerCase()}">${statusShort(media.mediaListEntry.status)}</div>`
        : '';
    const airing = media.nextAiringEpisode
        ? `<div class="media-card-sub">Ep ${media.nextAiringEpisode.episode} in ${timeUntilShort(untilAiring(media.nextAiringEpisode))}</div>`
        : '';
    const sub = media.format ? `<div class="media-card-sub">${formatShort(media.format)}${media.episodes ? ` · ${media.episodes} Ep` : ''}${media.chapters ? ` · ${media.chapters} Ch` : ''}</div>` : '';

    return `
        <div class="media-card" data-id="${media.id}" data-type="${media.type || 'ANIME'}" data-open="${media.id}"${rec?.dismissable ? '' : ' role="button" tabindex="0"'}>
            <img class="media-card-img" src="${media.coverImage?.large || media.coverImage?.extraLarge || ''}" alt="" loading="lazy">
            ${score}${status}${match}
            ${rec?.dismissable ? `<button type="button" class="media-card-dismiss" data-dismiss="${media.id}" title="Not interested" aria-label="Not interested in ${esc(titlePref(media.title))}"><svg data-icon="close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>` : ''}
            <div class="media-card-overlay">
                <div class="media-card-title"${rec?.dismissable ? ` data-open="${media.id}" role="button" tabindex="0"` : ''}>${esc(titlePref(media.title))}</div>
                ${note ? `<div class="media-card-sub">${esc(note)}</div>` : because || airing || sub}
            </div>
        </div>
    `;
}

export function renderSkeletonCards(count = 6) {
    return Array(count).fill('<div class="skeleton skeleton-card"></div>').join('');
}

const STATUS_ICONS = {
    CURRENT: ['Watching', '<path d="M7 4.5v15l12-7.5z"/>'],
    COMPLETED: ['Completed', '<path d="M4.5 12.5l5 5L20 7"/>'],
    PLANNING: ['Planning', '<path d="M6 3h12v18l-6-4-6 4z"/>'],
    DROPPED: ['Dropped', '<path d="M6 6l12 12M18 6L6 18"/>'],
    PAUSED: ['Paused', '<path d="M8 5v14M16 5v14"/>'],
    REPEATING: ['Rewatching', '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'],
};

const STATUS_M3 = { CURRENT: 'play_arrow', COMPLETED: 'check', PLANNING: 'bookmark', DROPPED: 'close', PAUSED: 'pause', REPEATING: 'repeat' };

function statusShort(s) {
    const icon = STATUS_ICONS[s];
    if (!icon) return esc(s);
    return `<svg data-icon="${STATUS_M3[s]}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${icon[0]}"><title>${icon[0]}</title>${icon[1]}</svg>`;
}

function formatShort(f) {
    const m = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga', NOVEL: 'Novel', ONE_SHOT: 'One Shot' };
    return m[f] || f;
}

// Absolute airing time beats the cached snapshot

function timeUntilShort(sec) {
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
}

// List status in words — anime is watched, manga is read
export function statusLabel(status, type = 'ANIME') {
    const manga = type === 'MANGA';
    const labels = {
        CURRENT: manga ? 'Reading' : 'Watching',
        PLANNING: 'Planning',
        COMPLETED: 'Completed',
        DROPPED: 'Dropped',
        PAUSED: 'Paused',
        REPEATING: manga ? 'Rereading' : 'Rewatching',
    };
    return labels[status] || status;
}

// ===== Scores: always out of 100 =====
// AniRoll shows and takes every score out of 100, whatever format someone picked on AniList. List
// scores are fetched as `score(format: POINT_100)` and saved as `scoreRaw`; the few statistics that
// come in the owner's own format are converted in js/api.js (scoresTo100).

// "You've seen 6 · your average 82 · 4 not on your list" for a studio's or a voice actor's shows,
// from the list entries that came with them (pages loaded so far). '' when there is nothing to say
export function historyLine(medias) {
    const seen = medias.filter(m => ['COMPLETED', 'CURRENT', 'REPEATING', 'PAUSED'].includes(m.mediaListEntry?.status));
    const scores = seen.map(m => m.mediaListEntry.score).filter(Boolean);
    const unlisted = medias.filter(m => !m.mediaListEntry).length;
    if (!seen.length && !unlisted) return '';
    return [
        seen.length ? `You've seen ${seen.length}` : 'You have not seen any yet',
        scores.length ? `your average ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}` : '',
        unlisted ? `${unlisted} not on your list` : '',
    ].filter(Boolean).join(' · ');
}

// A page that needs an account, seen logged out: what it does, and the way in right there
export function loginState(iconHtml, text, sub) {
    return `<div class="empty-state"><div class="empty-state-icon">${iconHtml}</div><div class="empty-state-text">${esc(text)}</div>
        ${sub ? `<div class="empty-state-sub">${esc(sub)}</div>` : ''}
        <button class="glass-btn glass-btn-primary empty-state-action" data-login>Log in with AniList</button></div>`;
}

// Display text: "85"; '' when unscored
export function fmtScore(raw) {
    return raw ? String(Math.round(raw)) : '';
}

// A difference between two scores ("+15", "-5")
export function fmtScoreDiff(a, b) {
    const n = Math.round(a || 0) - Math.round(b || 0);
    return { value: n, text: `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n)}` };
}

// The score field for an entry: 0–100, the scale written next to it
export function scoreInputHtml(raw) {
    return `<span class="score-field"><input type="number" class="glass-input" id="score-input" min="0" max="100" step="1" value="${raw ? Math.round(raw) : ''}" placeholder="—" style="width:70px;text-align:center" aria-label="Score out of 100"><span class="score-scale">/ 100</span></span>`;
}

// AniRoll's source on GitHub (the public snapshot): avatar menu, landing page, Material 3's rail.
// The mark has no data-icon: Material 3 would swap it for a Material Symbol, and a logo stays as it is
export const GITHUB_URL = 'https://github.com/lsscrnls/aniroll-public';
export const GITHUB_ICON = '<svg class="github-mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
