// Settings (#/settings): appearance, lists, Watch Party and Jellyfin, in tabs. Loaded when opened, so the
// app shell (js/app.js) stays small and a change here only needs the browser checks of this page.
import * as api from '../api.js?v=142';
import { getState, setState, applyTheme, getTheme, toast, getAccentColor, setAccentColor, getAccentColors, esc } from '../store.js?v=142';
import { getToken, isLoggedIn } from '../auth.js?v=142';
import { showConfirm } from '../a11y.js?v=142';
import { applyDesign, getDesign, switchDesign, getVariant, setVariant, VARIANTS, SEEDS, SHOW_SEED, getShowTheme, getSeed, setSeed } from '../design.js?v=142';
import { refreshJellyfinStatus } from '../status.js?v=142';

const SETTINGS_TABS = [
    { key: 'appearance', label: 'Appearance' },
    { key: 'lists', label: 'Lists' },
    { key: 'party', label: 'Watch Party' },
    { key: 'jellyfin', label: 'Jellyfin' },
];

export async function render({ content, query }) {
    const theme = getTheme();

    const accentColor = getAccentColor();
    const accentColors = getAccentColors();

    const loggedIn = isLoggedIn();
    const design = getDesign();
    const variant = getVariant();
    const titleLang = localStorage.getItem('aniroll_title_lang') || 'romaji';
    const choice = (attr, value, current, label) =>
        `<button class="glass-btn ${value === current ? 'glass-btn-primary' : 'glass-btn-secondary'}" data-${attr}="${value}">${label}</button>`;
    const card = (title, sub, body, extra = '') => `<section class="settings-card"${extra}>
            <h3 class="settings-card-title">${title}</h3>
            ${sub ? `<p class="dot-label settings-card-sub">${sub}</p>` : ''}
            ${body}
        </section>`;

    // Grouped into tabs (last one remembered, ?tab= links straight to one)
    const tab = SETTINGS_TABS.some(t => t.key === query?.tab) ? query.tab
        : SETTINGS_TABS.some(t => t.key === localStorage.getItem('aniroll_settings_tab')) ? localStorage.getItem('aniroll_settings_tab') : 'appearance';

    content.innerHTML = `<div class="page-enter settings-page">
        <h1 class="section-title settings-title">Settings</h1>
        <div class="list-tabs settings-tabs" role="tablist" aria-label="Settings">
            ${SETTINGS_TABS.map(t => `<button class="list-tab${t.key === tab ? ' active' : ''}" role="tab" id="settings-tab-${t.key}" aria-controls="settings-${t.key}" aria-selected="${t.key === tab}" tabindex="${t.key === tab ? 0 : -1}" data-settings-tab="${t.key}">${t.label}</button>`).join('')}
        </div>

        <div class="settings-panel" id="settings-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" ${tab === 'appearance' ? '' : 'hidden'}>
            ${card('Colours', 'Material 3 Expressive, in the colours you pick', `
                <div class="settings-sub-block" id="m3-variant">
                    <div class="settings-sub-label">Palette</div>
                    <p class="settings-hint">“From your show” takes its colours from the show you watched last. Or pick your own.</p>
                    <div class="m3-seeds" role="radiogroup" aria-label="Palette">${SEEDS.map(x => `<button class="m3-seed${x.hex === SHOW_SEED ? ' m3-seed-show' : ''}${x.hex === getSeed() ? ' active' : ''}" role="radio" aria-checked="${x.hex === getSeed()}" data-seed="${x.hex}" style="${x.hex === SHOW_SEED ? `--cover:url('${esc(getShowTheme()?.cover || '')}')` : `--seed:${x.hex}`}" title="${x.name}" aria-label="${x.name}"></button>`).join('')}</div>
                    ${hexField('m3-hex', getSeed() === SHOW_SEED ? '' : getSeed())}
                    <div class="settings-sub-label" style="margin-top:var(--space-md)">Colour style</div>
                    <div class="settings-choices">${VARIANTS.map(v => choice('variant', v.key, variant, v.label)).join('')}</div>
                </div>`, ` id="m3-card"${loggedIn && design === 'aniroll' ? ' hidden' : ''}`)}
            ${card('Theme', '', `<div class="settings-choices">${choice('theme', 'system', theme, 'System')}${choice('theme', 'light', theme, 'Light')}${choice('theme', 'dark', theme, 'Dark')}</div>`)}
            ${card('Accent Color', 'Personalise your interface', `
                <div class="accent-picker">
                    ${accentColors.map(c => `<button class="accent-swatch ${c.hex === accentColor ? 'active' : ''}" data-color="${c.hex}" style="background:${c.hex}" title="${c.name}" aria-label="${c.name}"></button>`).join('')}
                </div>
                ${hexField('accent-hex', accentColor)}`, ` id="accent-card"${design === 'm3' || !loggedIn ? ' hidden' : ''}`)}
            ${loggedIn ? card('Legacy design', 'AniRoll’s first look: monochrome and cinematic, with one accent colour', `
                <label class="settings-choice"><input type="checkbox" id="legacy-design" ${design === 'aniroll' ? 'checked' : ''}>
                    <span>Use the legacy design</span></label>
                <p class="settings-hint">It stays available, but new pages and features are made for Material 3 first.</p>`) : ''}
            ${card('Title Language', 'Choose how anime and manga titles are displayed', `
                <div class="settings-choices">${choice('titlelang', 'romaji', titleLang, 'Romaji')}${choice('titlelang', 'english', titleLang, 'English')}${choice('titlelang', 'native', titleLang, 'Native')}</div>`)}
        </div>

        <div class="settings-panel" id="settings-lists" role="tabpanel" aria-labelledby="settings-tab-lists" ${tab === 'lists' ? '' : 'hidden'}>
            ${card('Friends Status', "Show friends' progress and scores on anime/manga detail pages", `
                <label class="settings-choice"><input type="checkbox" id="toggle-friends-status" ${localStorage.getItem('aniroll_friends_status') !== 'off' ? 'checked' : ''}>
                    <span>Show friends' status in detail view</span></label>`)}
            ${card('MAL Import', 'Import your MyAnimeList export to AniList', `
                <div class="settings-choices">
                    <label class="glass-btn glass-btn-primary glass-btn-sm" style="cursor:pointer">
                        Upload MAL export (.xml / .gz)
                        <input type="file" id="mal-xml-upload" accept=".xml,.gz" hidden>
                    </label>
                    <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noopener" class="settings-link">Get it at myanimelist.net &rarr; Export</a>
                </div>
                <div id="mal-content" style="margin-top:var(--space-md)"></div>`)}
        </div>

        <div class="settings-panel" id="settings-party" role="tabpanel" aria-labelledby="settings-tab-party" ${tab === 'party' ? '' : 'hidden'}>
            ${card('Watch Party', 'How your episode counter follows the host after you join a party', '<div id="party-sync-settings"></div>')}
        </div>

        <div class="settings-panel" id="settings-jellyfin" role="tabpanel" aria-labelledby="settings-tab-jellyfin" ${tab === 'jellyfin' ? '' : 'hidden'}>
            ${card('Jellyfin', 'Plays episodes from your own Jellyfin server and keeps it in step with AniList', '<div id="jf-settings"></div><div id="jf-live"></div>')}
            ${card('Player', 'How episodes play in AniRoll', `
                <label class="settings-choice"><input type="checkbox" id="toggle-autoskip" ${localStorage.getItem('aniroll_autoskip_all') === 'on' ? 'checked' : ''}>
                    <span>Skip intros and recaps automatically</span></label>
                <p class="settings-hint">For every show. In the player (settings button) you can still switch it for one show; that choice wins.</p>`)}
        </div>
    </div>`;

    // Tabs: click, arrow keys
    const tabs = [...content.querySelectorAll('[data-settings-tab]')];
    const showTab = (key, focus = false) => {
        tabs.forEach(b => {
            const on = b.dataset.settingsTab === key;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
            if (on && focus) b.focus();
        });
        content.querySelectorAll('.settings-panel').forEach(p => { p.hidden = p.id !== `settings-${key}`; });
        try { localStorage.setItem('aniroll_settings_tab', key); } catch { /* storage blocked */ }
    };
    tabs.forEach((b, i) => {
        b.addEventListener('click', () => showTab(b.dataset.settingsTab));
        b.addEventListener('keydown', (e) => {
            const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            showTab(tabs[(i + d + tabs.length) % tabs.length].dataset.settingsTab, true);
        });
    });

    content.querySelector('#legacy-design')?.addEventListener('change', async (ev) => {
        const d = ev.target.checked ? 'aniroll' : 'm3';
        content.querySelector('#m3-card').hidden = d !== 'm3';
        content.querySelector('#accent-card').hidden = d === 'm3';
        const r = ev.target.getBoundingClientRect();
        await switchDesign(d, isLoggedIn(), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        toast(d === 'm3' ? 'Material 3 Expressive on' : 'Legacy design on', 'success');
    });

    const markSeed = (hex) => content.querySelectorAll('.m3-seed').forEach(b => {
        b.classList.toggle('active', b.dataset.seed === hex);
        b.setAttribute('aria-checked', String(b.dataset.seed === hex));
    });
    content.querySelectorAll('.m3-seed').forEach(btn => {
        btn.addEventListener('click', async () => {
            markSeed(btn.dataset.seed);
            setHexField(content.querySelector('#m3-hex'), btn.dataset.seed === SHOW_SEED ? '' : btn.dataset.seed);
            await setSeed(btn.dataset.seed, isLoggedIn());
        });
    });
    // Own colour: the scheme is generated per colour, so wait until the picker settles
    let seedTimer = 0;
    bindHexField(content.querySelector('#m3-hex'), (hex) => {
        markSeed(hex);
        clearTimeout(seedTimer);
        seedTimer = setTimeout(() => setSeed(hex, isLoggedIn()), 120);
    });
    bindHexField(content.querySelector('#accent-hex'), (hex) => {
        setAccentColor(hex);
        applyDesign(isLoggedIn());
        content.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b.dataset.color.toLowerCase() === hex));
    });

    content.querySelectorAll('[data-variant]').forEach(btn => {
        btn.addEventListener('click', async () => {
            content.querySelectorAll('[data-variant]').forEach(b => {
                b.className = `glass-btn ${b === btn ? 'glass-btn-primary' : 'glass-btn-secondary'}`;
            });
            await setVariant(btn.dataset.variant, isLoggedIn());
        });
    });

    content.querySelectorAll('[data-theme]').forEach(btn => {
        btn.addEventListener('click', () => {
            const t = btn.dataset.theme;
            applyTheme(t);
            localStorage.setItem('aniroll_theme', t);
            setState({ theme: t });
            content.querySelectorAll('[data-theme]').forEach(b => {
                b.className = `glass-btn ${b.dataset.theme === t ? 'glass-btn-primary' : 'glass-btn-secondary'}`;
            });
            toast('Theme saved', 'success');
        });
    });

    content.querySelectorAll('.accent-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            const hex = btn.dataset.color;
            setAccentColor(hex);
            applyDesign(isLoggedIn());
            setHexField(content.querySelector('#accent-hex'), hex);
            content.querySelectorAll('.accent-swatch').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            toast('Accent color saved', 'success');
        });
    });

    content.querySelectorAll('[data-titlelang]').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.titlelang;
            localStorage.setItem('aniroll_title_lang', lang);
            content.querySelectorAll('[data-titlelang]').forEach(b => {
                b.className = `glass-btn ${b.dataset.titlelang === lang ? 'glass-btn-primary' : 'glass-btn-secondary'}`;
            });
            toast(`Titles set to ${btn.textContent}`, 'success');
        });
    });

    document.getElementById('toggle-friends-status')?.addEventListener('change', (e) => {
        localStorage.setItem('aniroll_friends_status', e.target.checked ? 'on' : 'off');
        toast(e.target.checked ? 'Friends status enabled' : 'Friends status disabled', 'success');
    });

    content.querySelector('#toggle-autoskip')?.addEventListener('change', (e) => {
        try { localStorage.setItem('aniroll_autoskip_all', e.target.checked ? 'on' : 'off'); } catch { /* not kept */ }
        toast(e.target.checked ? 'Intros are skipped automatically' : 'Intros play again', 'success');
    });

    document.getElementById('mal-xml-upload')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        import('./mal-import.js?v=142').then(m => m.startXMLImport(file));
    });

    renderJellyfinSettings();
    renderPartySyncSettings();
    renderJellyfinLive();
}

// ===== Watch Party sync preference =====
async function renderPartySyncSettings() {
    const box = document.getElementById('party-sync-settings');
    if (!box) return;
    if (!isLoggedIn()) {
        box.innerHTML = '<p class="dot-label">Log in to change this.</p>';
        return;
    }
    const bg = await import('../background.js?v=142');
    const mode = bg.getPartySyncMode();
    box.innerHTML = `
        <label class="settings-choice"><input type="radio" name="party-sync" value="open" ${mode === 'open' ? 'checked' : ''}>
            <span>Sync only while AniRoll is open<small>Your counter follows the host while AniRoll is on screen and catches up when you come back.</small></span></label>
        <label class="settings-choice"><input type="radio" name="party-sync" value="background" ${mode === 'background' ? 'checked' : ''}>
            <span>Keep syncing in the background and when closed<small>AniRoll updates your AniList for you until you leave the party.</small></span></label>
        <label class="settings-choice"><input type="checkbox" id="party-sync-ask" ${bg.askOnJoin() ? 'checked' : ''}>
            <span>Ask every time I join a party</span></label>
        <div class="bg-access" id="bg-access"></div>`;

    const paintAccess = async () => {
        const line = box.querySelector('#bg-access');
        if (!line) return;
        let enabled;
        try {
            enabled = await bg.getBackgroundAccess();
        } catch {
            line.innerHTML = '<span class="jf-meta">Background access could not be checked right now</span>';
            return;
        }
        line.innerHTML = enabled
            ? `<span class="jf-meta">AniRoll may update your AniList while it is closed (Watch Party and Jellyfin live tracking).</span>
               <button class="glass-btn glass-btn-secondary glass-btn-sm" id="bg-remove">Remove access</button>`
            : '<span class="jf-meta">AniRoll has no access to your AniList while it is closed.</span>';
        line.querySelector('#bg-remove')?.addEventListener('click', async () => {
            const ok = await showConfirm({
                title: 'Remove background access',
                message: 'AniRoll forgets its access to your AniList. Watch Parties then sync only while AniRoll is open, and Jellyfin episodes are saved the next time you open it.',
                confirmText: 'Remove access',
                danger: true,
            });
            if (!ok) return;
            try {
                await bg.removeBackgroundAccess();
                bg.setPartySyncMode('open');
                toast('Background access removed', 'success');
            } catch (err) {
                toast(err.message, 'error');
            }
            renderPartySyncSettings();
            renderJellyfinLive();
        });
    };

    box.querySelectorAll('input[name="party-sync"]').forEach(radio => radio.addEventListener('change', async () => {
        if (radio.value === 'open') {
            bg.setPartySyncMode('open');
            toast('Watch Parties sync only while AniRoll is open', 'success');
            return;
        }
        try {
            await bg.allowBackgroundAccess();
            bg.setPartySyncMode('background');
            toast('Watch Parties keep syncing when AniRoll is closed', 'success');
        } catch (err) {
            box.querySelector('input[value="open"]').checked = true;
            toast(`Could not turn this on: ${err.message}`, 'error');
        }
        paintAccess();
    }));
    box.querySelector('#party-sync-ask').addEventListener('change', (e) => bg.setAskOnJoin(e.target.checked));
    paintAccess();
}

// ===== Jellyfin live tracking (webhook) =====
async function renderJellyfinLive() {
    const box = document.getElementById('jf-live');
    if (!box) return;
    if (!isLoggedIn()) {
        box.innerHTML = '';
        return;
    }
    const [jf, bg, np] = await Promise.all([
        import('../jellyfin.js?v=142'), import('../background.js?v=142'), import('../nowplaying.js?v=142'),
    ]);
    const head = `<h4 class="jf-live-title">Live tracking</h4>
        <p class="dot-label">See what you are watching right in AniRoll, and finished episodes and movies land on your AniList within seconds, even when AniRoll is closed. Uses the Webhook plugin of your Jellyfin server.</p>`;

    let hook;
    try {
        hook = await jf.loadHook();
    } catch (err) {
        box.innerHTML = `<div class="jf-live">${head}<p class="jf-meta">${esc(err.message)}</p></div>`;
        return;
    }

    if (!hook.enabled) {
        box.innerHTML = `<div class="jf-live">${head}
            <button class="glass-btn glass-btn-primary glass-btn-sm" id="jf-live-setup">Set up live tracking</button>
            <p class="dot-label jf-hint">This allows AniRoll to update your AniList while it is closed. You can remove that access in the Watch Party section at any time.</p>
        </div>`;
        box.querySelector('#jf-live-setup').addEventListener('click', async (ev) => {
            ev.target.disabled = true;
            try {
                await bg.allowBackgroundAccess();
                await jf.createHook();
                jf.startNowPlaying();
                renderJellyfinLive();
                renderPartySyncSettings();
            } catch (err) {
                toast(err.message, 'error');
                ev.target.disabled = false;
            }
        });
        return;
    }

    box.innerHTML = `<div class="jf-live">${head}
        <div class="jf-row"><span class="jf-dot jf-dot-checking" id="jf-live-dot"></span><span id="jf-live-state"></span></div>
        <div class="jf-meta jf-live-now" id="jf-live-now" hidden></div>
        ${hook.background ? '' : `<div class="bg-access"><span class="jf-meta">AniRoll has no access to your AniList while it is closed, so episodes are saved the next time you open it.</span>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-live-allow">Allow</button></div>`}
        <ol class="jf-steps">
            <li>In Jellyfin open <b>Dashboard → Plugins → Catalog</b>, install <b>Webhook</b> and restart the server.</li>
            <li>Open <b>Dashboard → Plugins → Webhook</b> and click <b>Add Generic Destination</b>.</li>
            <li>Paste this as <b>Webhook Url</b>:
                <div class="jf-copy"><input class="glass-input" id="jf-live-url" value="${esc(hook.url)}" readonly><button class="glass-btn glass-btn-secondary glass-btn-sm" data-copy="jf-live-url">Copy</button></div></li>
            <li>Tick the notification types <b>Playback Start</b>, <b>Playback Progress</b> and <b>Playback Stop</b>, the item types <b>Episodes</b> and <b>Movies</b>, and select your user. Leave <b>Send All Properties</b> off.</li>
            <li>Paste this as <b>Template</b>:
                <div class="jf-copy"><textarea id="jf-live-template" readonly rows="4">${esc(hook.template)}</textarea><button class="glass-btn glass-btn-secondary glass-btn-sm" data-copy="jf-live-template">Copy</button></div></li>
            <li>Add a request header <b>Content-Type</b> with the value <b>application/json</b>, save, and play something to test.</li>
        </ol>
        <p class="dot-label jf-hint">The link works like a password for your watch activity: anyone who has it can report episodes to your account. Keep it private and create a new one if it leaks.</p>
        <div class="jf-actions">
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-live-renew">New link</button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-live-off" style="color:var(--danger)">Turn off</button>
        </div>
    </div>`;

    const paint = (state) => {
        const dot = box.querySelector('#jf-live-dot');
        const label = box.querySelector('#jf-live-state');
        const nowLine = box.querySelector('#jf-live-now');
        if (!dot || !label) return;
        const last = state?.lastEventAt || hook.lastEventAt;
        dot.className = `jf-dot ${last ? 'jf-dot-on' : 'jf-dot-checking'}`;
        label.textContent = last
            ? `Receiving events from Jellyfin · last one ${api.timeAgo(Math.floor(last / 1000))}`
            : 'Waiting for the first event from Jellyfin';
        const playing = state?.sessions?.find(s => !s.stopped);
        nowLine.hidden = !playing;
        if (playing) nowLine.textContent = `${playing.paused ? 'Paused' : 'Now watching'}: ${np.nowLabel(playing)} on ${playing.device || 'Jellyfin'}`;
    };
    paint(jf.getNowState());
    const onNow = (e) => {
        if (!document.body.contains(box)) return window.removeEventListener(jf.NOW_EVENT, onNow);
        paint(e.detail);
    };
    window.addEventListener(jf.NOW_EVENT, onNow);

    box.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
        const field = box.querySelector(`#${btn.dataset.copy}`);
        try {
            await navigator.clipboard.writeText(field.value);
            toast('Copied', 'success');
        } catch {
            field.select();
            toast('Press Ctrl+C to copy', 'info');
        }
    }));

    box.querySelector('#jf-live-allow')?.addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try {
            await bg.allowBackgroundAccess();
            toast('AniRoll now saves Jellyfin episodes while it is closed', 'success');
            renderJellyfinLive();
            renderPartySyncSettings();
        } catch (err) {
            toast(err.message, 'error');
            ev.target.disabled = false;
        }
    });

    box.querySelector('#jf-live-renew').addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Create a new link',
            message: 'The current link stops working right away. Paste the new one into the Webhook plugin afterwards.',
            confirmText: 'New link',
        });
        if (!ok) return;
        try {
            await jf.createHook();
            jf.startNowPlaying();
            toast('New link created, update it in Jellyfin', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
        renderJellyfinLive();
    });
    box.querySelector('#jf-live-off').addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Turn off live tracking',
            message: 'The link stops working and AniRoll no longer shows or saves what you watch in Jellyfin. You can remove the destination in the Webhook plugin.',
            confirmText: 'Turn off',
            danger: true,
        });
        if (!ok) return;
        try {
            await jf.removeHook();
            jf.startNowPlaying();
            toast('Live tracking turned off', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
        renderJellyfinLive();
    });
}

