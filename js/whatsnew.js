// @ts-check
// What changed in AniRoll: a changelog anyone can open ("What's new"), and a pop-up for returning
// visitors with everything they have not confirmed yet. The tab move of September 2026 also shows a
// small animation of the old tab bar turning into the new one (until the end of October 2026).
import { esc } from './store.js?v=157';
import { openDialog } from './a11y.js?v=157';
import { prefersReducedMotion } from './animations.js?v=157';
import { accountState, saveAccountState } from './accountstate.js?v=157';

// The version people see; scripts/release.sh counts it up (the ?v= numbers only bust caches)
export const RELEASE = '1.5.4';
const SEEN_KEY = 'aniroll_seen_changes';
// Set when a new browser was marked up to date by itself: the account's own answer replaces it
const AUTO_KEY = 'aniroll_seen_auto';
// Newest first. `id` sorts as text: a browser has seen everything up to the id it stored. More
// changes on the same day go into that day's entry (one entry per day); if that entry was already
// live, raise its id ('<date>.2', '.3', ...) and add the new items as { rev: N, text } with that N:
// people who confirmed the earlier release of the day get a pop-up with only the new items.
// Every unconfirmed entry pops up for returning visitors on each visit. `notice` is the pop-up for people who knew the
// app before, shown until `notifyUntil`; the changelog keeps every entry.
const CHANGES = [
    {
        id: '2026-10-09',
        title: 'Up next waits for the story',
        items: [
            'In the player, <strong>Up next</strong> now knows where an episode really ends: a scene after the credits plays before it shows up, and credits with story in them can no longer be skipped by accident.',
            'Installed on an iPhone, AniRoll no longer hides its top bar under the status bar.',
            'Search results can now show the AniRoll logo.',
        ],
    },
    {
        // '.2': the move to aniroll.app
        // '.3': calmer Home, show pages, lists and Roll
        id: '2026-10-08.3',
        title: 'AniRoll moved to aniroll.app, and a calmer look',
        items: [
            { rev: 3, text: 'When none of your shows has a new episode yet, the big card on Home says when the next one airs and offers a <strong>Roll</strong> instead of a big number. With nothing left to watch, the small card next to it says you are caught up.' },
            { rev: 3, text: 'Show cards say one thing at a glance: how many episodes are waiting, or when the next one airs. Rows that go on to the side fade out at the edge.' },
            { rev: 3, text: 'Show pages are quieter: the facts read as two short phrases, tags and recommendations drop their extra percentages, and where to watch it sits with the other links at the end.' },
            { rev: 3, text: 'Pages show their outline while they load instead of a spinner.' },
            { rev: 2, text: 'AniRoll now lives at <strong>aniroll.app</strong>. Old links still work and bring you here, and you stay logged in with your Jellyfin and settings.' },
            'The roll on the front page stops exactly on one cover, without an edge of the next one showing, and every cover is there while it spins.',
            'AniRoll can now be found through Google and other search engines.',
        ],
    },
    {
        // '.2': Home's hero picks a show you can watch, show page actions and facts tidied; '.3': new shows found sooner
        id: '2026-10-06.3',
        title: 'A tidier show page and a new front page',
        items: [
            { rev: 2, text: 'The big card on Home is about a show with an episode <strong>ready to watch</strong>, instead of one that is still waiting for its next episode.' },
            { rev: 2, text: 'Show pages are calmer: the facts under the score are one line of text, the eight most fitting tags come first, and <strong>Remove from list</strong> moved into the status menu.' },
            { rev: 3, text: 'A show that just arrived on your Jellyfin gets its <strong>Play</strong> button after a minute, not ten.' },
            { rev: 2, text: 'Profiles without a banner of their own use the avatar instead of an empty grey block.' },
            'Show pages are much shorter: the <strong>score</strong> sits right under the title, and Characters, Reviews, Stats and the Trailer each have their own <strong>tab</strong>.',
            'When the countdown on Home is already about the show you are on, the clock next to it shows the episode after that.',
            'The tools on <strong>My List</strong> no longer get cut off when they wrap onto a second row, and the post you write after a Watch Party has room for its text.',
            'The front page lets you <strong>roll a show</strong> right away and shows what a Watch Party invite looks like.',
        ],
    },
    {
        // '.2': running Planning shows in the week, the changelog as a page; '.3': profiles cached
        id: '2026-10-05.3',
        title: 'Premieres in your week',
        items: [
            '<strong>Your week</strong> on Home now shows the premieres from your Planning list too, not just the shows you are watching.',
            { rev: 2, text: 'Planned shows that already started count in <strong>Your week</strong> as well, on the day they air.' },
            { rev: 2, text: '<strong>What’s new</strong> in the profile menu opens a page of its own now, with a button back to where you were. New features still greet you in a pop-up.' },
            { rev: 3, text: 'Other people’s profiles open faster: AniRoll keeps them for a while instead of asking AniList every time.' },
        ],
    },
    {
        id: '2026-10-04.6',
        title: 'A smarter player, your list at a glance, and a faster start',
        items: [
            { rev: 6, text: 'The countdown on Home shows the show’s cover, a ring that fills up until it starts, and when it airs. The last hour counts down to the second.' },
            { rev: 6, text: 'AniRoll has a version number now: you find it next to the title of What’s new.' },
            { rev: 5, text: '<strong>Start a Watch Party right from the player</strong>: one button, and the invite link is in your clipboard. Starting a party anywhere else copies the link too.' },
            { rev: 5, text: 'The player shows the file’s <strong>chapters</strong> on the wave, with their names when you point at them.' },
            { rev: 5, text: 'Skip intro and Skip credits step aside after a few seconds, and Watch credits really means it.' },
            { rev: 4, text: '<strong>Play the next episode right from Home</strong>: the Up next card has a Play button when your Jellyfin has the episode.' },
            { rev: 4, text: 'Watch Party invites show the show you are on right now in Discord and other chats: copy the link again after switching shows.' },
            { rev: 3, text: 'Watch Parties are live: the host’s next episode, who joined, votes and “Roll together” reach everyone within a second instead of up to half a minute.' },
            { rev: 3, text: '<strong>Play the next episode right from the Watch Party</strong>, from your own Jellyfin, with every other episode one tap away. The host’s counter follows what you play.' },
            'The player answers every key: volume, speed (<strong>[</strong> and <strong>]</strong>), subtitle timing (<strong>Z</strong> and <strong>X</strong>), <strong>0–9</strong> to jump, <strong>Shift+N</strong> for the episode before. Speed, subtitle timing and size are in the menus too.',
            { rev: 2, text: '<strong>Skip intros automatically</strong>, with Undo: for every show under Settings → Jellyfin → Player, or for one show in the player. Intro and credits show on the wave, and the label above it says when you are in one.' },
            'Up next shows the episode’s picture and length. After a few episodes in a row it asks whether you are still watching, and <strong>Stop after this episode</strong> waits for you.',
            'Finished a show? Rate it right there: on the player’s last card, or when +1 completes it on Home or My List.',
            'Media keys, headset buttons and the lock screen control the player; the tab shows the episode.',
            'Jellyfin marks only the right season as played now, and only when your progress changed. Files with two episodes count as both. A series AniRoll cannot match can be <strong>linked by hand</strong>, even when its second part starts at episode 13.',
            'Invite friends to your Jellyfin with a link: it opens AniRoll with your server filled in.',
            'My List: an <strong>All</strong> tab, <strong>Behind</strong> and genre filters, more ways to sort, your score in one tap, an <strong>export</strong> for MyAnimeList, and changes from anywhere show at once.',
            'Home tells you what aired since your last visit and how long catching up takes; shows you have not touched in weeks can go to Paused in one tap.',
            '<strong>Not interested</strong> on a recommendation keeps it away, on every device.',
            'Search finds your own shows from the first letter. Related titles say where they stand on your list and add a sequel with one tap.',
            'Social hides posts and replies about episodes you have not seen yet, and a binge shows as one post. Notifications include mentions and messages, and open the thread right there.',
            'Watch Party: rate each episode together, edit the post before it goes out, see who else is watching, and invite links show the show in chat apps.',
            'Roll: the match for your own Planning shows, <strong>Fits you best</strong>, and a time filter: tonight, a weekend, or a long haul.',
            'Calendar: <strong>Add to my calendar</strong> puts the week into your phone’s calendar.',
            'AniRoll starts faster, and saving an episode no longer reloads your whole list.',
            'Easier to use with a keyboard and a screen reader, and on phones the details slide up as a proper sheet.',
        ],
    },
    {
        // '.2': played and the resume spot reach Jellyfin with an API key too
        // '.3': confirmed changes follow the account
        // '.4': stream recovery, the end card, offline saves
        id: '2026-10-02.4',
        title: 'Next episode, and intros to enjoy',
        items: [
            'A <strong>Next episode</strong> button sits next to the time in the player; N does the same.',
            '<strong>Skip intro</strong> and <strong>Skip credits</strong> step back after a few seconds, so the opening can play on its own. Move the mouse and they are there again.',
            'Connected to Jellyfin with an API key? Episodes you finish in AniRoll now count as <strong>played in Jellyfin</strong> too, and it remembers where you stopped.',
            'What you confirmed here stays confirmed on every device you sign in on: this list pops up once per change, not once per browser.',
            'The player <strong>reconnects by itself</strong> when the stream drops, right where it stopped; Try again continues there too.',
            'After the last episode you have, a card says what is next: when the next one airs, whether it is missing from your library, or the <strong>next season</strong> to add to Planning.',
            'Offline for a moment? Changes to your list are kept and go out as soon as you are back.',
        ],
    },
    {
        // '.2': subtitles kept per show, the feed fresh after a party
        // '.3': rewatches counted in Social
        // '.4': the Home countdown falls back to the next premiere
        id: '2026-10-01.4',
        title: 'Browse by tag',
        items: [
            'The <strong>tags</strong> on a show’s page open Browse with every show that carries them; tap the tag chip there to switch it off again.',
            'The wave on the player’s progress bar moves a little calmer.',
            'The <strong>subtitles</strong> you pick stay for the next episode of the show, switched off included.',
            'After a Watch Party, its post and your friends’ episodes show in Social right away instead of minutes later.',
            'Rewatches in Social say which time it is: <strong>rewatched a 2nd time</strong>, only in AniRoll.',
            'Nothing you watch airing right now? The <strong>countdown</strong> on Home counts down to the next show from your Planning list instead.',
        ],
    },
    {
        // '.2': Up next with a countdown
        // '.3': the episode list, Watch credits
        // '.4': choosing the audio track
        // '.5': Material 3 Expressive for everyone, quality and stats in the player
        // '.6': Continue or start over
        id: '2026-09-30.6',
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
            'An episode you stopped part-way asks: <strong>Continue</strong> where you left off, or <strong>Start over</strong>. Your place follows you to any device through Jellyfin.',
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
// confirmed: someone closed the dialog, so the account learns it too (every device stays quiet)
function markSeen(confirmed = true) {
    try {
        localStorage.setItem(SEEN_KEY, LATEST);
        if (confirmed) localStorage.removeItem(AUTO_KEY);
        else localStorage.setItem(AUTO_KEY, '1');
    } catch { /* storage blocked */ }
    if (confirmed) saveAccountState('changes', LATEST);
    document.documentElement.classList.remove('whatsnew-unread');
}

// What the account confirmed on another device. A browser that marked itself up to date takes the
// account's answer; otherwise the newer of the two wins and the account hears of a newer one.
// True when the account has an answer: a new browser then counts as a returning visitor.
async function syncSeen() {
    const remote = (await accountState()).changes;
    let auto = false;
    try { auto = localStorage.getItem(AUTO_KEY) === '1'; } catch { /* no storage */ }
    const local = seen();
    if (typeof remote === 'string' && remote && (auto || remote > local)) {
        try { localStorage.setItem(SEEN_KEY, remote); localStorage.removeItem(AUTO_KEY); } catch { /* no storage */ }
    } else if (!auto && local && local > (remote || '')) {
        saveAccountState('changes', local);
    }
    document.documentElement.classList.toggle('whatsnew-unread', hasUnread());
    return typeof remote === 'string' && !!remote;
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
    if (!returning) markSeen(false);
    return returning;
}

// Everything a returning visitor has not confirmed yet — on every visit until "Got it", oldest first.
// An entry with a `notice` uses that wording (and the tab animation) until `notifyUntil`, after that
// its changelog text.
const noticeOn = (c) => !!c.notice && new Date() < c.notifyUntil;
const headingOf = (c) => noticeOn(c) ? c.notice.heading : c.title;
const itemText = (item) => typeof item === 'string' ? item : item.text;
// The release of its day an id stands for: '2026-10-04' is 1, '2026-10-04.3' is 3
const revOf = (id) => Number(String(id).split('.')[1]) || 1;
// Of an entry confirmed earlier the same day, only the items added since
function itemsOf(c) {
    if (noticeOn(c)) return c.notice.items;
    const confirmed = seen();
    // Entries from before items carried their release show whole, as they always did
    const sameDay = confirmed.slice(0, 10) === c.id.slice(0, 10) && c.items.some(item => item.rev);
    return c.items.filter(item => !sameDay || (item.rev || 1) > revOf(confirmed)).map(itemText);
}
function pendingNotices() {
    return CHANGES.filter(c => seen() < c.id && itemsOf(c).length).reverse();
}

// The one-time notice: returning visitors, everything they have not confirmed with "Got it"
export function maybeShowMoveNotice(returning) {
    setTimeout(async () => {
        // Confirmed on another device: nothing to show here; known to the account: not new here either
        if (await syncSeen()) returning = true;
        if (!returning || !pendingNotices().length) return;
        // Not on top of something else (a dialog, the OAuth redirect, a page that failed)
        if (document.querySelector('[aria-modal="true"]')) return;
        showNotice();
    }, 1200);
}

// The changelog is a page of its own (#/whatsnew), with a way back to the page it was opened from
let cameFrom = null;
export function openChangelog() {
    const hash = location.hash || '#/';
    if (hash.startsWith('#/whatsnew')) return;
    const name = document.title.replace(/ · AniRoll$/, '');
    cameFrom = { hash, label: hash === '#/' ? 'Home' : name !== 'AniRoll' ? name : '' };
    location.hash = '/whatsnew';
}

export function renderChangelog({ content }) {
    const back = cameFrom || { hash: '#/', label: 'Home' };
    content.innerHTML = `<div class="page-enter whatsnew-page">
        <a class="glass-btn glass-btn-secondary whatsnew-back" href="${esc(back.hash)}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/></svg>${back.label ? `Back to ${esc(back.label)}` : 'Back'}</a>
        <h1 class="section-title">What's new <span class="whatsnew-release">AniRoll ${RELEASE}</span></h1>
        <div class="box whatsnew">
            ${CHANGES.map((c, i) => `<section class="whatsnew-entry">
                <header class="whatsnew-side"><div class="whatsnew-date">${dateOf(c)}</div><h2 class="whatsnew-title">${esc(c.title)}</h2></header>
                <div class="whatsnew-body">
                    ${c.tabs && CHANGES.findIndex(x => x.tabs) === i ? tabBar() : ''}
                    ${c.video ? videoTeaser(c.video) : ''}
                    <ul class="whatsnew-list">${c.items.map(item => `<li>${itemText(item)}</li>`).join('')}</ul>
                </div>
            </section>`).join('')}
        </div>
    </div>`;
    markSeen();
    wireMedia(content.querySelector('.whatsnew'));
    return () => content.querySelectorAll('.whatsnew-demo').forEach(d => clearTimeout(d._timer));
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

function showNotice() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop whatsnew-backdrop';
    const where = document.getElementById('login-btn')?.hidden === false
        ? 'at the bottom of the home page'
        : 'in the profile menu';
    const pending = pendingNotices();
    const single = pending.length === 1;
    overlay.innerHTML = `<div class="modal-content whatsnew">
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
        </div>`;
    document.body.appendChild(overlay);

    const box = overlay.querySelector('.whatsnew');
    const close = () => {
        release();
        overlay.remove();
        markSeen();
        // The notice points at the real tabs; the changelog page doesn't need to any more
        if (overlay.querySelector('.whatsnew-demo')) pointAtTabs();
    };
    const release = openDialog(box, { label: box.querySelector('.modal-title').textContent, onClose: close, focus: '[data-close]' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);

    wireMedia(box);
}

function wireMedia(box) {
    // "See it in action": the box grows wide and the clip plays where the teaser was
    box.querySelectorAll('.whatsnew-watch').forEach(btn => btn.addEventListener('click', () => {
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

    const demo = box.querySelector('.whatsnew-demo');
    if (demo) {
        demo.querySelector('.whatsnew-replay').addEventListener('click', () => playTabs(demo));
        playTabs(demo);
    }
}

/** @param {string[]} tab [key, label] */
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
