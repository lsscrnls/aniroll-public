// What changed in AniRoll: a changelog anyone can open ("What's new"), and a pop-up for returning
// visitors with everything they have not confirmed yet. The tab move of September 2026 also shows a
// small animation of the old tab bar turning into the new one (until the end of October 2026).
import { esc } from './store.js?v=121';
import { openDialog } from './a11y.js?v=121';
import { prefersReducedMotion } from './animations.js?v=121';

const SEEN_KEY = 'aniroll_seen_changes';
// Newest first. `id` sorts as text: a browser has seen everything up to the id it stored. More
// changes on the same day go into that day's entry (one entry per day); if that entry was already
// live, raise its id ('<date>.2', '.3', ...) so people who confirmed it get the pop-up again.
// Every unconfirmed entry pops up for returning visitors on each visit. `notice` is the pop-up for people who knew the
// app before, shown until `notifyUntil`; the changelog keeps every entry.
const CHANGES = [
    {
        // '.2': Up next with a countdown
        // '.3': the episode list, Watch credits
        // '.4': choosing the audio track
        // '.5': Material 3 Expressive for everyone, quality and stats in the player
        id: '2026-09-30.5',
        title: 'Material 3 for everyone, and your Jellyfin right in AniRoll',
        items: [
            '<strong>Material 3 Expressive</strong> is AniRoll’s design now, in the colours of the show you watched last. The first design stays under Settings as <strong>Legacy design</strong>.',
            'The colour style (Tonal, Vibrant, Expressive) now also shapes the colours taken from your show.',
            'Shows in your Jellyfin library get a <strong>Play</strong> button: episodes play in AniRoll, and finishing one ticks it off on AniList.',
            'It picks up where you stopped, and Jellyfin only converts what your browser can’t play.',
            '<strong>Subtitles</strong> look the way the release made them: styled signs and karaoke with the file’s own fonts, and Blu-ray subtitles too.',
            '<strong>Skip intro</strong>, recaps and credits with one press, when your server knows where they are.',
            'When the credits roll, <strong>Up next</strong> counts down to the next episode; its subtitles are already waiting. Rather see the credits? <strong>Watch credits</strong>, and it asks again at the very end.',
            'Dual audio? Pick the <strong>audio track</strong> next to the subtitles; AniRoll keeps it for the rest of the show.',
            'The gear sets the <strong>quality</strong>: Auto measures your connection, Maximum plays the original, or pick a bitrate. <strong>Stats for nerds</strong> (I) shows what plays and how.',
            '<strong>Episodes</strong> next to Play lists every episode your Jellyfin has, with the seasons before and after: start any of them, for a rewatch or one you skipped.',
            'Signing in to Jellyfin works with <strong>Quick Connect</strong>: confirm a code in Jellyfin, no password typed into AniRoll.',
        ],
    },
    {
        // '.2': voice actor pages, spoiler tags on request, the new progress wave
        // '.3': the Watch Party page in Material 3
        id: '2026-09-28.3',
        title: 'Starting soon, studios, voice actors and a fairer Roll',
        items: [
            'Home shows what’s <strong>starting soon</strong> from your Planning list, with how long until its first episode.',
            'My List can be <strong>filtered by format</strong>: TV, movies, OVAs, ONAs or specials, one tap on a chip.',
            'A show’s <strong>studios</strong> are cards now, and each opens a <strong>studio page</strong> with everything they made.',
            'Related shows appear as <strong>covers</strong> you can scroll through, not as a list of names.',
            '<strong>Roll</strong> no longer picks the same show again soon: every show gets its turn before one comes back.',
            'Every character shows their <strong>voice actor</strong>; tap one to see all the anime they voice, and who they play there.',
            'Tags that give away the story stay hidden until you tap <strong>Show spoiler tags</strong>.',
            'Material 3: progress runs as a wave up to a round dot, like Android’s media player; after it the line goes on flat.',
            'Material 3: the <strong>Watch Party</strong> page got a new look — the show’s banner behind it, a big episode counter, the people and the invite on the side.',
        ],
    },
    {
        // '.2': joining a Watch Party broke after this entry went live; the fix brings it back to everyone.
        // '.3': scores out of 100 everywhere
        id: '2026-09-27.3',
        title: 'A new Home, and Material 3 follows your pointer',
        video: { src: 'media/design-aniroll.mp4', poster: 'media/design-aniroll.jpg', label: 'The new Home in action' },
        items: [
            '<strong>Home</strong> opens on the show you’re on: its banner, your progress and <strong>Watched episode N</strong> right there.',
            'Below it: a <strong>live countdown</strong> to your next episode, what’s ready to watch, what airs this week.',
            'Continue Watching starts with your second show, so nothing appears twice.',
            'In Material 3 the <strong>pointer takes the shape</strong> of what it points at: a cookie on buttons, a flower on shows.',
            'Material 3: every cover on Home opens its show, and the detail panel pushes the page aside.',
            'Material 3: the progress wave ends in a dot, on top or at the bottom, wherever the wave stops.',
            '<strong>Fixed:</strong> joining a Watch Party failed with an error for a few hours. It works again.',
            'Scores are always <strong>out of 100</strong> in AniRoll. Scores kept as 10 points, 5 stars or smileys on AniList are converted.',
            '<strong>Fixed:</strong> with a 10 point, 5 star or smiley format on AniList, My List showed some scores wrong.',
        ],
    },
    {
        id: '2026-09-26',
        title: 'Material 3 Expressive, your own colours, scores your way',
        // A clip behind "See it in action": the dialog widens and plays it in place
        video: { src: 'media/m3.mp4', poster: 'media/m3.jpg', label: 'Material 3 Expressive in action' },
        items: [
            'A second design: <strong>Material 3 Expressive</strong>. Switch it on in Settings → Appearance.',
            'It wears the colours of the <strong>show you watched last</strong>: its cover becomes a soft wallpaper and every surface follows. Or choose a palette of your own.',
            'Home opens on your next episode, with widgets for the next airing, what’s ready to watch and your week.',
            'Everything answers your touch: ripples, springy motion and a little burst for every episode you mark.',
            'Pick <strong>any colour by hex code</strong> in both designs: type it in or use the colour picker.',
            'Scores follow your <strong>AniList score format</strong>: 100 points, 10 with or without decimals, 5 stars or 3 smileys.',
            'Jellyfin no longer undoes an episode count you corrected by hand.',
        ],
    },
    {
        // '.2': the day's entry grew after it went live — a new id brings it back for whoever confirmed it
        id: '2026-09-25.2',
        title: 'Roll recommendations, tidier settings, a livelier front page',
        items: [
            'Roll can include <strong>recommended titles</strong> that are not on your list yet: tick “Include recommended titles”.',
            'A recommended pick shows its match and why it was suggested, with <strong>Plan to Watch</strong> right there.',
            'The front page shows AniRoll in action: short clips of Roll, My List, the calendar and the taste match.',
            'The top bar turns frosted once you scroll, so the page glides softly underneath.',
            '<strong>Settings</strong> are sorted into tabs: Appearance, Lists, Watch Party and Jellyfin.',
        ],
    },
    {
        id: '2026-09-22.2',
        title: 'A roomier calendar week',
        notifyUntil: new Date(2026, 10, 1),
        notice: {
            heading: 'The calendar week got roomier',
            items: [
                'On big screens the week uses the <strong>full width</strong>, and every day fills its column.',
                'Each episode shows its <strong>time</strong> first, a bigger cover and up to three lines of title.',
                'Shows on your list say where you stand: <strong>Next up</strong>, <strong>2 behind</strong>, <strong>Watched</strong> or <strong>Planning</strong>.',
            ],
        },
        items: [
            'The week view uses the full width of big screens; days fill their column.',
            'Time first, bigger covers, titles up to three lines.',
            'Your shows show where you stand: <strong>Next up</strong>, <strong>N behind</strong>, <strong>Watched</strong> or <strong>Planning</strong>.',
        ],
    },
    {
        id: '2026-09-22',
        title: 'Navigation and calendar',
        tabs: true,
        notifyUntil: new Date(2026, 10, 1),
        notice: {
            heading: 'A few things moved',
            items: [
                'Browse, Season and Calendar are now under <strong>Discover</strong>.',
                '<strong>My List</strong> sits right next to Home.',
                'The calendar opens on <strong>this week</strong>; Month is one click away.',
            ],
        },
        items: [
            'Five tabs: Home, My List, Roll, Discover, Social. Browse, Season and Calendar now live under <strong>Discover</strong>.',
            'The calendar opens on <strong>this week</strong>, with airing times. Month is one click away.',
            'My List → Planning: <strong>Roll from this list</strong>.',
            'Posts show headings, lists and quotes. <strong>Reply</strong> in a thread mentions that person.',
            'Every card and list entry opens with the keyboard; dialogs close with Escape.',
            'Respects “Reduce motion” in your system settings.',
            'Fonts come from AniRoll itself — nothing is loaded from Google any more.',
        ],
    },
];
const LATEST = CHANGES[0].id;
const dateOf = (c) => new Date(`${c.id.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const OLD_TABS = [['home', 'Home'], ['roll', 'Roll'], ['search', 'Browse'], ['season', 'Season'], ['calendar', 'Calendar'], ['social', 'Social'], ['list', 'My List']];
const NEW_TABS = [['home', 'Home'], ['list', 'My List'], ['roll', 'Roll'], ['discover', 'Discover'], ['social', 'Social']];
const MERGED = ['search', 'season', 'calendar'];

function seen() {
    try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return LATEST; }
}
function markSeen() {
    try { localStorage.setItem(SEEN_KEY, LATEST); } catch { /* storage blocked */ }
    document.documentElement.classList.remove('whatsnew-unread');
}
export const hasUnread = () => seen() < LATEST;

// Call first thing on start, before anything else writes to storage: a browser that has AniRoll
// data already knew the old layout. A new one never sees the "things moved" notice — it is
// marked as up to date right away, or it would count as returning on its second visit.
export function noteVisitor() {
    let returning = false;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            if (localStorage.key(i)?.startsWith('aniroll_')) { returning = true; break; }
        }
    } catch { return false; }
    if (!returning) markSeen();
    return returning;
}

// Everything a returning visitor has not confirmed yet — on every visit until "Got it", oldest first.
// An entry with a `notice` uses that wording (and the tab animation) until `notifyUntil`, after that
// its changelog text.
const noticeOn = (c) => !!c.notice && new Date() < c.notifyUntil;
const headingOf = (c) => noticeOn(c) ? c.notice.heading : c.title;
const itemsOf = (c) => noticeOn(c) ? c.notice.items : c.items;
function pendingNotices() {
    return CHANGES.filter(c => seen() < c.id).reverse();
}

// The one-time notice: returning visitors, everything they have not confirmed with "Got it"
export function maybeShowMoveNotice(returning) {
    if (!returning || !pendingNotices().length) return;
    setTimeout(() => {
        // Not on top of something else (a dialog, the OAuth redirect, a page that failed)
        if (document.querySelector('[aria-modal="true"]')) return;
        showDialog('notice');
    }, 1200);
}

export function openChangelog() {
    showDialog('changelog');
}

function tabBar() {
    return `<div class="whatsnew-demo" aria-hidden="true">
        <div class="whatsnew-bar"></div>
        <div class="whatsnew-demo-foot">
            <span class="whatsnew-stage">Before</span>
            <button type="button" class="whatsnew-replay" tabindex="-1">Replay</button>
        </div>
    </div>`;
}

function videoTeaser(v) {
    return `<button type="button" class="whatsnew-watch" data-src="${esc(v.src)}" data-poster="${esc(v.poster)}" aria-label="${esc(v.label)}">
        <img src="${esc(v.poster)}" alt="" loading="lazy">
        <span class="whatsnew-watch-label"><span class="whatsnew-watch-play" aria-hidden="true"><svg data-icon="play_arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg></span>See it in action</span>
    </button>`;
}

function showDialog(mode) {
    const returning = mode === 'notice';
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop whatsnew-backdrop';
    const where = document.getElementById('login-btn')?.hidden === false
        ? 'at the bottom of the home page'
        : 'in the profile menu';
    const pending = returning ? pendingNotices() : [];
    const single = pending.length === 1;
    overlay.innerHTML = returning
        ? `<div class="modal-content whatsnew">
            <div class="whatsnew-kicker">${single ? 'New in AniRoll' : 'Since your last visit'}</div>
            <h2 class="modal-title">${single ? headingOf(pending[0]) : 'A few things changed'}</h2>
            ${pending.map(c => `<section class="whatsnew-entry">
                ${single ? '' : `<h3 class="whatsnew-heading">${headingOf(c)}</h3>`}
                ${c.tabs && noticeOn(c) ? tabBar() : ''}
                ${c.video ? videoTeaser(c.video) : ''}
                <ul class="whatsnew-list">${itemsOf(c).map(item => `<li>${item}</li>`).join('')}</ul>
            </section>`).join('')}
            <p class="whatsnew-note">Everything that changed: <em>What's new</em> ${esc(where)}.</p>
            <div class="whatsnew-actions"><button type="button" class="glass-btn glass-btn-primary" data-close>Got it</button></div>
        </div>`
        : `<div class="modal-content whatsnew">
            <h2 class="modal-title">What's new</h2>
            ${CHANGES.map((c, i) => `<section class="whatsnew-entry">
                <div class="whatsnew-date">${dateOf(c)} · ${esc(c.title)}</div>
                ${c.tabs && CHANGES.findIndex(x => x.tabs) === i ? tabBar() : ''}
                ${c.video ? videoTeaser(c.video) : ''}
                <ul class="whatsnew-list">${c.items.map(item => `<li>${item}</li>`).join('')}</ul>
            </section>`).join('')}
            <div class="whatsnew-actions"><button type="button" class="glass-btn glass-btn-primary" data-close>Close</button></div>
        </div>`;
    document.body.appendChild(overlay);

    const box = overlay.querySelector('.whatsnew');
    const close = () => {
        release();
        overlay.remove();
        markSeen();
        // Only the one-time notice points at the real tabs; the changelog doesn't need to any more
        if (returning && overlay.querySelector('.whatsnew-demo')) pointAtTabs();
    };
    const release = openDialog(box, { label: box.querySelector('.modal-title').textContent, onClose: close, focus: '[data-close]' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);

    // "See it in action": the dialog grows wide and the clip plays where the teaser was
    overlay.querySelectorAll('.whatsnew-watch').forEach(btn => btn.addEventListener('click', () => {
        const video = document.createElement('video');
        Object.assign(video, { src: btn.dataset.src, poster: btn.dataset.poster, muted: true, loop: true, playsInline: true });
        video.className = 'whatsnew-video';
        video.setAttribute('aria-label', btn.getAttribute('aria-label'));
        if (prefersReducedMotion()) video.controls = true;
        else video.autoplay = true;
        box.classList.add('is-wide');
        btn.replaceWith(video);
        video.play?.().catch(() => { video.controls = true; });
    }));

    const demo = overlay.querySelector('.whatsnew-demo');
    if (demo) {
        demo.querySelector('.whatsnew-replay').addEventListener('click', () => playTabs(demo));
        playTabs(demo);
    }
}

const chip = ([key, label], extra = '') => `<span class="whatsnew-tab${extra}" data-k="${key}">${label}</span>`;

// Old bar → new bar. FLIP: measure where every tab was, lay out the new order, then let each
// tab glide from its old spot. The three Discover tabs fly into Discover and fade out.
function playTabs(demo) {
    const bar = demo.querySelector('.whatsnew-bar');
    const stage = demo.querySelector('.whatsnew-stage');
    const replay = demo.querySelector('.whatsnew-replay');
    clearTimeout(demo._timer);
    bar.getAnimations({ subtree: true }).forEach(a => a.cancel());

    const showNew = () => {
        bar.innerHTML = NEW_TABS.map(t => chip(t, t[0] === 'discover' ? ' is-new' : t[0] === 'list' ? ' is-moved' : '')).join('');
        stage.textContent = 'Now';
    };
    if (prefersReducedMotion()) {
        showNew();
        replay.hidden = true;
        return;
    }

    bar.innerHTML = OLD_TABS.map(t => chip(t, MERGED.includes(t[0]) ? ' is-leaving' : '')).join('');
    stage.textContent = 'Before';
    replay.hidden = true;
    // The old bar can wrap where the new one does not: keep the height, or the dialog jumps
    bar.style.minHeight = '';
    bar.style.minHeight = `${bar.offsetHeight}px`;

    demo._timer = setTimeout(() => {
        const origin = bar.getBoundingClientRect();
        const before = {};
        bar.querySelectorAll('[data-k]').forEach(el => {
            const r = el.getBoundingClientRect();
            before[el.dataset.k] = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
        });

        showNew();
        const after = {};
        bar.querySelectorAll('[data-k]').forEach(el => {
            const r = el.getBoundingClientRect();
            after[el.dataset.k] = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
        });
        const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';

        // Tabs that stay glide to their new place
        bar.querySelectorAll('[data-k]').forEach(el => {
            const from = before[el.dataset.k];
            const to = after[el.dataset.k];
            if (!from) return;
            el.animate([{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` }, { transform: 'none' }],
                { duration: 750, easing: ease });
        });

        // Browse, Season, Calendar: ghosts at their old spots, pulled into Discover
        const target = after.discover;
        MERGED.forEach((key, i) => {
            const from = before[key];
            const ghost = document.createElement('span');
            ghost.className = 'whatsnew-tab is-leaving whatsnew-ghost';
            ghost.textContent = OLD_TABS.find(t => t[0] === key)[1];
            ghost.style.left = `${from.x}px`;
            ghost.style.top = `${from.y}px`;
            bar.appendChild(ghost);
            const dx = target.x + target.w / 2 - (from.x + from.w / 2);
            const dy = target.y + target.h / 2 - (from.y + from.h / 2);
            ghost.animate([
                { transform: 'none', opacity: 1 },
                { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0 },
            ], { duration: 650, delay: i * 70, easing: ease, fill: 'forwards' }).onfinish = () => ghost.remove();
        });

        bar.querySelector('[data-k="discover"]')?.animate([
            { opacity: 0, transform: 'scale(0.7)' },
            { opacity: 1, transform: 'scale(1.08)', offset: 0.7 },
            { opacity: 1, transform: 'scale(1)' },
        ], { duration: 600, delay: 380, easing: ease, fill: 'backwards' });

        setTimeout(() => { replay.hidden = false; }, 1100);
    }, 1100);
}

// After closing: the real My List and Discover tabs light up for a moment
function pointAtTabs() {
    const tabs = document.querySelectorAll('.nav-links [data-page="discover"], .nav-links [data-page="list"], .mobile-tabbar [data-page="discover"], .mobile-tabbar [data-page="list"]');
    tabs.forEach(el => el.classList.add('whatsnew-hint'));
    setTimeout(() => tabs.forEach(el => el.classList.remove('whatsnew-hint')), 2600);
}
