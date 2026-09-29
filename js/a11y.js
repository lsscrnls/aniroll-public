// Keyboard and screen reader support that every page shares.
import { esc } from './store.js?v=117';

// ===== Dialogs =====
// An open overlay behaves as a dialog: announced as one, focus moves in and stays inside
// (Tab wraps), Escape closes the topmost one, and focus goes back to what opened it.
// Overlays stack: a confirm opened from the detail panel closes first.
const stack = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
    + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root) {
    // offsetParent is null for hidden elements (e.g. the native <select> behind enhanceSelect)
    return [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el.getClientRects().length);
}

// root: the element holding the dialog's content. onClose: what Escape does — it must end
// up calling the returned release(). focus: selector of the element to focus first.
export function openDialog(root, { label, onClose, focus } = {}) {
    const open = stack.find(d => d.root === root);
    if (open) return open.release;

    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    if (label) root.setAttribute('aria-label', label);

    const entry = { root, onClose, returnTo: document.activeElement };
    entry.release = () => {
        const i = stack.indexOf(entry);
        if (i < 0) return;
        stack.splice(i, 1);
        root.removeAttribute('aria-modal');
        // Only take focus back if it is still in the dialog (or lost), not if the user moved on
        const active = document.activeElement;
        if ((!active || active === document.body || root.contains(active)) && entry.returnTo?.isConnected) {
            entry.returnTo.focus({ preventScroll: true });
        }
    };
    stack.push(entry);

    requestAnimationFrame(() => {
        if (!stack.includes(entry)) return;
        let target = (focus && root.querySelector(focus)) || focusables(root)[0];
        if (!target) {
            root.tabIndex = -1;
            target = root;
        }
        target.focus({ preventScroll: true });
    });
    return entry.release;
}

document.addEventListener('keydown', (e) => {
    const top = stack.at(-1);
    // Dropdowns (select.js) handle their own Escape first and mark it as handled
    if (!top || e.defaultPrevented) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        top.onClose?.();
        return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(top.root);
    if (!items.length) {
        e.preventDefault();
        return;
    }
    const first = items[0];
    const last = items.at(-1);
    const active = document.activeElement;
    if (!top.root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
    }
});

// ===== Clickable cards and rows =====
// Markup declares what an element does instead of inline onclick handlers:
//   data-open="<mediaId>"   opens the detail panel   (render with role="button" tabindex="0")
//   data-go="/user/<name>"  goes to that route       (render with role="link" tabindex="0")
//   data-login              starts the AniList login
// One listener for the whole document, so it also covers markup rendered later. Controls
// inside a card (the −/+ buttons, links in a post) keep their own behaviour.
const ACTIVATE = '[data-open], [data-go], [data-login]';
const INNER_CONTROL = 'a, button, input, select, textarea, label, [role="button"], [role="link"]';

function activate(el) {
    if (el.hasAttribute('data-login')) {
        document.getElementById('login-btn')?.click();
    } else if (el.hasAttribute('data-go')) {
        window.location.hash = el.dataset.go;
    } else {
        const id = Number(el.dataset.open);
        if (id) window.__openDetailPanel?.(id);
    }
}

export function initActivation() {
    document.addEventListener('click', (e) => {
        const el = e.target.closest(ACTIVATE);
        if (!el) return;
        const inner = e.target.closest(INNER_CONTROL);
        if (inner && inner !== el && el.contains(inner)) return;
        activate(el);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target;
        if (!el.matches?.(ACTIVATE) || el.matches('button, a[href]')) return; // native ones click themselves
        e.preventDefault(); // Space would scroll the page
        activate(el);
    });
}

// Yes/no question as a dialog; resolves true on confirm
export function showConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
    return new Promise(resolve => {
        const container = document.getElementById('modal-container');
        if (!container) return resolve(false);
        container.hidden = false;
        container.innerHTML = `<div class="modal-backdrop">
            <div class="modal-content" style="max-width:400px">
                <h3 class="modal-title">${esc(title)}</h3>
                ${message ? `<p style="font-size:0.9rem;color:var(--text-secondary);line-height:1.6;margin-bottom:var(--space-lg)">${esc(message)}</p>` : ''}
                <div style="display:flex;gap:var(--space-sm);justify-content:flex-end">
                    <button class="glass-btn glass-btn-secondary" id="modal-cancel">${esc(cancelText)}</button>
                    <button class="glass-btn ${danger ? 'glass-btn-secondary' : 'glass-btn-primary'}" id="modal-confirm" style="${danger ? 'color:var(--danger);border-color:var(--danger)' : ''}">${esc(confirmText)}</button>
                </div>
            </div>
        </div>`;
        // Focus starts on Cancel, so a stray Enter never confirms something destructive
        const release = openDialog(container.querySelector('.modal-content'), { label: title, onClose: () => close(false), focus: '#modal-cancel' });
        const close = (result) => {
            release();
            container.hidden = true;
            container.innerHTML = '';
            resolve(result);
        };
        container.querySelector('#modal-confirm').addEventListener('click', () => close(true));
        container.querySelector('#modal-cancel').addEventListener('click', () => close(false));
        container.querySelector('.modal-backdrop').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) close(false);
        });
    });
}
