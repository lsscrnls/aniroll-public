// The two status lines in the profile menu: saves waiting to be sent, and the Jellyfin connection.
// Shared by the app shell and the settings page.
import * as api from './api.js?v=134';

export function refreshPendingStatus() {
    const item = document.getElementById('pending-status-item');
    if (!item) return;
    const n = api.pendingSaveCount();
    item.hidden = n === 0;
    if (!n) return;
    const text = document.getElementById('pending-status-text');
    const dot = document.getElementById('pending-status-dot');
    if (dot) dot.className = `jf-dot ${api.isRateLimited() ? 'jf-dot-checking' : 'jf-dot-off'}`;
    if (text) {
        text.textContent = navigator.onLine === false
            ? `${n} change${n > 1 ? 's' : ''} waiting · offline`
            : api.isRateLimited()
            ? `${n} change${n > 1 ? 's' : ''} waiting · AniList paused`
            : `${n} change${n > 1 ? 's' : ''} waiting · retrying a few at a time`;
    }
}

export async function refreshJellyfinStatus(force = false) {
    refreshPendingStatus();
    const item = document.getElementById('jf-status-item');
    if (!item) return;
    const { getConfig, getStatus } = await import('./jellyfin.js?v=134');
    if (!getConfig()) {
        item.hidden = true;
        return;
    }
    item.hidden = false;
    const dot = document.getElementById('jf-status-dot');
    const text = document.getElementById('jf-status-text');
    dot.className = 'jf-dot jf-dot-checking';
    text.textContent = 'Jellyfin · checking...';
    const status = await getStatus(force);
    dot.className = `jf-dot jf-dot-${status.state === 'connected' ? 'on' : 'off'}`;
    text.textContent = status.state === 'connected'
        ? `Jellyfin · ${status.serverName}`
        : `Jellyfin · ${status.error || 'not connected'}`;
}

