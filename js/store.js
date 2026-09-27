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

const listeners = new Map();

export function getState() { return state; }

export function setState(partial) {
    const prev = { ...state };
    state = { ...state, ...partial };
    listeners.forEach((fn, key) => {
        if (key === '*' || (key in partial)) fn(state, prev);
    });
}

export function subscribe(key, fn) {
    listeners.set(key, fn);
    return () => listeners.delete(key);
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

export function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        el.style.transition = '0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

export function showLoader(container) {
    container.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';
}

// `rec` ({ match, because }) turns the card into a recommendation card
export function renderMediaCard(media, showStatus = false, rec = null) {
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
        <div class="media-card" data-id="${media.id}" data-type="${media.type || 'ANIME'}" data-open="${media.id}" role="button" tabindex="0">
            <img class="media-card-img" src="${media.coverImage?.large || media.coverImage?.extraLarge || ''}" alt="${esc(titlePref(media.title))}" loading="lazy">
            ${score}${status}${match}
            <div class="media-card-overlay">
                <div class="media-card-title">${esc(titlePref(media.title))}</div>
                ${because || airing || sub}
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
function untilAiring(next) {
    if (!next) return null;
    if (next.airingAt) return Math.max(0, next.airingAt - Math.floor(Date.now() / 1000));
    return next.timeUntilAiring ?? null;
}

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

// ===== Scores in the user's own AniList format (Settings → Lists on AniList) =====
// Scores are always fetched and saved as 0–100 (`score(format: POINT_100)` / `scoreRaw`), so taste,
// sorting and compare keep one scale. Only what is shown and typed follows the user's format.
export function scoreFormat() {
    return getState().user?.mediaListOptions?.scoreFormat || 'POINT_100';
}

// 0–100 → the number in that format (AniList's own rounding; smileys: 1 = :(, 2 = :|, 3 = :))
export function scoreValue(raw, format = scoreFormat()) {
    if (!raw) return 0;
    switch (format) {
        case 'POINT_10_DECIMAL': return Math.round(raw) / 10;
        case 'POINT_10': return Math.max(1, Math.round(raw / 10));
        case 'POINT_5': return Math.max(1, Math.round(raw / 20));
        case 'POINT_3': return raw >= 61 ? 3 : raw >= 36 ? 2 : 1;
        default: return Math.round(raw);
    }
}

// The number in that format → 0–100
export function scoreToRaw(value, format = scoreFormat()) {
    const v = Number(value) || 0;
    if (v <= 0) return 0;
    switch (format) {
        case 'POINT_10_DECIMAL': return Math.min(100, Math.round(v * 10));
        case 'POINT_10': return Math.min(100, Math.round(v) * 10);
        case 'POINT_5': return Math.min(100, Math.round(v) * 20);
        case 'POINT_3': return [0, 35, 60, 85][Math.min(3, Math.round(v))];
        default: return Math.min(100, Math.round(v));
    }
}

const SMILEYS = ['', ':(', ':|', ':)'];

// Display text: "85", "8.5", "9", "4★", ":)"; '' when unscored
export function fmtScore(raw, format = scoreFormat()) {
    if (!raw) return '';
    const v = scoreValue(raw, format);
    if (format === 'POINT_10_DECIMAL') return v.toFixed(1);
    if (format === 'POINT_5') return `${v}★`;
    if (format === 'POINT_3') return SMILEYS[v];
    return String(v);
}

// A difference between two 0–100 scores, in the user's format ("+1.5", "-2", "+1★")
export function fmtScoreDiff(a, b, format = scoreFormat()) {
    const d = scoreValue(a, format) - scoreValue(b, format);
    const n = format === 'POINT_10_DECIMAL' ? Number(d.toFixed(1)) : d;
    const text = format === 'POINT_10_DECIMAL' ? Math.abs(n).toFixed(1) : String(Math.abs(n));
    return { value: n, text: `${n > 0 ? '+' : n < 0 ? '-' : ''}${text}${format === 'POINT_5' && n ? '★' : ''}` };
}

// The score control for an entry: a number field for point scales, stars or smileys to tap otherwise.
// Stars/smileys carry data-score-raw; tapping the chosen one again clears the score.
export function scoreInputHtml(raw, format = scoreFormat()) {
    const v = scoreValue(raw, format);
    if (format === 'POINT_5' || format === 'POINT_3') {
        const n = format === 'POINT_5' ? 5 : 3;
        const label = (i) => format === 'POINT_5' ? `${i} of 5 stars` : ['', 'Disliked', 'Average', 'Liked'][i];
        return `<div class="score-pick score-pick-${n}" role="radiogroup" aria-label="Score">${Array.from({ length: n }, (_, k) => k + 1).map(i => {
            const on = format === 'POINT_5' ? i <= v : i === v;
            return `<button type="button" class="score-pick-btn${on ? ' on' : ''}" role="radio" aria-checked="${i === v}" data-score-raw="${scoreToRaw(i, format)}" title="${label(i)}" aria-label="${label(i)}">${format === 'POINT_5' ? '★' : SMILEYS[i]}</button>`;
        }).join('')}</div>`;
    }
    const [max, step] = format === 'POINT_10_DECIMAL' ? [10, 0.1] : format === 'POINT_10' ? [10, 1] : [100, 1];
    const shown = !v ? '' : format === 'POINT_10_DECIMAL' ? v.toFixed(1) : v;
    return `<input type="number" class="glass-input" id="score-input" min="0" max="${max}" step="${step}" value="${shown}" placeholder="—" style="width:70px;text-align:center" aria-label="Score out of ${max}">`;
}