// ===== Jellyfin =====
// The series linked to AniList by hand (js/jflinks.js), each with a way to undo it
function linksHtml() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem('aniroll_jf_links') || '{}') || {}; } catch { /* none */ }
    const rows = Object.entries(all).filter(([, v]) => Array.isArray(v));
    if (!rows.length) return '';
    return `<div class="jf-links"><div class="jf-local-label">Linked by hand</div>${rows.map(([key, v]) => {
        const [series, season] = key.split('|');
        return `<div class="jf-link-row"><span>${esc(series)}${Number(season) > 1 ? ` · S${esc(season)}` : ''} → <a href="#/anime/${v[0]}">AniList ${v[0]}</a>${v[1] ? ` · from Jellyfin episode ${v[1] + 1}` : ''}</span>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" data-unlink="${esc(key)}">Remove</button></div>`;
    }).join('')}</div>`;
}

async function renderJellyfinSettings() {
    const box = document.getElementById('jf-settings');
    if (!box) return;
    const jf = await import('../jellyfin.js?v=142');
    await jf.loadAccountConfig();
    const cfg = jf.getConfig();

    if (!cfg) {
        // Most people have a Jellyfin account, not an API key: Quick Connect is the usual way
        const mode = box.dataset.mode === 'key' ? 'key' : 'code';
        box.innerHTML = `
            <div class="jf-form">
                <input type="text" class="glass-input" id="jf-url" placeholder="Server URL, e.g. https://jellyfin.example.com" autocomplete="url">
                ${mode === 'key' ? `
                <input type="password" class="glass-input" id="jf-apikey" placeholder="API key (Jellyfin: Dashboard, API Keys)" autocomplete="off">
                <input type="text" class="glass-input" id="jf-user" placeholder="Jellyfin username" autocomplete="username">` : ''}
                <button class="glass-btn glass-btn-primary" id="jf-connect">${mode === 'key' ? 'Connect' : 'Get a Quick Connect code'}</button>
                <div class="jf-qc" id="jf-qc" hidden></div>
                <button type="button" class="jf-mode" id="jf-mode">${mode === 'key' ? 'Connect with a Quick Connect code instead' : 'Server admin? Use an API key instead'}</button>
            </div>
            <p class="dot-label jf-hint">${mode === 'key'
                ? 'Needs a Jellyfin this browser can reach. A plain http server on your home network cannot be used from the https page.'
                : 'You confirm the code in a Jellyfin app you are signed in to. AniRoll never sees your password.'}</p>`;

        let polling = null;
        const stopPolling = () => { clearTimeout(polling); polling = null; };
        box.querySelector('#jf-mode').addEventListener('click', () => {
            stopPolling();
            box.dataset.mode = mode === 'key' ? 'code' : 'key';
            renderJellyfinSettings();
        });
        // An invite link from a friend (#/settings?tab=jellyfin&server=…), or signing in again after the
        // old sign-in expired: the address is filled in, and the code is asked for right away
        const invited = new URLSearchParams(location.hash.split('?')[1] || '').get('server') || box.dataset.prefill || '';
        if (invited && /^https?:\/\//i.test(invited)) {
            box.querySelector('#jf-url').value = invited;
            delete box.dataset.prefill;
            if (mode === 'code' && !box.dataset.autoAsked) {
                box.dataset.autoAsked = '1';
                setTimeout(() => box.querySelector('#jf-connect')?.click(), 0);
            }
        }
        const connected = (info) => {
            toast(`Connected to ${info.serverName}`, 'success');
            if (info.scope === 'device') toast('Stored in this browser only — could not save it for your account', 'error');
            renderJellyfinSettings();
            refreshJellyfinStatus(true);
        };
        const btn = box.querySelector('#jf-connect');

        btn.addEventListener('click', async () => {
            stopPolling();
            btn.disabled = true;
            btn.textContent = mode === 'key' ? 'Connecting...' : 'Asking Jellyfin...';
            try {
                if (mode === 'key') {
                    connected(await jf.connect(box.querySelector('#jf-url').value, box.querySelector('#jf-apikey').value, box.querySelector('#jf-user').value));
                    return;
                }
                const qc = await jf.startQuickConnect(box.querySelector('#jf-url').value);
                const panel = box.querySelector('#jf-qc');
                panel.hidden = false;
                panel.innerHTML = `
                    <div class="jf-qc-code" aria-label="Quick Connect code">${esc(qc.code)}</div>
                    <p class="jf-qc-how">In a Jellyfin app where you are signed in: your profile, <strong>Quick Connect</strong>, enter this code.</p>
                    <p class="jf-qc-wait" role="status"><span class="jf-dot jf-dot-checking"></span> Waiting for Jellyfin...</p>`;
                btn.disabled = false;
                btn.textContent = 'New code';
                const started = Date.now();
                const poll = async () => {
                    if (!box.isConnected || !panel.isConnected) return stopPolling();
                    try {
                        if (await jf.quickConnectApproved(qc.url, qc.secret)) {
                            stopPolling();
                            connected(await jf.finishQuickConnect(qc.url, qc.secret));
                            return;
                        }
                    } catch (err) {
                        stopPolling();
                        panel.querySelector('.jf-qc-wait').textContent = err.message;
                        return;
                    }
                    // Jellyfin keeps a code for a few minutes; stop asking before that
                    if (Date.now() - started > 5 * 60 * 1000) {
                        panel.querySelector('.jf-qc-wait').textContent = 'The code expired — get a new one';
                        return stopPolling();
                    }
                    polling = setTimeout(poll, 2500);
                };
                polling = setTimeout(poll, 2500);
            } catch (err) {
                toast(err.message, 'error');
                btn.disabled = false;
                btn.textContent = mode === 'key' ? 'Connect' : 'Get a Quick Connect code';
            }
        });
        return;
    }

    const scope = jf.getScope();
    const player = await import('../player/availability.js?v=142');
    const localUrl = player.getLocalUrl();
    box.innerHTML = `
        <div class="jf-row"><span class="jf-dot jf-dot-checking" id="jf-settings-dot"></span><span id="jf-settings-state">Checking...</span></div>
        <div class="jf-meta">${esc(cfg.serverName)} · ${esc(cfg.url)}${cfg.userName ? ` · ${esc(cfg.userName)}` : ''}</div>
        <div class="jf-meta">${scope === 'account'
            ? 'Saved for your AniList account, so it works on all your devices'
            : 'Saved in this browser only — the copy for your account could not be written'}</div>
        <label class="roll-check jf-pull-toggle"><input type="checkbox" id="jf-pull" ${jf.isPullEnabled() ? 'checked' : ''}> Also take watched episodes from Jellyfin into AniList</label>
        <div class="jf-local">
            <label class="jf-local-label" for="jf-local">Local address on this device (optional)</label>
            <div class="jf-local-row">
                <input type="text" class="glass-input" id="jf-local" placeholder="e.g. http://localhost:8096" value="${esc(localUrl)}" autocomplete="off">
                <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-local-save">Save</button>
            </div>
            <p class="dot-label jf-hint">The player tries it first — at home it skips the detour through the internet and plays big files at full quality.</p>
        </div>
        ${linksHtml()}
        <div class="jf-actions">
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-sign-in-again" hidden>Sign in again</button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-invite" title="A link for a friend: it opens AniRoll's Jellyfin settings with this server filled in">Invite a friend</button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-pull-now">Sync from Jellyfin</button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-recheck">Test again</button>
            ${scope === 'device' ? '<button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-to-account">Save to account</button>' : ''}
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="jf-disconnect" style="color:var(--danger)">Disconnect</button>
        </div>`;

    const paint = (status) => {
        const dot = box.querySelector('#jf-settings-dot');
        const label = box.querySelector('#jf-settings-state');
        if (!dot || !label) return;
        dot.className = `jf-dot jf-dot-${status.state === 'connected' ? 'on' : 'off'}`;
        label.textContent = status.state === 'connected'
            ? `Connected${status.version ? ` · Jellyfin ${status.version}` : ''}`
            : `Not connected · ${status.error}`;
        const again = box.querySelector('#jf-sign-in-again');
        if (again) again.hidden = !status.expired;
    };
    box.querySelector('#jf-sign-in-again')?.addEventListener('click', async () => {
        box.dataset.prefill = cfg.url;
        box.dataset.mode = 'code';
        delete box.dataset.autoAsked;
        await jf.clearConfig();
        renderJellyfinSettings();
    });
    box.querySelector('#jf-invite')?.addEventListener('click', async () => {
        const link = `${location.origin}/#/settings?tab=jellyfin&server=${encodeURIComponent(cfg.url)}`;
        try {
            if (navigator.share) await navigator.share({ title: 'Watch with me on AniRoll', url: link });
            else { await navigator.clipboard.writeText(link); toast('Invite link copied: your friend signs in with a Quick Connect code', 'success'); }
        } catch { /* share sheet closed */ }
    });
    box.querySelector('.jf-links')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-unlink]');
        if (!btn) return;
        const { removeLink } = await import('../jflinks.js?v=142');
        removeLink(btn.dataset.unlink);
        btn.closest('.jf-link-row')?.remove();
        toast('Link removed', 'success');
    });
    paint(await jf.getStatus(true));

    box.querySelector('#jf-local-save').addEventListener('click', async (ev) => {
        const btn = ev.target;
        const url = player.setLocalUrl(box.querySelector('#jf-local').value);
        box.querySelector('#jf-local').value = url;
        if (!url) return toast('Local address removed', 'success');
        btn.disabled = true;
        const avail = await player.availability(true);
        btn.disabled = false;
        toast(avail?.local ? 'Local address works — the player uses it on this device' : 'Saved, but it does not answer right now — the player uses the public address', avail?.local ? 'success' : 'error');
    });

    box.querySelector('#jf-recheck').addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        paint(await jf.getStatus(true));
        refreshJellyfinStatus(true);
        ev.target.disabled = false;
    });

    box.querySelector('#jf-pull')?.addEventListener('change', (ev) => {
        jf.setPullEnabled(ev.target.checked);
        toast(ev.target.checked ? 'Jellyfin progress will be pulled in' : 'Pulling from Jellyfin switched off', 'success');
    });

    box.querySelector('#jf-pull-now')?.addEventListener('click', async (ev) => {
        const btn = ev.target;
        btn.disabled = true;
        btn.textContent = 'Checking Jellyfin...';
        try {
            const res = await jf.pullFromJellyfin(getState().user, getToken());
            if (res.skipped === 'rate-limited') toast('AniList is rate limiting right now, try again later', 'error');
            else if (!res.updated) toast('Nothing to pull — AniList is already up to date', 'success');
            else {
                for (const c of res.changes) toast(`${c.title}: episode ${c.from} to ${c.to}`, 'success');
            }
        } catch (err) {
            toast(err.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Sync from Jellyfin';
    });

    box.querySelector('#jf-to-account')?.addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        const ok = await jf.saveToAccount();
        toast(ok ? 'Saved for your AniList account' : 'Could not store it for your account, still this browser only', ok ? 'success' : 'error');
        renderJellyfinSettings();
    });

    box.querySelector('#jf-disconnect').addEventListener('click', async () => {
        const ok = await showConfirm({
            title: 'Disconnect Jellyfin',
            message: cfg.kind === 'user'
                ? 'AniRoll stops marking episodes watched and signs out of Jellyfin.'
                : 'AniRoll stops marking episodes watched, and the API key is removed from this browser.',
            confirmText: 'Disconnect',
            danger: true
        });
        if (!ok) return;
        await jf.clearConfig();
        toast('Jellyfin disconnected', 'success');
        renderJellyfinSettings();
        refreshJellyfinStatus(true);
    });
}

