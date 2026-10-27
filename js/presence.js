// @ts-check
import { esc, titlePref, toast } from './store.js';

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
// The helper's newest version, Linux and macOS (discord/helper/main.go) and Windows (discord/windows/helper.py):
// an older one is pointed out, once per version
const HELPER_LATEST = '1.0.4';
const HELPER_LATEST_WINDOWS = '1.1.2';
const helperLatest = () => (system() === 'windows' ? HELPER_LATEST_WINDOWS : HELPER_LATEST);
const NAG_KEY = 'aniroll_discord_nagged';
// The extension's newest version (discord/extension/manifest.json): an older one is pointed out the same way
const EXTENSION_LATEST = '1.0.2';
const EXT_NAG_KEY = 'aniroll_discord_ext_nagged';
// The Chrome Web Store, offered once it hands out EXTENSION_LATEST (asked via /api/discord/store, the store
// takes a few days to review each version); until then the download, loaded by hand
const CHROME_STORE = 'https://chromewebstore.google.com/detail/hmhmljkgppjpmmoodiboockbboniipcj';
/** @type {Promise<boolean> | null} */
let storeCheck = null;
let storeReady = false;
function checkStore() {
    storeCheck ||= fetch('/api/discord/store', { signal: AbortSignal.timeout(6000) })
        .then(r => (r.ok ? r.json() : null))
        .then(d => (storeReady = !!d?.chrome && !older(String(d.chrome), EXTENSION_LATEST)))
        .catch(() => false);
    return storeCheck;
}
// Firefox, Zen, LibreWolf: signed by Mozilla, installed from here (discord/sign-firefox.sh)
const FIREFOX_ADDON = `${DL}/aniroll-discord-firefox.xpi`;

/** @type {{ media: any, episode: number } | null} */
let playing = null;      // the player's show and episode (aniroll:playing)
/** @type {HTMLVideoElement | null} */
let video = null;
let looking = null;      // the show on screen (aniroll:media-shown)
let party = null;        // the Watch Party you are in (aniroll:party)
let note = null;         // a line from elsewhere in AniRoll (aniroll:activity, detail { details, state } or null)
/** @type {{ extension?: string, helper?: boolean, helperVersion?: string, discord?: boolean } | null} */
let ext = null;          // the extension's last word
let idle = false;        // in the background for a while with nothing playing: no status
let idleTimer = 0;
const IDLE_AFTER = 2 * 60_000;
let sent = '';
let timer = 0;

export const presenceOn = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

// Discord wants 2 to 128 characters per line
const line = (s) => {
    const t = String(s || '').trim().slice(0, 128);
    return t.length >= 2 ? t : t ? `${t} ` : '';
};

// Every status links to AniRoll (Discord shows the buttons to the others, never on your own profile):
// the show when there is one, else the site itself
function showButtons(media) {
    const buttons = [];
    if (party?.link?.startsWith(SITE)) buttons.push({ label: 'Join the Watch Party', url: party.link });
    buttons.push(media?.id ? { label: 'View on AniRoll', url: `${SITE}/a/${media.id}` } : { label: 'Try AniRoll', url: SITE });
    return buttons;
}

function cover(media) {
    const url = media?.coverImage?.extraLarge || media?.coverImage?.large || '';
    return url.startsWith('https://') && url.length <= 256 ? url : LOGO;
}

// The heading over the status and in the member list: "AniRoll: Frieren" (helper 1.0.3)
const heading = (title) => line(`AniRoll: ${title}`);

