import * as api from '../api.js?v=139';
import { getState, toast, esc, titlePref, emptyIcon, loginState } from '../store.js?v=139';
import { getToken, isLoggedIn } from '../auth.js?v=139';

export async function render({ content }) {
    const token = getToken();
    const user = getState().user;

    if (!isLoggedIn() || !user) {
        content.innerHTML = loginState(emptyIcon('user'), 'Log in to see the social feed', 'What the people you follow on AniList watch, rate and say about it.');
        return;
    }

    content.innerHTML = `<div class="page-enter">
        <h1 class="section-title" style="margin-bottom:var(--space-lg)">Social</h1>
        <div class="tab-group" style="margin-bottom:var(--space-lg)">
            <button class="tab-btn active" id="tab-following">Following</button>
            <button class="tab-btn" id="tab-global">Global</button>
            <button class="tab-btn" id="tab-friends">Friends</button>
        </div>
        <div id="social-content"></div>
        <div id="load-more-social" style="text-align:center;margin-top:var(--space-xl)" hidden>
            <button class="glass-btn glass-btn-secondary" id="more-activity-btn">Load More</button>
        </div>
    </div>`;

    let currentPage = 1;
    // Per person and show, which viewing the next older post belongs to (kept across "Load More")
    let rewatchRuns = new Map();
    let currentTab = 'following';

    async function loadFeed(page = 1, append = false) {
        const socialContent = document.getElementById('social-content');
        if (!socialContent) return;

        if (!append) socialContent.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

        try {
            if (currentTab === 'friends') {
                await loadFriendsList(socialContent);
                document.getElementById('load-more-social').hidden = true;
                return;
            }

            const isFollowing = currentTab === 'following';
            const result = await api.getActivityFeed(page, isFollowing, token);
            if (!append) rewatchRuns = new Map();
            await countRewatches(result.activities, rewatchRuns, token);

            const html = collapseRuns(result.activities.filter(a => a))
                .map(a => renderActivity(a))
                .join('');

            // Added below, not redrawn: a reply being typed further up stays
            if (append) socialContent.insertAdjacentHTML('beforeend', html);
            else socialContent.innerHTML = html || '<div class="empty-state"><div class="empty-state-sub">No activity yet</div></div>';

            document.getElementById('load-more-social').hidden = !result.pageInfo.hasNextPage;
            currentPage = page;

            socialContent.querySelectorAll('.like-btn:not([data-bound])').forEach(btn => {
                btn.dataset.bound = '1';
                btn.addEventListener('click', async () => {
                    const actId = parseInt(btn.dataset.id);
                    const type = btn.dataset.actType;
                    try {
                        const result = await api.toggleLike(actId, type, token);
                        const isLiked = result?.isLiked;
                        btn.classList.toggle('liked', isLiked);
                        const heartSvg = btn.querySelector('svg');
                        if (heartSvg) heartSvg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
                        const countEl = btn.querySelector('.like-count');
                        if (countEl) {
                            const count = parseInt(countEl.textContent) + (isLiked ? 1 : -1);
                            countEl.textContent = count;
                        }
                        const card = btn.closest('.activity-card');
                        let avatarsEl = card?.querySelector('.liker-avatars');
                        if (isLiked && user) {
                            if (!avatarsEl) {
                                avatarsEl = document.createElement('div');
                                avatarsEl.className = 'liker-avatars';
                                btn.parentElement.insertBefore(avatarsEl, btn.nextSibling);
                            }
                            if (!avatarsEl.querySelector(`[data-liker="${user.name}"]`)) {
                                const a = document.createElement('a');
                                a.href = `#/user/${user.name}`;
                                a.className = 'liker-avatar';
                                a.title = user.name;
                                a.dataset.liker = user.name;
                                a.innerHTML = `<img src="${user.avatar?.medium || ''}" alt="${esc(user.name)}" loading="lazy">`;
                                avatarsEl.appendChild(a);
                            }
                        } else if (!isLiked && avatarsEl && user) {
                            const myAvatar = avatarsEl.querySelector(`[data-liker="${user.name}"]`);
                            if (myAvatar) myAvatar.remove();
                            if (!avatarsEl.children.length) avatarsEl.remove();
                        }
                    } catch (e) { toast(e.message, 'error'); }
                });
            });

            // Media links and cards inside text posts open the detail panel (one delegated
            // listener — the container survives "load more", so bind it only once)
            if (!socialContent.dataset.mediaLinks) {
                socialContent.dataset.mediaLinks = '1';
                socialContent.addEventListener('click', (e) => {
                    // A hidden spoiler swallows the first click — nothing inside opens by accident
                    const spoiler = e.target.closest('.activity-spoiler:not(.revealed)');
                    if (spoiler) {
                        e.preventDefault();
                        spoiler.classList.add('revealed');
                        return;
                    }
                    const replyBtn = e.target.closest('.reply-toggle');
                    if (replyBtn) {
                        // Ahead of you on a show: the replies may give away what you have not seen; one
                        // tap says so, the next shows them
                        const card = replyBtn.closest('.activity-card');
                        if (card?.dataset.ahead && !card.dataset.shown && replyBtn.getAttribute('aria-expanded') !== 'true') {
                            card.dataset.shown = '1';
                            card.querySelector('.activity-ahead')?.classList.add('is-warning');
                            replyBtn.title = 'Replies may spoil episodes you have not seen. Tap again to show them';
                            toast('Replies may spoil episodes you have not seen yet. Tap again to show them');
                            return;
                        }
                        toggleReplies(replyBtn, token);
                        return;
                    }
                    const shield = e.target.closest('.activity-ahead');
                    if (shield) {
                        shield.closest('.activity-card')?.classList.add('is-revealed');
                        return;
                    }
                    const replyTo = e.target.closest('.activity-reply-to');
                    if (replyTo) {
                        mentionInReply(replyTo);
                        return;
                    }
                    const target = e.target.closest('.activity-text [data-media-id]');
                    if (!target) return;
                    e.preventDefault();
                    const id = parseInt(target.dataset.mediaId);
                    if (id && window.__openDetailPanel) window.__openDetailPanel(id);
                });
                socialContent.addEventListener('submit', (e) => {
                    const form = e.target.closest('.activity-reply-form');
                    if (!form) return;
                    e.preventDefault();
                    sendReply(form, token);
                });
            }
            hydrateEmbeds(socialContent, token);
        } catch (err) {
            socialContent.innerHTML = `<div class="empty-state"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
        }
    }

    async function loadFriendsList(container, page = 1) {
        try {
            const result = await api.getFollowing(user.id, page, token);
            const friends = result.following;
            if (page > 1) {
                container.querySelector('.friends-more')?.remove();
                container.querySelector('.friends-grid')?.insertAdjacentHTML('beforeend', friends.map(friendTile).join(''));
                if (result.pageInfo?.hasNextPage) container.insertAdjacentHTML('beforeend', moreFriends(page + 1));
                return;
            }

            if (!friends?.length) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-sub">You\'re not following anyone yet</div></div>';
                return;
            }

            container.innerHTML = `<div class="friends-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-md)">
                ${friends.map(friendTile).join('')}
            </div>${result.pageInfo?.hasNextPage ? moreFriends(2) : ''}`;
            if (!container.dataset.friendsMore) {
                container.dataset.friendsMore = '1';
                container.addEventListener('click', (ev) => {
                    const btn = ev.target.closest('[data-friends-page]');
                    if (!btn) return;
                    btn.disabled = true;
                    loadFriendsList(container, Number(btn.dataset.friendsPage));
                });
            }
        } catch (err) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-sub">${esc(err.message)}</div></div>`;
        }
    }
    const moreFriends = (next) => `<div class="friends-more" style="text-align:center;margin-top:var(--space-lg)"><button class="glass-btn glass-btn-secondary" data-friends-page="${next}">Show more</button></div>`;
    const friendTile = (f) => `
                    <div class="friend-tile" data-go="/user/${esc(f.name)}" role="link" tabindex="0">
                        <div style="display:flex;align-items:center;gap:var(--space-md)">
                            <img src="${f.avatar?.medium || ''}" alt="${esc(f.name)}" style="width:48px;height:48px;border-radius:var(--radius-full);object-fit:cover">
                            <div>
                                <div style="font-weight:600">${esc(f.name)}</div>
                                <div style="font-size:0.75rem;color:var(--text-secondary)">
                                    ${f.statistics?.anime?.count || 0} Anime · ${f.statistics?.anime?.episodesWatched || 0} Ep · Avg ${f.statistics?.anime?.meanScore || 0}
                                </div>
                            </div>
                        </div>
                    </div>`;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.id.replace('tab-', '');
            loadFeed(1);
        });
    });

    document.getElementById('more-activity-btn')?.addEventListener('click', () => {
        loadFeed(currentPage + 1, true);
    });

    loadFeed();
}

