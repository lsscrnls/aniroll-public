// @ts-check
import { openDialog } from './a11y.js';

// Text you typed and haven't sent yet: leaving the page or closing its box asks first, like AniList does.
// A field counts when it carries data-draft and its text differs from what it started with; the @name
// a reply's Reply button puts in alone is nothing to lose
const DRAFT = 'textarea[data-draft], input[data-draft]';

export function hasDraft(root = document) {
    return [...root.querySelectorAll(DRAFT)].some((/** @type {HTMLInputElement | HTMLTextAreaElement} */ el) =>
        !el.disabled && !/^(@\S+\s*)*$/.test(el.value.trim()) && el.value !== el.defaultValue);
}

// Resolves true when there is nothing to lose or you chose to discard it. Like showConfirm (js/a11y.js),
// but in its own layer: the box with the text may itself be in #modal-container
export function mayDiscard(root = document) {
    if (!hasDraft(root)) return Promise.resolve(true);
    return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop draft-confirm';
        backdrop.innerHTML = `<div class="modal-content" style="max-width:400px">
                <h3 class="modal-title">Discard what you wrote?</h3>
                <p style="font-size:0.9rem;color:var(--text-secondary);line-height:1.6;margin-bottom:var(--space-lg)">It hasn't been sent and will be lost.</p>
                <div style="display:flex;gap:var(--space-sm);justify-content:flex-end">
                    <button class="glass-btn glass-btn-secondary" data-keep>Keep writing</button>
                    <button class="glass-btn glass-btn-secondary" data-discard style="color:var(--danger);border-color:var(--danger)">Discard</button>
                </div>
            </div>`;
        document.body.appendChild(backdrop);
        const box = /** @type {HTMLElement} */ (backdrop.querySelector('.modal-content'));
        const release = openDialog(box, { label: 'Discard what you wrote?', onClose: () => done(false), focus: '[data-keep]' });
        const done = (/** @type {boolean} */ discard) => {
            release();
            backdrop.remove();
            // Discarded is discarded: the fields don't ask again, however fast the next move comes
            if (discard) root.querySelectorAll(DRAFT).forEach(el => el.removeAttribute('data-draft'));
            resolve(discard);
        };
        backdrop.querySelector('[data-keep]')?.addEventListener('click', () => done(false));
        backdrop.querySelector('[data-discard]')?.addEventListener('click', () => done(true));
        backdrop.addEventListener('click', e => { if (e.target === backdrop) done(false); });
    });
}

// Closing or reloading the tab: the browser's own question (it allows no other)
window.addEventListener('beforeunload', e => {
    if (hasDraft()) e.preventDefault();
});
