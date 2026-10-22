// @ts-check
import { openDialog } from './a11y.js';
import { esc } from './store.js';

// "?" shows the keys: the player's while it is open, then the ones that work everywhere. Not while typing.
const EVERYWHERE = [
    [['Ctrl', 'K'], 'Search (⌘ K on a Mac)'],
    [['Esc'], 'Close a panel, menu or dialog'],
    [['Tab'], 'Move between buttons and links; Enter opens'],
    [['?'], 'These keys'],
];
const PLAYER = [
    [['Space'], 'Play / pause (also K)'],
    [['←', '→'], 'Back / forward 10 s (also J, L)'],
    [['↑', '↓'], 'Volume'],
    [['0', '…', '9'], 'Jump to 0 % … 90 % of the episode'],
    [['M'], 'Mute'],
    [['F'], 'Fullscreen'],
    [['C'], 'Subtitles on / off'],
    [['Z', 'X'], 'Subtitles 0.1 s earlier / later'],
    [['[', ']'], 'Slower / faster'],
    [['S'], 'Skip intro, recap or credits'],
    [['N'], 'Next episode (Shift N: the one before)'],
    [['E'], 'Episodes'],
    [['A'], 'Ambient light'],
    [['I'], 'Stats for nerds'],
];

const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const rows = (list) => list.map(([keys, what]) =>
    `<div class="keyhelp-row"><span class="keyhelp-keys">${keys.map(k => k === '…' ? '…' : `<kbd>${esc(k)}</kbd>`).join(' ')}</span><span>${esc(what)}</span></div>`).join('');

let open = null;

export function showKeyHelp() {
    const container = document.getElementById('modal-container');
    if (!container || open) return;
    const inPlayer = !!document.getElementById('player-video')?.isConnected;
    container.hidden = false;
    container.innerHTML = `<div class="modal-backdrop">
        <div class="modal-content keyhelp" style="max-width:460px">
            <h3 class="modal-title">Keyboard shortcuts</h3>
            ${inPlayer ? `<h4 class="keyhelp-head">Player</h4>${rows(PLAYER)}` : ''}
            <h4 class="keyhelp-head">Everywhere</h4>${rows(EVERYWHERE)}
            <div style="display:flex;justify-content:flex-end;margin-top:var(--space-md)">
                <button class="glass-btn glass-btn-secondary" id="modal-cancel">Close</button>
            </div>
        </div>
    </div>`;
    const close = () => {
        release();
        container.hidden = true;
        container.innerHTML = '';
        open = null;
    };
    const release = openDialog(container.querySelector('.modal-content'), { label: 'Keyboard shortcuts', onClose: close, focus: '#modal-cancel' });
    open = close;
    container.querySelector('#modal-cancel')?.addEventListener('click', close);
    container.querySelector('.modal-backdrop')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
}

export function initKeyHelp() {
    document.addEventListener('keydown', (e) => {
        if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
        e.preventDefault();
        if (open) open(); else showKeyHelp();
    });
}
