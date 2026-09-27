import * as api from '../api.js?v=100';
import { esc, titlePref, emptyIcon } from '../store.js?v=100';
import { getToken, isLoggedIn } from '../auth.js?v=100';

export async function render({ content }) {
    const token = getToken();

    if (!isLoggedIn()) {
        content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('bell')}</div><div class="empty-state-text">Log in to see your notifications</div></div>`;
        return;
    }

    content.innerHTML = `<div class="page-enter">
        <h1 class="section-title" style="margin-bottom:var(--space-lg)">Notifications</h1>
        <div class="box" id="notif-list" style="padding:var(--space-xs)"></div>
        <div id="notif-more" style="text-align:center;margin-top:var(--space-xl)" hidden>
            <button class="glass-btn glass-btn-secondary" id="load-more-notif">Load More</button>
        </div>
    </div>`;

    let page = 1;

    async function loadNotifs(p = 1, append = false) {
        const list = document.getElementById('notif-list');
        if (!list) return;

        if (!append) list.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

        try {
            const result = await api.getNotifications(p, token);
            const html = (result.notifications || []).map(renderNotification).filter(Boolean).join('');

            if (append) list.innerHTML += html;
            else list.innerHTML = html || '<div class="empty-state" style="padding:var(--space-lg)"><div class="empty-state-sub">No notifications</div></div>';

            document.getElementById('notif-more').hidden = !result.pageInfo.hasNextPage;
            page = p;

            const badge = document.getElementById('notif-badge');
            if (badge) badge.hidden = true;
        } catch (err) {
            list.innerHTML = `<div class="empty-state"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
        }
    }

    document.getElementById('load-more-notif')?.addEventListener('click', () => loadNotifs(page + 1, true));

    loadNotifs();
}

function renderNotification(n) {
    if (!n) return '';

    if (n.type === 'AIRING') {
        return `<div class="notif-item" data-open="${n.media?.id}" role="button" tabindex="0">
            <img src="${n.media?.coverImage?.large || ''}" alt="" style="width:40px;height:56px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0">
            <div>
                <div class="notif-text"><strong>${esc(titlePref(n.media?.title))}</strong> — Episode ${n.episode} is now available</div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
            </div>
        </div>`;
    }

    if (n.type === 'FOLLOWING') {
        return `<div class="notif-item" data-go="/user/${esc(n.user?.name)}" role="link" tabindex="0">
            <div class="notif-icon">
                <img src="${n.user?.avatar?.medium || ''}" alt="" style="width:100%;height:100%;border-radius:var(--radius-full);object-fit:cover">
            </div>
            <div>
                <div class="notif-text"><strong>${esc(n.user?.name)}</strong> started following you</div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
            </div>
        </div>`;
    }

    if (n.type === 'ACTIVITY_LIKE') {
        return `<div class="notif-item">
            <div class="notif-icon">
                <img src="${n.user?.avatar?.medium || ''}" alt="" style="width:100%;height:100%;border-radius:var(--radius-full);object-fit:cover">
            </div>
            <div>
                <div class="notif-text"><strong>${esc(n.user?.name)}</strong> liked your activity</div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
            </div>
        </div>`;
    }

    if (n.type === 'ACTIVITY_REPLY') {
        return `<div class="notif-item">
            <div class="notif-icon">
                <img src="${n.user?.avatar?.medium || ''}" alt="" style="width:100%;height:100%;border-radius:var(--radius-full);object-fit:cover">
            </div>
            <div>
                <div class="notif-text"><strong>${esc(n.user?.name)}</strong> replied to your activity</div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
            </div>
        </div>`;
    }

    if (n.type === 'RELATED_MEDIA_ADDITION') {
        return `<div class="notif-item" data-open="${n.media?.id}" role="button" tabindex="0">
            <img src="${n.media?.coverImage?.large || ''}" alt="" style="width:40px;height:56px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0">
            <div>
                <div class="notif-text">New related entry: <strong>${esc(titlePref(n.media?.title))}</strong></div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
            </div>
        </div>`;
    }

    if (n.type === 'MEDIA_DATA_CHANGE') {
        return `<div class="notif-item" data-open="${n.media?.id}" role="button" tabindex="0">
            <img src="${n.media?.coverImage?.large || ''}" alt="" style="width:40px;height:56px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0">
            <div>
                <div class="notif-text"><strong>${esc(titlePref(n.media?.title))}</strong> was updated${n.reason ? `: ${esc(n.reason)}` : ''}</div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
            </div>
        </div>`;
    }

    return '';
}