/** What Discord shows now, or null for nothing */
function activity() {
    if (!presenceOn() || idle) return null;
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
            name: heading(title),
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
    if (note) {
        return {
            type: 3,
            details: line(note.details),
            state: note.state ? line(note.state) : undefined,
            assets: { large_image: LOGO, large_text: 'AniRoll', ...small },
            // The member list shows this line instead of just "AniRoll" (helper 1.0.2)
            status_display_type: 2,
        };
    }
    // Away from the player (a guest, mostly): the show and the episode the party is on, like the host's status
    if (party) {
        const title = party.title || 'Watch Party';
        const total = party.episodes || 0;
        const at = typeof party.progress === 'number' ? party.progress + 1 : 0;
        const episode = at && (!total || at <= total) ? `Episode ${at}${total ? ` of ${total}` : ''} · ` : '';
        const host = party.hosting || !party.host ? '' : ` with ${party.host}`;
        return {
            type: 3,
            name: heading(title),
            details: line(title),
            state: line(`${episode}Watch Party${host}`),
            assets: { large_image: cover({ coverImage: { large: party.cover } }), large_text: line(title), ...small },
            buttons: showButtons({ id: party.mediaId }),
        };
    }
    if (hash.startsWith('#/roll')) {
        return {
            type: 3,
            details: 'Rolling for an anime',
            state: looking ? line(`Rolled ${titlePref(looking.title)}`) : undefined,
            assets: { large_image: looking ? cover(looking) : LOGO, large_text: looking ? line(titlePref(looking.title)) : 'AniRoll', ...small },
            buttons: showButtons(looking),
            // The member list says "Rolling for an anime" instead of just "AniRoll" (helper 1.0.2)
            status_display_type: 2,
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
    return { type: 3, details: 'Browsing', assets: { large_image: LOGO, large_text: 'AniRoll' }, buttons: showButtons(null) };
}

// A tab left in the background with nothing playing goes quiet after IDLE_AFTER; back in front, or
// playing again, it shows up at once. A Watch Party guest stays: the party goes on in another tab or app
function watchIdle() {
    clearTimeout(idleTimer);
    const busy = (video && !video.paused && !video.ended) || (party && !party.hosting);
    if (document.hidden && !busy) {
        idleTimer = window.setTimeout(() => { idle = true; update(); }, IDLE_AFTER);
    } else if (idle) {
        idle = false;
        update();
    }
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
    document.addEventListener('aniroll:activity', (e) => {
        const d = /** @type {CustomEvent} */ (e).detail;
        note = d && typeof d.details === 'string' ? { details: d.details, state: typeof d.state === 'string' ? d.state : '' } : null;
        update();
    });
    document.addEventListener('aniroll:party', (e) => {
        party = /** @type {CustomEvent} */ (e).detail || null;
        watchIdle();
        update();
    });
    // Media events do not bubble, but they pass the document on the way down
    for (const type of ['play', 'pause', 'seeked', 'ended', 'ratechange', 'loadedmetadata']) {
        document.addEventListener(type, (e) => {
            const t = /** @type {HTMLElement} */ (e.target);
            if (t?.id !== 'player-video') return;
            video = /** @type {HTMLVideoElement} */ (t);
            watchIdle();
            update();
        }, true);
    }
    document.addEventListener('visibilitychange', watchIdle);
    window.addEventListener('hashchange', () => {
        if (!location.hash.startsWith('#/play/')) { playing = null; video = null; }
        looking = null;
        update();
    });
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.aniroll !== 'presence-ext' || e.data.type !== 'status') return;
        const first = !ext;
        ext = { extension: e.data.extension, helper: !!e.data.helper, helperVersion: String(e.data.helperVersion || ''), discord: !!e.data.discord };
        nagOutdated();
        // The extension just arrived (or came back): it has not heard anything yet
        if (first) sent = '';
        update();
        document.dispatchEvent(new CustomEvent('aniroll:presence-status'));
    });
    window.postMessage({ aniroll: 'presence', type: 'hello' }, location.origin);
    update();
}

// '1.0.0' < '1.0.1'; an extension too old to say (no version) is never out of date
function older(version, than) {
    if (!version) return false;
    const a = version.split('.').map(Number), b = than.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
    }
    return false;
}
const helperOutdated = () => !!ext?.helper && older(ext.helperVersion || '', helperLatest());
const extensionOutdated = () => !!ext && older(ext.extension || '', EXTENSION_LATEST);

