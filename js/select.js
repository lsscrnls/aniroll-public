import { esc } from './store.js?v=135';

// Styled replacement for <select class="glass-select">. The native select stays in the DOM,
// hidden, as the source of truth — value, `selected` and existing `change` listeners keep
// working unchanged. The list is ordinary DOM instead of the OS popup, so it follows the
// site's theme and the custom cursor stays visible over it.
// It lives in <body> with position: fixed, so scrolling panels (detail view) never clip it.

const CHEVRON = '<svg data-icon="keyboard_arrow_down" class="glass-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const CHECK = '<svg data-icon="check" class="glass-menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

let openMenu = null; // only one list open at a time
let uid = 0;

// colors: optional { optionValue: cssColor } — draws a status dot in front of the label
export function enhanceSelect(select, { colors = null } = {}) {
    if (!select || select.dataset.enhanced) return;
    select.dataset.enhanced = '1';
    const id = `glass-menu-${++uid}`;

    const wrap = document.createElement('div');
    wrap.className = 'glass-menu';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'glass-menu-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id);
    if (select.style.minWidth) trigger.style.minWidth = select.style.minWidth;
    // The name the select had (aria-label or its <label>), so a screen reader says "Sort, Last updated"
    const name = select.getAttribute('aria-label') || (select.id && document.querySelector(`label[for="${select.id}"]`)?.textContent.trim()) || '';
    trigger.id = `${id}-trigger`;
    select.parentNode.insertBefore(wrap, select);
    wrap.append(trigger, select);
    select.hidden = true;
    select.tabIndex = -1;

    const dot = (value) => colors?.[value]
        ? `<span class="glass-menu-dot" style="background:${colors[value]}"></span>` : '';

    function syncLabel() {
        const opt = select.options[select.selectedIndex];
        trigger.innerHTML = `${dot(opt?.value)}<span class="glass-menu-label">${esc(opt?.textContent || '')}</span>${CHEVRON}`;
        if (name) trigger.setAttribute('aria-label', `${name}: ${opt?.textContent || ''}`);
        // A disabled select is a disabled button
        trigger.disabled = select.disabled;
    }
    syncLabel();
    // Options can be filled in later (e.g. genres) — keep the label in step
    new MutationObserver(syncLabel).observe(select, { childList: true, subtree: true, attributes: true });

    let list = null;
    let active = -1;
    let typed = '';
    let typedAt = 0;

    function highlight() {
        if (!list) return;
        list.querySelectorAll('.glass-menu-option').forEach((el, i) => el.classList.toggle('active', i === active));
        const el = list.querySelector(`[data-index="${active}"]`);
        if (el) {
            trigger.setAttribute('aria-activedescendant', el.id);
            // Scroll only the list — scrollIntoView could move the page and trip onScroll
            if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
            else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
                list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
            }
        }
    }

    function place() {
        const r = trigger.getBoundingClientRect();
        list.style.minWidth = `${Math.round(r.width)}px`;
        const h = list.offsetHeight;
        const below = window.innerHeight - r.bottom;
        const up = below < h + 12 && r.top > below;
        list.classList.toggle('up', up);
        list.style.top = `${Math.round(up ? r.top - h - 6 : r.bottom + 6)}px`;
        list.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8)))}px`;
    }

    function choose(index) {
        if (select.options[index]?.disabled) return;
        if (index >= 0 && index !== select.selectedIndex) {
            select.selectedIndex = index;
            syncLabel();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        close(true);
    }

    function onOutside(e) {
        if (!list?.contains(e.target) && !trigger.contains(e.target)) close(false);
    }
    function onScroll(e) {
        if (list && !list.contains(e.target)) close(false);
    }
    function onResize() { close(false); }

    function open() {
        if (list) return;
        openMenu?.close(false);
        list = document.createElement('div');
        list.id = id;
        list.className = 'glass-menu-list';
        list.setAttribute('role', 'listbox');
        if (name) list.setAttribute('aria-label', name);
        else list.setAttribute('aria-labelledby', trigger.id);
        list.setAttribute('data-lenis-prevent', '');
        list.innerHTML = [...select.options].map((o, i) =>
            `<div class="glass-menu-option${o.selected ? ' selected' : ''}${o.disabled ? ' disabled' : ''}" id="${id}-${i}" role="option" aria-selected="${o.selected}"${o.disabled ? ' aria-disabled="true"' : ''} data-index="${i}">
                ${dot(o.value)}<span class="glass-menu-option-label">${esc(o.textContent)}</span>${CHECK}
            </div>`).join('');
        document.body.appendChild(list);
        place();
        active = select.selectedIndex;
        highlight();
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => list?.classList.add('show'));

        list.addEventListener('mousemove', (e) => {
            const opt = e.target.closest('.glass-menu-option');
            if (opt && Number(opt.dataset.index) !== active) {
                active = Number(opt.dataset.index);
                list.querySelectorAll('.glass-menu-option').forEach((el, i) => el.classList.toggle('active', i === active));
            }
        });
        list.addEventListener('click', (e) => {
            const opt = e.target.closest('.glass-menu-option');
            if (opt) choose(Number(opt.dataset.index));
        });
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        openMenu = { close };
    }

    function close(focusTrigger) {
        if (!list) return;
        const old = list;
        list = null;
        openMenu = null;
        old.classList.remove('show');
        setTimeout(() => old.remove(), 180);
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
        if (focusTrigger) trigger.focus({ preventScroll: true });
    }

    trigger.addEventListener('click', () => (list ? close(false) : open()));
    trigger.addEventListener('keydown', (e) => {
        const count = select.options.length;
        if (!list) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
                e.preventDefault();
                open();
            }
            return;
        }
        // Type-ahead: letters jump to the next option starting with what was typed (long genre and year lists)
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            typed = Date.now() - typedAt < 700 ? typed + e.key.toLowerCase() : e.key.toLowerCase();
            typedAt = Date.now();
            const labels = [...select.options].map(o => o.textContent.trim().toLowerCase());
            const start = typed.length > 1 ? active : active + 1;
            const hit = [...labels.keys()].map(k => (start + k) % count).find(k => labels[k].startsWith(typed) && !select.options[k].disabled);
            if (hit !== undefined) { active = hit; highlight(); }
            e.preventDefault();
            return;
        }
        if (e.key === 'ArrowDown') active = Math.min(count - 1, active + 1);
        else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
        else if (e.key === 'Home') active = 0;
        else if (e.key === 'End') active = count - 1;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return choose(active); }
        else if (e.key === 'Escape') { e.preventDefault(); return close(true); }
        else if (e.key === 'Tab') return close(false);
        else return;
        e.preventDefault();
        highlight();
    });

    // Same cursor feedback as the site's other buttons
    const cursor = document.getElementById('cursor');
    trigger.addEventListener('mouseenter', () => cursor?.classList.add('grow'));
    trigger.addEventListener('mouseleave', () => cursor?.classList.remove('grow'));
}