// AniList-style rendering of a text post:
// - an anilist.co anime/manga URL alone on its line becomes a media card (filled by hydrateEmbeds),
//   which is exactly what AniList itself does — that's why the Watch Party post puts URLs there
// - [title](url) markdown links, bare URLs and @mentions become links
// Everything is escaped first; only http(s) URLs ever end up in an href.
const MEDIA_URL = /^https?:\/\/anilist\.co\/(anime|manga)\/(\d+)(?:\/\S*)?$/i;

function mediaLinkAttrs(url) {
    const m = url.match(/^https?:\/\/anilist\.co\/(?:anime|manga)\/(\d+)/i);
    return m
        ? `href="#" data-media-id="${m[1]}"`
        : `href="${url}" target="_blank" rel="noopener"`;
}

function formatInline(line) {
    // Finished links are parked behind ⟦n⟧ markers so later passes can't rewrite them.
    // (A plain " 11 " marker would collide with text like "Episode 11 in …".)
    const tokens = [];
    const keep = (html) => `⟦${tokens.push(html) - 1}⟧`;
    let s = esc(String(line).replace(/[⟦⟧]/g, ''));
    // `code` first: nothing inside it becomes a link or emphasis
    s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code class="activity-code">${code}</code>`));
    // AniList images: img(url), img220(url), img50%(url) — https only, like every other link
    s = s.replace(/img\d*%?\((https:\/\/[^\s)⟦]+)\)/gi,
        (_, url) => keep(`<img class="activity-img" src="${url}" alt="" loading="lazy">`));
    s = s.replace(/(?:youtube|webm)\((https?:\/\/[^\s)⟦]+)\)/gi,
        (_, url) => keep(`<a class="activity-link" href="${url}" target="_blank" rel="noopener">${url}</a>`));
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)⟦]+)\)/g,
        (_, label, url) => keep(`<a class="activity-link" ${mediaLinkAttrs(url)}>${label}</a>`));
    s = s.replace(/https?:\/\/[^\s<⟦]+/g,
        (url) => keep(`<a class="activity-link" ${mediaLinkAttrs(url)}>${url}</a>`));
    s = s.replace(/@(\w+)/g, (_, name) => keep(`<a href="#/user/${name}" class="activity-mention">@${name}</a>`));
    // Emphasis runs last, on text only — links and mentions are already parked
    s = s.replace(/(__|\*\*)(?=\S)(.+?\S)\1/g, '<strong>$2</strong>');
    s = s.replace(/(^|[\s(])(_|\*)(?=\S)([^_*\n]+?\S)\2(?=[\s).,!?:;]|$)/g, '$1<em>$3</em>');
    return s.replace(/⟦(\d+)⟧/g, (_, i) => tokens[i]);
}

// Spoilers ~!…!~ can span several lines and contain links or cards, so they are split off
// first and their inside is rendered like any other text, hidden until clicked.
// ~~~…~~~ centres its content the same way (AniList uses it a lot around images).
function formatActivityText(text) {
    return splitBlocks(text, /~!([\s\S]*?)!~/,
        inner => `<span class="activity-spoiler" title="Spoiler — click to show">${formatCentered(inner)}</span>`,
        formatCentered);
}

function formatCentered(text) {
    // The block separates itself, so the line breaks right around it would only add blank lines
    return splitBlocks(text, /\n?~~~([\s\S]*?)~~~\n?/,
        inner => `<div class="activity-center">${formatActivityLines(inner.replace(/^\n|\n$/g, ''))}</div>`,
        formatActivityLines);
}

// Renders the parts of `text` between matches of `re` with `outside`, the captured insides with `inside`
function splitBlocks(text, re, inside, outside) {
    const parts = String(text).split(re);
    return parts.map((part, i) => (i % 2 ? inside(part) : outside(part))).join('');
}

// Line-level markdown as AniList renders it. Detected on the raw line; the content still goes
// through formatInline, which escapes it first.
const HEADING = /^(#{1,5})\s+(.+)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.+)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function formatActivityLines(text) {
    let html = '';
    let pendingBreak = false;
    let list = null; // 'ul' | 'ol' while list items follow each other
    let quote = null; // lines of a running blockquote
    const closeList = () => {
        if (list) html += `</${list}>`;
        list = null;
    };
    const closeQuote = () => {
        if (quote) html += `<blockquote class="activity-quote">${quote.map(formatInline).join('\n')}</blockquote>`;
        quote = null;
    };
    // Block elements separate themselves: no line break before or after them
    const block = (markup) => {
        closeList();
        closeQuote();
        html += markup;
        pendingBreak = false;
    };

    for (const line of String(text).split('\n')) {
        const bullet = line.match(BULLET);
        const numbered = !bullet && line.match(NUMBERED);
        if (bullet || numbered) {
            const kind = bullet ? 'ul' : 'ol';
            closeQuote();
            if (list !== kind) {
                closeList();
                html += `<${kind} class="activity-list">`;
                list = kind;
            }
            html += `<li>${formatInline((bullet || numbered)[1])}</li>`;
            pendingBreak = false;
            continue;
        }
        const quoted = line.match(QUOTE);
        if (quoted) {
            closeList();
            (quote ||= []).push(quoted[1]);
            pendingBreak = false;
            continue;
        }
        const heading = line.match(HEADING);
        if (heading) {
            block(`<div class="activity-heading activity-h${heading[1].length}">${formatInline(heading[2])}</div>`);
            continue;
        }
        if (RULE.test(line)) {
            block('<hr class="activity-rule">');
            continue;
        }
        const media = line.trim().match(MEDIA_URL);
        if (media) {
            // Block element: no line break around it, the card itself separates the lines
            block(`<div class="activity-embed loading" data-media-id="${media[2]}" data-type="${media[1].toLowerCase()}">
                <div class="activity-media">
                    <div class="activity-media-img"></div>
                    <div class="activity-media-info">
                        <div class="activity-embed-title">${esc(line.trim())}</div>
                    </div>
                </div>
            </div>`);
            continue;
        }
        // An empty line right after a block would show as a gap on top of the block's own margin
        if (!line.trim() && (list || quote)) {
            closeList();
            closeQuote();
            continue;
        }
        closeList();
        closeQuote();
        if (pendingBreak) html += '\n';
        html += formatInline(line);
        pendingBreak = true;
    }
    closeList();
    closeQuote();
    return html;
}

// Opens/closes the reply thread under an activity; the replies are fetched on first open only
async function toggleReplies(btn, token) {
    const box = btn.closest('.activity-card')?.querySelector(`.activity-replies[data-for="${btn.dataset.id}"]`);
    if (!box) return;
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open || box.dataset.loaded) return;

    const id = Number(btn.dataset.id);
    const form = `<form class="activity-reply-form" data-id="${id}">
        <input class="glass-input" name="text" maxlength="2000" placeholder="Write a reply" aria-label="Write a reply" autocomplete="off" required>
        <button type="submit" class="glass-btn glass-btn-primary glass-btn-sm">Reply</button>
    </form>`;

    if (!Number(btn.dataset.count)) {
        box.dataset.loaded = '1';
        box.innerHTML = form;
        box.querySelector('input')?.focus();
        return;
    }

    box.innerHTML = '<div class="activity-replies-status">Loading replies…</div>';
    try {
        const replies = await api.getActivityReplies(id, token);
        box.dataset.loaded = '1';
        box.innerHTML = (replies.length ? replies.map(renderReply).join('') : '<div class="activity-replies-status">No replies</div>') + form;
        hydrateEmbeds(box, token);
    } catch (err) {
        box.innerHTML = `<div class="activity-replies-status">${esc(err.message)}</div>`;
    }
}

export function renderReply(r) {
    return `<div class="activity-reply">
        <img class="activity-reply-avatar" src="${esc(r.user?.avatar?.medium || '')}" alt="" loading="lazy">
        <div class="activity-reply-body">
            <div class="activity-reply-head">
                <a href="#/user/${esc(r.user?.name)}" class="activity-user">${esc(r.user?.name)}</a>
                <span class="activity-time">${api.timeAgo(r.createdAt)}</span>
                ${r.user?.name ? `<button type="button" class="activity-reply-to" data-name="${esc(r.user.name)}" aria-label="Reply to ${esc(r.user.name)}">Reply</button>` : ''}
            </div>
            <div class="activity-text">${formatActivityText(r.text || '')}</div>
        </div>
    </div>`;
}

// "Reply" on a reply: starts the answer with @name, so AniList notifies that person too
function mentionInReply(btn) {
    const input = btn.closest('.activity-replies')?.querySelector('.activity-reply-form input');
    if (!input) return;
    const mention = `@${btn.dataset.name} `;
    if (!input.value.includes(mention.trim())) input.value = mention + input.value.replace(/^\s+/, '');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

// Posts a reply and shows it in place — no refetch of the thread
async function sendReply(form, token) {
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const text = input.value.trim();
    if (!text || button.disabled) return;

    button.disabled = true;
    input.disabled = true;
    try {
        const reply = await api.postActivityReply(Number(form.dataset.id), text, token);
        form.parentElement.querySelector('.activity-replies-status')?.remove();
        form.insertAdjacentHTML('beforebegin', renderReply(reply));
        hydrateEmbeds(form.parentElement, token);
        input.value = '';

        const toggle = form.closest('.activity-card')?.querySelector(`.reply-toggle[data-id="${form.dataset.id}"]`);
        if (toggle) {
            toggle.dataset.count = String(Number(toggle.dataset.count || 0) + 1);
            const count = toggle.querySelector('.reply-count');
            if (count) count.textContent = toggle.dataset.count;
        }
    } catch (err) {
        toast(err.rateLimited ? 'AniList is rate limiting — try again in a few minutes' : err.message, 'error');
    } finally {
        button.disabled = false;
        input.disabled = false;
        input.focus();
    }
}

// Fills the media cards of everything rendered so far — one AniList request per feed page
async function hydrateEmbeds(root, token) {
    const cards = [...root.querySelectorAll('.activity-embed.loading')];
    if (!cards.length) return;
    let media;
    try {
        media = await api.getMediaCards(cards.map(c => c.dataset.mediaId), token);
    } catch {
        return; // cards keep showing the plain URL
    }
    for (const card of cards) {
        const m = media.get(Number(card.dataset.mediaId));
        if (!m) continue;
        const meta = [
            m.format ? api.formatFormat(m.format) : '',
            m.status ? api.formatMediaStatus(m.status) : '',
            m.season && m.seasonYear ? `${api.getSeasonName(m.season)} ${m.seasonYear}` : '',
            m.meanScore ? `${m.meanScore}%` : '',
        ].filter(Boolean).join(' · ');
        card.classList.remove('loading');
        card.innerHTML = `<div class="activity-media" data-media-id="${m.id}">
            <img class="activity-media-img" src="${esc(m.coverImage?.large || '')}" alt="" loading="lazy">
            <div class="activity-media-info">
                <div class="activity-embed-title">${esc(titlePref(m.title))}</div>
                ${meta ? `<div class="activity-embed-meta">${esc(meta)}</div>` : ''}
            </div>
        </div>`;
    }
}

function renderActivity(activity) {
    if (activity.type === 'TEXT') {
        return `<div class="activity-card">
            <div class="activity-header">
                <img class="activity-avatar" src="${activity.user?.avatar?.medium || ''}" alt="${esc(activity.user?.name)}" data-go="/user/${esc(activity.user?.name)}">
                <div>
                    <a href="#/user/${esc(activity.user?.name)}" class="activity-user">${esc(activity.user?.name)}</a>
                    <div class="activity-time">${api.timeAgo(activity.createdAt)}</div>
                </div>
            </div>
            <div class="activity-text">${formatActivityText(activity.text || '')}</div>
            ${renderActivityActions(activity, 'TEXT_ACTIVITY')}
        </div>`;
    }

    if (activity.type === 'ANIME_LIST' || activity.type === 'MANGA_LIST') {
        const statusText = getActivityStatusText(activity);
        const ahead = aheadOfYou(activity);
        return `<div class="activity-card${ahead ? ' is-ahead' : ''}"${ahead ? ` data-ahead="${esc(ahead)}"` : ''}>
            <div class="activity-header">
                <img class="activity-avatar" src="${activity.user?.avatar?.medium || ''}" alt="${esc(activity.user?.name)}" data-go="/user/${esc(activity.user?.name)}">
                <div>
                    <a href="#/user/${esc(activity.user?.name)}" class="activity-user">${esc(activity.user?.name)}</a>
                    <div class="activity-time">${api.timeAgo(activity.createdAt)}</div>
                </div>
            </div>
            <div class="activity-text">${statusText}</div>
            ${activity.media ? `<div class="activity-media" data-open="${activity.media.id}" role="button" tabindex="0">
                <img class="activity-media-img" src="${activity.media.coverImage?.large || ''}" alt="${esc(titlePref(activity.media.title))}" loading="lazy">
                <div class="activity-media-info">
                    <div class="activity-media-title">${esc(titlePref(activity.media.title))}</div>
                    ${activity.progress ? `<div class="activity-media-progress">${activity.type === 'ANIME_LIST' ? 'Episode' : 'Chapter'} ${esc(activity.progress)}${activity.collapsed ? ` <span class="activity-collapsed">· ${activity.collapsed} posts</span>` : ''}</div>` : ''}
                </div>
            </div>` : ''}
            ${ahead ? `<button type="button" class="activity-ahead" title="You have not got this far yet">${esc(ahead)}</button>` : ''}
            ${renderActivityActions(activity, 'ACTIVITY')}
        </div>`;
    }

    if (activity.type === 'MESSAGE') {
        return `<div class="activity-card">
            <div class="activity-header">
                <img class="activity-avatar" src="${activity.messenger?.avatar?.medium || ''}" alt="${esc(activity.messenger?.name)}">
                <div>
                    <a href="#/user/${esc(activity.messenger?.name)}" class="activity-user">${esc(activity.messenger?.name)}</a>
                    <span style="color:var(--text-tertiary);font-size:0.85rem"> → </span>
                    <a href="#/user/${esc(activity.recipient?.name)}" class="activity-user">${esc(activity.recipient?.name)}</a>
                    <div class="activity-time">${api.timeAgo(activity.createdAt)}</div>
                </div>
            </div>
            <div class="activity-text">${esc(activity.message)}</div>
            ${renderActivityActions(activity, 'MESSAGE_ACTIVITY')}
        </div>`;
    }

    return '';
}

// "3 - 5" -> [3, 5], "7" -> [7, 7]
const progressRange = (p) => {
    const n = String(p || '').match(/\d+/g)?.map(Number) || [];
    return n.length ? [Math.min(...n), Math.max(...n)] : null;
};

// The post is about an episode past the one you are on (the feed carries your own entry for each show):
// "Ep 9 · you're on Ep 7", else ''. Not on your list, or finished: nothing to spoil
function aheadOfYou(a) {
    const mine = a.media?.mediaListEntry;
    const range = progressRange(a.progress);
    if (!mine || !range || !['CURRENT', 'PAUSED', 'REPEATING', 'PLANNING'].includes(mine.status)) return '';
    const unit = a.type === 'MANGA_LIST' ? 'Ch' : 'Ep';
    return range[1] > (mine.progress || 0) ? `${unit} ${range[1]} · you're on ${unit} ${mine.progress || 0}` : '';
}

