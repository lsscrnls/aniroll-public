// @ts-check
import { esc, titlePref } from './store.js?v=161';

// Discord status: what you do in AniRoll, shown in Discord (Settings → Discord). The page only says what is
// going on; the AniRoll for Discord extension (discord/extension) passes it to a small helper on this
// computer (discord/helper), and that hands it to the Discord app. Off until turned on in Settings.
// Nothing goes to AniRoll's server: page → extension → helper → Discord, all on this computer.
//   startPresence()               once, from js/app.js
//   mountPresenceSettings(box)    the setup in Settings → Discord
const KEY = 'aniroll_discord';
const SITE = 'https://aniroll.app';
const LOGO = `${SITE}/icons/icon-512.png`;
const DL = `${SITE}/downloads/discord`;
// Set once the extension is in the stores; until then it is loaded by hand
const CHROME_STORE = '';
const FIREFOX_ADDON = '';

/** @type {{ media: any, episode: number } | null} */
let playing = null;      // the player's show and episode (aniroll:playing)
/** @type {HTMLVideoElement | null} */
let video = null;
let looking = null;      // the show on screen (aniroll:media-shown)
let party = null;        // the Watch Party you are in (aniroll:party)
/** @type {{ extension?: string, helper?: boolean, discord?: boolean } | null} */
let ext = null;          // the extension's last word
let sent = '';
let timer = 0;

export const presenceOn = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

// Discord wants 2 to 128 characters per line
const line = (s) => {
    const t = String(s || '').trim().slice(0, 128);
    return t.length >= 2 ? t : t ? `${t} ` : '';
};

function showButtons(media) {
    const buttons = [];
    if (party?.link?.startsWith(SITE)) buttons.push({ label: 'Join the Watch Party', url: party.link });
    if (media?.id) buttons.push({ label: 'View on AniRoll', url: `${SITE}/a/${media.id}` });
    return buttons.length ? buttons : undefined;
}

function cover(media) {
    const url = media?.coverImage?.extraLarge || media?.coverImage?.large || '';
    return url.startsWith('https://') && url.length <= 256 ? url : LOGO;
}

/** What Discord shows now, or null for nothing */
function activity() {
    if (!presenceOn()) return null;
    const hash = location.hash;
    const small = { small_image: LOGO, small_text: 'AniRoll' };
    if (playing && hash.startsWith('#/play/')) {
        const { media, episode } = playing;
        const title = titlePref(media.title);
        const total = media.episodes ? ` of ${media.episodes}` : '';
        const running = video && !video.paused && !video.ended && video.duration > 0;
        const now = Date.now();
        return {
            type: 3,
            details: line(title),
            state: line(`Episode ${episode}${total}${party ? ' · Watch Party' : ''}${running ? '' : ' · Paused'}`),
            timestamps: running ? {
                start: Math.round(now - video.currentTime * 1000),
                end: Math.round(now + (video.duration - video.currentTime) * 1000 / (video.playbackRate || 1)),
            } : undefined,
            assets: { large_image: cover(media), large_text: line(title), ...small },
            buttons: showButtons(media),
        };
    }
    if (party) {
        return {
            type: 3,
            details: 'In a Watch Party',
            state: line(party.title) || undefined,
            assets: { large_image: LOGO, large_text: 'AniRoll', ...small },
            buttons: showButtons({ id: party.mediaId }),
        };
    }
    if (hash.startsWith('#/roll')) {
        return {
            type: 3,
            details: 'Rolling for an anime',
            state: looking ? line(`Rolled ${titlePref(looking.title)}`) : undefined,
            assets: { large_image: looking ? cover(looking) : LOGO, large_text: looking ? line(titlePref(looking.title)) : 'AniRoll', ...small },
            buttons: looking ? showButtons(looking) : undefined,
        };
    }
    if (looking) {
        const title = titlePref(looking.title);
        return {
            type: 3,
            details: 'Browsing',
            state: line(title),
            assets: { large_image: cover(looking), large_text: line(title), ...small },
            buttons: showButtons(looking),
        };
    }
    return { type: 3, details: 'Browsing', assets: { large_image: LOGO, large_text: 'AniRoll' } };
}

// A moment later, once: a page change brings several events at once
function update() {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
        const next = activity();
        const json = JSON.stringify(next);
        // The same status again only after the timer could have drifted (seek)
        if (json === sent) return;
        sent = json;
        window.postMessage({ aniroll: 'presence', type: 'activity', activity: next }, location.origin);
    }, 300);
}

let started = false;
export function startPresence() {
    if (started) return;
    started = true;
    document.addEventListener('aniroll:playing', (e) => {
        playing = /** @type {CustomEvent} */ (e).detail;
        update();
    });
    document.addEventListener('aniroll:media-shown', (e) => {
        looking = /** @type {CustomEvent} */ (e).detail?.media || null;
        update();
    });
    document.addEventListener('aniroll:party', (e) => {
        party = /** @type {CustomEvent} */ (e).detail || null;
        update();
    });
    // Media events do not bubble, but they pass the document on the way down
    for (const type of ['play', 'pause', 'seeked', 'ended', 'ratechange', 'loadedmetadata']) {
        document.addEventListener(type, (e) => {
            const t = /** @type {HTMLElement} */ (e.target);
            if (t?.id !== 'player-video') return;
            video = /** @type {HTMLVideoElement} */ (t);
            update();
        }, true);
    }
    window.addEventListener('hashchange', () => {
        if (!location.hash.startsWith('#/play/')) { playing = null; video = null; }
        looking = null;
        update();
    });
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.aniroll !== 'presence-ext' || e.data.type !== 'status') return;
        const first = !ext;
        ext = { extension: e.data.extension, helper: !!e.data.helper, discord: !!e.data.discord };
        // The extension just arrived (or came back): it has not heard anything yet
        if (first) sent = '';
        update();
        document.dispatchEvent(new CustomEvent('aniroll:presence-status'));
    });
    window.postMessage({ aniroll: 'presence', type: 'hello' }, location.origin);
    update();
}

