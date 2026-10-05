import * as api from '../api.js?v=142';
import { esc, titlePref, emptyIcon, loginState } from '../store.js?v=142';
import { getToken, isLoggedIn } from '../auth.js?v=142';

export async function render({ content }) {
    const token = getToken();

    if (!isLoggedIn()) {
        content.innerHTML = loginState(emptyIcon('bell'), 'Log in to see your notifications', 'New episodes of your shows, replies and likes from AniList, in one place.');
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

            if (append) list.insertAdjacentHTML('beforeend', html);
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

    // A post's thread under its notification: the replies, and the way to the whole post on AniList
    const list = document.getElementById('notif-list');
    const openThread = async (item) => {
        const box = item.querySelector('.notif-thread');
        const id = Number(item.dataset.activity);
        if (!box || !id) return;
        const open = box.hidden;
        box.hidden = !open;
        item.setAttribute('aria-expanded', String(open));
        if (!open || box.dataset.loaded) return;
        box.innerHTML = '<div class="activity-replies-status">Loading…</div>';
        try {
            const [replies, { renderReply }] = await Promise.all([api.getActivityReplies(id, token), import('./social.js?v=142')]);
            box.dataset.loaded = '1';
            box.innerHTML = (replies.length ? replies.slice(-5).map(renderReply).join('') : '<div class="activity-replies-status">No replies yet</div>')
                + `<a class="notif-thread-link" href="https://anilist.co/activity/${id}" target="_blank" rel="noopener">Open on AniList</a>`;
        } catch (err) {
            box.innerHTML = `<div class="activity-replies-status">${esc(err.message)}</div>`;
        }
    };
    list?.addEventListener('click', (ev) => {
        const item = ev.target.closest('.notif-activity');
        if (!item || ev.target.closest('a, button, .notif-thread')) return;
        openThread(item);
    });
    list?.addEventListener('keydown', (ev) => {
        const item = ev.target.closest?.('.notif-activity');
        if (!item || ev.target !== item || (ev.key !== 'Enter' && ev.key !== ' ')) return;
        ev.preventDefault();
        openThread(item);
    });

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

    // Everything about one of your posts: a tap opens its thread right here
    const ABOUT_ACTIVITY = {
        ACTIVITY_LIKE: 'liked your activity',
        ACTIVITY_REPLY: 'replied to your activity',
        ACTIVITY_MENTION: 'mentioned you',
        ACTIVITY_MESSAGE: 'sent you a message',
        ACTIVITY_REPLY_SUBSCRIBED: 'replied to an activity you follow',
        ACTIVITY_REPLY_LIKE: 'liked your reply',
    };
    if (ABOUT_ACTIVITY[n.type]) {
        return `<div class="notif-item notif-activity" data-activity="${n.activityId || ''}" role="button" tabindex="0" aria-expanded="false">
            <div class="notif-icon">
                <img src="${n.user?.avatar?.medium || ''}" alt="" style="width:100%;height:100%;border-radius:var(--radius-full);object-fit:cover">
            </div>
            <div class="notif-body">
                <div class="notif-text"><strong>${esc(n.user?.name)}</strong> ${ABOUT_ACTIVITY[n.type]}</div>
                <div class="notif-time">${api.timeAgo(n.createdAt)}</div>
                <div class="notif-thread" hidden></div>
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