// A binge fills the feed with one post per episode: posts in a row by the same person on the same show,
// each a plain "watched episode", become one card "Episode 3 - 7" (the newest post's likes and replies)
function collapseRuns(activities) {
    const out = [];
    const plain = (a) => (a.type === 'ANIME_LIST' || a.type === 'MANGA_LIST') && /^(watched episode|read chapter)/i.test(a.status || '') && progressRange(a.progress);
    for (const a of activities) {
        const last = out.at(-1);
        if (last && plain(a) && plain(last) && last.user?.id === a.user?.id && last.media?.id === a.media?.id) {
            const [lo1, hi1] = progressRange(last.progress);
            const [lo2, hi2] = progressRange(a.progress);
            last.progress = `${Math.min(lo1, lo2)} - ${Math.max(hi1, hi2)}`;
            last.collapsed = (last.collapsed || 1) + 1;
            continue;
        }
        out.push(a);
    }
    return out;
}

// Rewatches, as AniRoll shows them (AniList itself only says "rewatched"): a post either finishes a
// viewing ("rewatched"/"reread") or is an episode of one ("rewatched episode"/"reread chapter").
const rewatchKind = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'rewatched' || s === 'reread') return 'done';
    if (/^(rewatched|reread) /.test(s)) return 'part';
    return null;
};