// Once per new version, and only for people who use it: a note with the way to Settings
function nagOutdated() {
    if (!presenceOn()) return;
    const nags = [];
    if (extensionOutdated()) nags.push({ key: EXT_NAG_KEY, version: EXTENSION_LATEST, what: 'the browser extension' });
    if (helperOutdated()) nags.push({ key: NAG_KEY, version: helperLatest(), what: 'its helper' });
    const due = nags.filter(n => { try { return localStorage.getItem(n.key) !== n.version; } catch { return false; } });
    if (!due.length) return;
    try { for (const n of due) localStorage.setItem(n.key, n.version); } catch { return; }
    if (location.hash.startsWith('#/settings')) return;
    toast(`AniRoll for Discord has an update for ${due.map(n => n.what).join(' and ')}`, 'info', {
        action: { label: 'Update', run: () => { location.hash = '#/settings?tab=discord'; } },
    });
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
    // Set up with updating by itself (ticked unless turned off here) or without
    let auto = true;
    const installLine = () => os === 'windows'
        ? `${auto ? "$env:ANIROLL_AUTO_UPDATE='on'; " : ''}irm ${DL}/install.ps1 | iex`
        : `curl -fsSL ${DL}/install.sh | sh${auto ? ' -s -- --auto-update' : ''}`;
    // Turning it on or off later, where the helper lives (install.go homeDir, install.ps1 $dir)
    const autoLine = (state) => os === 'windows'
        ? `& "$env:LOCALAPPDATA\\AniRoll Discord\\aniroll-discord.bat" auto-update ${state}`
        : os === 'mac'
            ? `"$HOME/Library/Application Support/AniRoll Discord/aniroll-discord" auto-update ${state}`
            : `~/.local/share/aniroll-discord/aniroll-discord auto-update ${state}`;
    const uninstallLine = os === 'windows' ? `irm ${DL}/uninstall.ps1 | iex` : `curl -fsSL ${DL}/uninstall.sh | sh`;
    const copyLine = (line) => `<div class="dc-copy"><code>${esc(line)}</code><button class="glass-btn glass-btn-secondary glass-btn-sm" type="button" data-dc-copy="${esc(line)}">Copy</button></div>`;

    const extensionBody = () => {
        if (firefox()) {
            return FIREFOX_ADDON
                ? `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${FIREFOX_ADDON}">Add to Firefox</a>
                   <p class="settings-hint">Firefox asks once whether aniroll.app may install it: <strong>Continue to installation</strong>, then <strong>Add</strong>.</p>`
                : '<p class="settings-hint">The Firefox version (also for Zen and LibreWolf) is on its way. Until then, a Chromium browser (Chrome, Brave, Edge, Vivaldi) works.</p>';
        }
        return storeReady
            ? `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${CHROME_STORE}" target="_blank" rel="noopener">Add from the Chrome Web Store</a>
               <p class="settings-hint">Works in Chrome, Brave, Edge and Vivaldi, and updates by itself.${extensionOutdated()
                   ? ' Then remove the old one you loaded by hand: <code>chrome://extensions</code> → AniRoll for Discord → <strong>Remove</strong>.' : ''}</p>`
            : `<a class="glass-btn glass-btn-primary glass-btn-sm" href="${DL}/aniroll-discord-extension.zip" download>Download the extension</a>
               <ol class="settings-hint dc-list">
                   <li>Unzip it into a folder you keep.</li>
                   <li>Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong> (top right).</li>
                   <li><strong>Load unpacked</strong> and pick that folder. Then come back here.</li>
               </ol>${extensionOutdated() ? '<p class="settings-hint">An update: unzip it over the old folder, then press the reload arrow on AniRoll for Discord in <code>chrome://extensions</code>.</p>' : ''}`;
    };
    const helperBody = () => {
        const autoBox = `<label class="settings-choice"><input type="checkbox" id="dc-auto" ${auto ? 'checked' : ''}>
            <span>Keep the helper up to date by itself</span></label>`;
        if (os === 'windows') {
            return `<p class="settings-hint">Open <strong>PowerShell</strong> (Start menu → type PowerShell), paste this, press Enter, once:</p>${copyLine(installLine())}${autoBox}`;
        }
        if (os === 'mac' || os === 'linux') {
            return `<p class="settings-hint">Paste this into a terminal, once:</p>${copyLine(installLine())}${autoBox}`;
        }
        return '<p class="settings-hint">The helper runs on Windows, macOS and Linux computers.</p>';
    };

    function paint() {
        const hasExt = !!ext;
        const hasHelper = !!ext?.helper;
        const outdated = helperOutdated();
        const on = presenceOn();
        box.innerHTML = `
            <ol class="dc-steps">
                ${stepHtml(1, hasExt && !extensionOutdated(), extensionOutdated() ? `An update for the extension (${esc(ext?.extension || '')} → ${EXTENSION_LATEST})` : 'The AniRoll for Discord extension', extensionBody())}
                ${stepHtml(2, hasHelper && !outdated, outdated ? `An update for the helper (${esc(ext?.helperVersion || '')} → ${helperLatest()})` : 'The helper on this computer',
                    !hasExt ? '<p class="settings-hint">After the extension.</p>'
                        : outdated ? `<p class="settings-hint">Set it up again the same way; it replaces the old one. Reload AniRoll afterwards.</p>${helperBody()}` : helperBody())}
                ${stepHtml(3, hasHelper && !!ext?.discord, 'The Discord app, running', hasHelper ? '<p class="settings-hint">Open Discord on this computer (the app, not the website).</p>' : '<p class="settings-hint">After the helper.</p>')}
            </ol>
            <label class="settings-choice"><input type="checkbox" id="dc-toggle" ${on ? 'checked' : ''}>
                <span>Show what I do in AniRoll in my Discord status</span></label>
            <p class="settings-hint">The episode you watch (with the time left), the show you look at, your Watch Party with a button to join it. Stays on this computer: AniRoll's server never sees it.</p>
            ${hasExt ? '' : '<button class="glass-btn glass-btn-secondary glass-btn-sm" type="button" data-dc-check>Check again</button>'}
            ${os === 'windows' || os === 'mac' || os === 'linux' ? `<details class="dc-remove">
                <summary>Updating the helper by itself</summary>
                <p class="settings-hint">When it is on, the helper looks for a new version each time AniRoll talks to it and puts it in place in the background. Turn it on or off in ${os === 'windows' ? 'PowerShell' : 'a terminal'}:</p>
                ${copyLine(autoLine('on'))}${copyLine(autoLine('off'))}
            </details>` : ''}
            <details class="dc-remove">
                <summary>Remove AniRoll for Discord</summary>
                <ol class="settings-hint dc-list">
                    <li>${os === 'windows'
                        ? `Remove the helper: paste this into PowerShell.${copyLine(uninstallLine)}`
                        : os === 'mac' || os === 'linux'
                            ? `Remove the helper: paste this into a terminal.${copyLine(uninstallLine)}`
                            : 'Remove the helper on the computer you set it up on: Settings → Discord there shows how.'}</li>
                    <li>Remove the extension: right-click its icon in the toolbar → <strong>Remove</strong>, or on the browser's extensions page.</li>
                </ol>
            </details>`;
    }

    const hello = () => window.postMessage({ aniroll: 'presence', type: 'hello' }, location.origin);
    box.addEventListener('change', (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        if (input.id === 'dc-auto') {
            auto = input.checked;
            return paint();
        }
        if (input.id !== 'dc-toggle') return;
        try { input.checked ? localStorage.setItem(KEY, 'on') : localStorage.removeItem(KEY); } catch { /* not kept */ }
        update();
    });
    box.addEventListener('click', async (e) => {
        const el = /** @type {HTMLElement} */ (e.target);
        if (el.closest('[data-dc-check]')) hello();
        const copy = /** @type {HTMLElement | null} */ (el.closest('[data-dc-copy]'));
        if (copy) {
            try { await navigator.clipboard.writeText(copy.dataset.dcCopy || ''); copy.textContent = 'Copied'; } catch { /* select by hand */ }
        }
    });
    let shown = JSON.stringify(ext);
    // Settings opened again draws a new box: this one's listener goes with it
    const onStatus = () => {
        if (!box.isConnected) return document.removeEventListener('aniroll:presence-status', onStatus);
        if (JSON.stringify(ext) === shown) return;
        shown = JSON.stringify(ext);
        paint();
    };
    document.addEventListener('aniroll:presence-status', onStatus);
    // Checked again while the steps are open: the helper may just have been installed
    const poll = setInterval(() => (box.isConnected ? hello() : clearInterval(poll)), 3000);
    paint();
    hello();
    checkStore().then(ready => { if (ready && box.isConnected) paint(); });
}
