// AniList search overlay (Ctrl/Cmd+K) — the UI part. Extracted from AniRoll.
// Needs search-overlay.css. No framework, no dependencies besides anilist-search.js.
//
//   import { mountSearchOverlay } from './search-overlay.js';
//   const search = mountSearchOverlay({
//       onSelect: (media) => openMyDetailPage(media.id),
//   });
//   myButton.addEventListener('click', search.open);

import { createSearchController, displayTitle, describeMedia } from './anilist-search.js';

const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="M21 21l-5.2-5.2"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let instances = 0;

/**
 * @param {object}   options
 * @param {Function} options.onSelect          (media) => void — called with the chosen AniList media
 * @param {'ANIME'|'MANGA'|null} [options.type] null = anime and manga
 * @param {number}   [options.minLength=3]
 * @param {number}   [options.debounceMs=300]
 * @param {number}   [options.limit=8]
 * @param {boolean}  [options.shortcut=true]   Ctrl/Cmd+K toggles the overlay
 * @param {string}   [options.placeholder]
 * @param {string}   [options.titleLanguage='userPreferred']  userPreferred | english | romaji | native
 * @param {HTMLElement} [options.container=document.body]
 * @param {string}   [options.token]           AniList OAuth token (optional)
 * @returns {{ open: Function, close: Function, destroy: Function, element: HTMLElement }}
 */
export function mountSearchOverlay({
    onSelect,
    type = null,
    minLength = 3,
    debounceMs = 300,
    limit = 8,
    shortcut = true,
    placeholder = type === 'MANGA' ? 'Search manga…' : type === 'ANIME' ? 'Search anime…' : 'Search anime or manga…',
    titleLanguage = 'userPreferred',
    container = document.body,
    token = null,
} = {}) {
    if (typeof onSelect !== 'function') throw new TypeError('mountSearchOverlay: onSelect callback is required');

    const id = `als-${++instances}`;
    const root = document.createElement('div');
    root.className = 'als-overlay';
    root.hidden = true;
    root.innerHTML = `
        <div class="als-backdrop" data-als-close></div>
        <div class="als-dialog" role="dialog" aria-modal="true" aria-label="Search">
            <div class="als-header">
                <span class="als-icon">${ICON_SEARCH}</span>
                <input class="als-input" type="text" autocomplete="off" spellcheck="false"
                    placeholder="${escapeHtml(placeholder)}" role="combobox" aria-expanded="false"
                    aria-controls="${id}-list" aria-autocomplete="list">
                <button class="als-close" type="button" aria-label="Close search" data-als-close>${ICON_CLOSE}</button>
            </div>
            <div class="als-results" id="${id}-list" role="listbox"></div>
        </div>`;
    container.appendChild(root);

    const input = root.querySelector('.als-input');
    const list = root.querySelector('.als-results');
    let items = [];
    let active = -1;
    let lastFocus = null;

    const status = (text) => `<div class="als-status">${escapeHtml(text)}</div>`;

    function render(state) {
        items = state.media || [];
        active = items.length ? 0 : -1;
        input.setAttribute('aria-expanded', String(items.length > 0));

        if (state.status === 'idle') list.innerHTML = '';
        else if (state.status === 'short') list.innerHTML = status(`Type at least ${state.minLength} characters…`);
        else if (state.status === 'loading') list.innerHTML = status('Searching…');
        else if (state.status === 'error') list.innerHTML = status(state.error?.message || 'Search failed');
        else if (!items.length) list.innerHTML = status('No results found');
        else {
            list.innerHTML = items.map((m, i) => `
                <div class="als-item${i === active ? ' is-active' : ''}" role="option" id="${id}-opt-${i}"
                    aria-selected="${i === active}" data-index="${i}">
                    <img class="als-cover" src="${escapeHtml(m.coverImage?.large || m.coverImage?.medium || '')}" alt="" loading="lazy"
                        style="background:${escapeHtml(m.coverImage?.color || 'transparent')}">
                    <div class="als-info">
                        <div class="als-title">${escapeHtml(displayTitle(m, titleLanguage))}</div>
                        <div class="als-meta">${escapeHtml(describeMedia(m))}</div>
                    </div>
                </div>`).join('');
        }
        syncActive();
    }

    function syncActive() {
        list.querySelectorAll('.als-item').forEach((el, i) => {
            el.classList.toggle('is-active', i === active);
            el.setAttribute('aria-selected', String(i === active));
        });
        const el = list.querySelector(`[data-index="${active}"]`);
        if (el) {
            input.setAttribute('aria-activedescendant', el.id);
            el.scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    const controller = createSearchController({ onState: render, minLength, debounceMs, type, perPage: limit, token });

    function choose(index) {
        const media = items[index];
        if (!media) return;
        close();
        onSelect(media);
    }

    function open() {
        if (!root.hidden) return;
        lastFocus = document.activeElement;
        root.hidden = false;
        input.value = '';
        render({ status: 'idle', media: [] });
        // Visible as soon as `hidden` is off — focus right away, not a frame later
        input.focus({ preventScroll: true });
    }

    function close() {
        if (root.hidden) return;
        controller.cancel();
        root.hidden = true;
        lastFocus?.focus?.();
    }

    input.addEventListener('input', () => controller.update(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; syncActive(); }
        else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; syncActive(); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    });
    list.addEventListener('mousemove', (e) => {
        const el = e.target.closest('.als-item');
        if (el && Number(el.dataset.index) !== active) { active = Number(el.dataset.index); syncActive(); }
    });
    list.addEventListener('click', (e) => {
        const el = e.target.closest('.als-item');
        if (el) choose(Number(el.dataset.index));
    });
    root.addEventListener('click', (e) => { if (e.target.closest('[data-als-close]')) close(); });

    function onKey(e) {
        if (shortcut && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            root.hidden ? open() : close();
        } else if (e.key === 'Escape' && !root.hidden) {
            close();
        }
    }
    document.addEventListener('keydown', onKey);

    function destroy() {
        controller.cancel();
        document.removeEventListener('keydown', onKey);
        root.remove();
    }

    return { open, close, destroy, element: root };
}