// Which rewatch each rewatch post was, from the person's list entry: `repeat` counts finished
// rewatches (AniList and AniRoll raise it when one ends). Walking the posts newest first, a finished
// rewatch before the current run closes it, the next older one belongs to the viewing before; a
// plain "completed"/"watched" post is the first viewing, so older posts get no number.
// The entries cost one request per feed page, and only when the page has a rewatch on it.
async function countRewatches(activities, runs, token) {
    const lists = (activities || []).filter(a => a?.media && a.user && (a.type === 'ANIME_LIST' || a.type === 'MANGA_LIST'));
    const rewatches = lists.filter(a => rewatchKind(a.status));
    const unknown = rewatches.filter(a => !runs.has(`${a.user.id}:${a.media.id}`));
    if (unknown.length) {
        let entries = [];
        try {
            entries = await api.getRewatchCounts([...new Set(unknown.map(a => a.user.id))], [...new Set(unknown.map(a => a.media.id))], token);
        } catch { /* the posts read "Rewatched" without a number */ }
        for (const a of unknown) {
            const key = `${a.user.id}:${a.media.id}`;
            if (runs.has(key)) continue;
            const e = entries.find(x => x.userId === a.user.id && x.mediaId === a.media.id);
            // REPEATING: the viewing going on is repeat + 2, any finished one before it repeat + 1
            runs.set(key, !e ? { stop: true }
                : e.status === 'REPEATING' ? { run: (e.repeat || 0) + 2, closed: true }
                : { run: (e.repeat || 0) + 1, closed: false });
        }
    }
    for (const a of lists) {
        const key = `${a.user.id}:${a.media.id}`;
        const kind = rewatchKind(a.status);
        // A plain post newer than any rewatch: the numbers cannot be told apart from there on
        if (!runs.has(key)) { if (!kind) runs.set(key, { stop: true }); continue; }
        const state = runs.get(key);
        if (state.stop) continue;
        if (!kind) { state.stop = true; continue; }
        if (kind === 'done') {
            if (state.closed) state.run -= 1;
            state.closed = true;
        }
        // The number is the rewatch's, not the viewing's: the first rewatch is the second viewing and
        // stays a plain "Rewatched"; from the second rewatch on it says which one
        if (state.run >= 2) { if (state.run >= 3) a.rewatchNo = state.run - 1; }
        else state.stop = true;
    }
}