// Connection status in the avatar menu

// ===== Colour by hex code: a swatch that opens the system colour picker, and the code to type =====
function hexField(id, value) {
    const v = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '';
    return `<div class="hex-field">
        <label class="hex-swatch" style="--c:${v || 'transparent'}" title="Pick a colour">
            <input type="color" value="${v || '#6750a4'}" aria-label="Pick a colour">
        </label>
        <input type="text" class="glass-input hex-input" id="${id}" value="${v}" placeholder="#rrggbb" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Colour as hex code">
    </div>`;
}

function setHexField(input, hex) {
    if (!input) return;
    const v = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : '';
    input.value = v;
    input.classList.remove('invalid');
    const field = input.closest('.hex-field');
    field.querySelector('.hex-swatch').style.setProperty('--c', v || 'transparent');
    if (v) field.querySelector('input[type="color"]').value = v;
}

// "a1b", "#A1B2C3", "a1b2c3" all work; calls onPick with "#a1b2c3" once it is a colour
function bindHexField(input, onPick) {
    if (!input) return;
    const field = input.closest('.hex-field');
    const picker = field.querySelector('input[type="color"]');
    const parse = (text) => {
        let t = text.trim().replace(/^#/, '').toLowerCase();
        if (/^[0-9a-f]{3}$/.test(t)) t = t.split('').map(c => c + c).join('');
        return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
    };
    input.addEventListener('input', () => {
        const hex = parse(input.value);
        input.classList.toggle('invalid', !!input.value.trim() && !hex);
        if (!hex) return;
        field.querySelector('.hex-swatch').style.setProperty('--c', hex);
        picker.value = hex;
        onPick(hex);
    });
    input.addEventListener('blur', () => { const hex = parse(input.value); if (hex) input.value = hex; });
    picker.addEventListener('input', () => {
        setHexField(input, picker.value);
        onPick(picker.value.toLowerCase());
    });
}