// ===== Settings → Discord =====

function system() {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
    if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
    return 'other';
}

const firefox = () => /Firefox\//.test(navigator.userAgent);

function stepHtml(n, done, title, body) {
    return `<li class="dc-step${done ? ' is-done' : ''}">
        <span class="dc-step-mark" aria-hidden="true">${done ? '✓' : n}</span>
        <div class="dc-step-body"><div class="dc-step-title">${title}${done ? '<span class="dc-sr"> (done)</span>' : ''}</div>${done ? '' : body}</div>
    </li>`;
}

/** @param {HTMLElement} box */
export function mountPresenceSettings(box) {
    startPresence();
    const os = system();
    const installLine = `curl -fsSL ${DL}/install.sh | sh`;

    const extensionBody = () => {
        if (firefox()) {
            return FIREFOX_ADDON
                ? `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${FIREFOX_ADDON}" target="_blank" rel="noopener">Add to Firefox</a>`
                : '<p class="settings-hint">The Firefox version (also for Zen and LibreWolf) is on its way. Until then, a Chromium browser (Chrome, Brave, Edge, Vivaldi) works.</p>';
        }
        return CHROME_STORE
            ? `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${CHROME_STORE}" target="_blank" rel="noopener">Add to your browser</a>`
            : `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${DL}/aniroll-discord-extension.zip" download>Download the extension</a>
               <ol class="settings-hint dc-list">
                   <li>Unzip it into a folder you keep.</li>
                   <li>Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong> (top right).</li>
                   <li><strong>Load unpacked</strong> and pick that folder. Then come back here.</li>
               </ol>`;
    };
    const helperBody = () => {
        if (os === 'windows') {
            return `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${DL}/aniroll-discord-windows.exe" download>Download for Windows</a>
                <p class="settings-hint">Run it once. Windows may warn about an unknown app: <strong>More info</strong> → <strong>Run anyway</strong>.</p>`;
        }
        if (os === 'mac' || os === 'linux') {
            return `<p class="settings-hint">Paste this into a terminal, once:</p>
                <div class="dc-copy"><code>${esc(installLine)}</code><button class="glass-btn glass-btn-secondary glass-btn-sm" type="button" data-dc-copy>Copy</button></div>`;
        }
        return '<p class="settings-hint">The helper runs on Windows, macOS and Linux computers.</p>';
    };

    function paint() {
        const hasExt = !!ext;
        const hasHelper = !!ext?.helper;
        const on = presenceOn();
        box.innerHTML = `
            <ol class="dc-steps">
                ${stepHtml(1, hasExt, 'The AniRoll for Discord extension', extensionBody())}
                ${stepHtml(2, hasHelper, 'The helper on this computer', hasExt ? helperBody() : '<p class="settings-hint">After the extension.</p>')}
                ${stepHtml(3, hasHelper && !!ext?.discord, 'The Discord app, running', hasHelper ? '<p class="settings-hint">Open Discord on this computer (the app, not the website).</p>' : '<p class="settings-hint">After the helper.</p>')}
            </ol>
            <label class="settings-choice"><input type="checkbox" id="dc-toggle" ${on ? 'checked' : ''}>
                <span>Show what I do in AniRoll in my Discord status</span></label>
            <p class="settings-hint">The episode you watch (with the time left), the show you look at, your Watch Party with a button to join it. Stays on this computer: AniRoll's server never sees it.</p>
            ${hasExt ? '' : '<button class="glass-btn glass-btn-secondary glass-btn-sm" type="button" data-dc-check>Check again</button>'}`;
    }

    const hello = () => window.postMessage({ aniroll: 'presence', type: 'hello' }, location.origin);
    box.addEventListener('change', (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        if (input.id !== 'dc-toggle') return;
        try { input.checked ? localStorage.setItem(KEY, 'on') : localStorage.removeItem(KEY); } catch { /* not kept */ }
        update();
    });
    box.addEventListener('click', async (e) => {
        const el = /** @type {HTMLElement} */ (e.target);
        if (el.closest('[data-dc-check]')) hello();
        const copy = el.closest('[data-dc-copy]');
        if (copy) {
            try { await navigator.clipboard.writeText(installLine); copy.textContent = 'Copied'; } catch { /* select by hand */ }
        }
    });
    let shown = JSON.stringify(ext);
    document.addEventListener('aniroll:presence-status', () => {
        if (!box.isConnected || JSON.stringify(ext) === shown) return;
        shown = JSON.stringify(ext);
        paint();
    });
    // Checked again while the steps are open: the helper may just have been installed
    const poll = setInterval(() => (box.isConnected ? hello() : clearInterval(poll)), 3000);
    paint();
    hello();
}