const ordinal = (n) => {
    const t = n % 100;
    return `${n}${t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};

function getActivityStatusText(activity) {
    const status = (activity.status || '').toLowerCase();
    const mediaName = esc(titlePref(activity.media?.title));
    const manga = activity.media?.type === 'MANGA';

    if (status.includes('plan')) return `Plans to ${manga ? 'read' : 'watch'} ${mediaName}`;
    const rewatch = rewatchKind(activity.status);
    if (rewatch === 'done') return `${manga ? 'Reread' : 'Rewatched'} ${mediaName}${activity.rewatchNo ? ` a ${ordinal(activity.rewatchNo)} time` : ''}`;
    if (rewatch) return `${manga ? 'Rereading' : 'Rewatching'} ${mediaName}${activity.rewatchNo ? ` (${ordinal(activity.rewatchNo)} time)` : ''}`;
    if (status.includes('complet')) return `Completed ${mediaName}`;
    if (status.includes('drop')) return `Dropped ${mediaName}`;
    if (status.includes('paus')) return `Paused ${mediaName}`;
    if (status.includes('watch') || status.includes('read') || status === 'current') return `${manga ? 'Read' : 'Watched'} ${mediaName}`;
    return `${esc(status)} ${mediaName}`;
}

function renderActivityActions(activity, likeType) {
    const likerAvatars = (activity.likes || []).slice(0, 5);
    const extraLikers = (activity.likeCount || 0) - likerAvatars.length;

    return `<div class="activity-actions">
        <button class="activity-action-btn like-btn ${activity.isLiked ? 'liked' : ''}" data-id="${activity.id}" data-act-type="${likeType}">
            <svg data-icon="favorite" viewBox="0 0 24 24" fill="${activity.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="like-count">${activity.likeCount || 0}</span>
        </button>
        ${likerAvatars.length ? `<div class="liker-avatars">
            ${likerAvatars.map(u => `<a href="#/user/${esc(u.name)}" class="liker-avatar" title="${esc(u.name)}" data-liker="${esc(u.name)}"><img src="${u.avatar?.medium || ''}" alt="${esc(u.name)}" loading="lazy"></a>`).join('')}
            ${extraLikers > 0 ? `<span class="liker-extra">+${extraLikers}</span>` : ''}
        </div>` : ''}
        <button class="activity-action-btn reply-toggle" data-id="${activity.id}" data-count="${activity.replyCount || 0}" aria-expanded="false" title="${activity.replyCount ? 'Show replies' : 'Reply'}">
            <svg data-icon="chat_bubble" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span class="reply-count">${activity.replyCount || 0}</span>
        </button>
    </div>
    <div class="activity-replies" data-for="${activity.id}" hidden></div>`;
}
