// Logged-in browser checks: every page with a (fake) AniList login against the mock in mock.js.
// Catches what the API checks cannot: errors in page code, and the keyboard/click behaviour of v79.
//   cd tools/e2e && npm ci && npx playwright install chromium && node run.js
// CHROMIUM_PATH picks a browser binary (defaults to Playwright's own). Runs in CI as the "browser" job.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { respond, VIEWER } = require('./mock');
const { mockJellyfin, JF_URL, JF_STORAGE } = require('./jellyfin-mock');

const ROOT = path.join(__dirname, '..', '..');
// The release under test and the number of changelog entries, read from the code instead of written here,
// so a release or a new changelog day needs no edit in this file
const APP_VERSION = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').match(/APP_VERSION = '(\d+)'/)[1];
const CHANGE_COUNT = (fs.readFileSync(path.join(ROOT, 'js', 'whatsnew.js'), 'utf8').match(/^\s*id: '\d{4}-/gm) || []).length;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };

let failed = 0;
function check(name, ok, detail) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}`);
}

// Waiting for "done" instead of a fixed time: no request of the page in flight and nothing on it changed
// for a moment (clocks and the player's own bar left out), a video that has its metadata. `max` is the
// longest it may take, the old fixed wait. Not for pages on a fake clock, nor for waits that let the app's
// own timers run (debounces, notices that come after a delay, video time).
const QUIET_MS = 450;
const TRACK = `(() => {
    let inFlight = 0, last = Date.now();
    const fetch0 = window.fetch;
    window.fetch = function (...args) { inFlight++; last = Date.now(); return fetch0.apply(this, args).finally(() => { inFlight--; last = Date.now(); }); };
    const busy = (t) => t && t.nodeType === 1 && t.closest('.pl-bottom, .ar-clock, [data-m3-until]');
    new MutationObserver(list => { if (list.some(m => !busy(m.target.nodeType === 1 ? m.target : m.target.parentElement))) last = Date.now(); })
        .observe(document, { subtree: true, childList: true, characterData: true });
    window.__e2eIdle = (quiet) => {
        const v = document.getElementById('player-video');
        if (v && v.currentSrc && v.readyState < 1 && !document.querySelector('#player-status.error')) return false;
        return inFlight === 0 && Date.now() - last >= quiet;
    };
})();`;
async function idle(page, max = 3000) {
    await page.waitForTimeout(120);
    await page.waitForFunction(q => window.__e2eIdle ? window.__e2eIdle(q) : true, QUIET_MS, { timeout: max, polling: 60 }).catch(() => { /* the old fixed wait */ });
}

function staticServer() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, url === '/' ? 'index.html' : url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
    const server = await staticServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    // Every page gets the tracker idle() reads
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (options) => { const p = await newPage(options); await p.addInitScript(TRACK); return p; };
    // Wide enough for the wider Discover pages to show
    const errors = [];
    const groups = {};

    groups.main = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const mutations = [];
    page.on('pageerror', e => errors.push(`${page.url().split('#')[1] || '/'}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${page.url().split('#')[1] || '/'}: console: ${m.text()}`); });

    await page.route('https://graphql.anilist.co/**', async route => {
        const body = route.request().postDataJSON();
        if (/^\s*mutation/.test(body.query)) mutations.push(body.query.match(/mutation[^{]*\{\s*(\w+)/)?.[1]);
        let answer;
        try { answer = respond(body); } catch (e) { answer = { errors: [{ message: 'mock: ' + e.message }] }; }
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer) });
    });
    // Our own backend: quiet defaults (no maintenance, nothing configured)
    await page.route(`${base}/api/**`, route => {
        const p = new URL(route.request().url()).pathname;
        if (p === '/api/maintenance') return route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' });
        route.fulfill({ status: 404, contentType: 'application/json', body: '{"configured":false,"active":false}' });
    });
    await page.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
    await page.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        // The one-time "things moved" notice is tested on its own below
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);

    const settle = async (ms = 900) => {
        await idle(page, Math.max(ms, 600) * 2);
        // The test browser barely draws frames: finish animations instead of waiting for them
        await page.evaluate(() => {
            window.gsap?.globalTimeline.getChildren(true, true, false).forEach(t => t.progress(1));
            document.getAnimations().forEach(a => { try { a.finish(); } catch { /* infinite */ } });
        });
    };
    const go = async (hash) => {
        // The app allows 20 AniList requests a minute (js/api.js); a person does not open 13 pages in
        // 20 seconds, so the counter starts fresh per page instead of making the run wait for it
        await page.evaluate(h => { localStorage.removeItem('aniroll_req_times'); window.location.hash = h; }, hash);
        await settle();
    };
    const panelOpen = () => page.evaluate(() => document.getElementById('detail-panel-overlay').classList.contains('open'));
    const closePanel = async () => { await page.keyboard.press('Escape'); await settle(300); };

    await page.goto(base + '/#/');
    await settle(1500);
    check('logged in as the test account', await page.evaluate(() => !document.getElementById('login-btn') || document.getElementById('login-btn').hidden));

    // Every page renders without errors
    const pages = ['/', '/list', '/calendar', '/season', '/social', '/notifications', '/roll', '/watchparty',
        '/settings', '/profile', `/user/${VIEWER.name}`, '/anime/21/full', '/search'];
    for (const hash of pages) {
        const before = errors.length;
        await go('#' + hash);
        const text = await page.evaluate(() => document.querySelector('#app, main')?.innerText.trim().length || 0);
        check(`page ${hash} renders without errors`, errors.length === before && text > 20, errors.slice(before).join('\n      ') || `only ${text} characters of text`);
    }

    // Navigation: five tabs, Discover covers Browse, Season and Calendar and remembers the last one
    const navPages = await page.$$eval('.nav-links [data-page]', els => els.map(e => e.dataset.page));
    const tabPages = await page.$$eval('.mobile-tabbar [data-page]', els => els.map(e => e.dataset.page));
    const order = ['home', 'list', 'roll', 'discover', 'social'];
    check('desktop and phone nav: Home, My List, Roll, Discover, Social', JSON.stringify(navPages) === JSON.stringify(order) && JSON.stringify(tabPages) === JSON.stringify(order), { navPages, tabPages });
    for (const sub of ['search', 'season', 'calendar']) {
        await go('#/' + sub);
        const state = await page.evaluate(() => ({
            active: [...document.querySelectorAll('.nav-links .active')].map(e => e.dataset.page),
            switchLinks: [...document.querySelectorAll('.page-switch a')].map(a => a.textContent),
            current: document.querySelector('.page-switch [aria-current]')?.textContent,
        }));
        check(`#/${sub}: Discover active, switch Browse | Season | Calendar`,
            state.active.join() === 'discover' && state.switchLinks.join() === 'Browse,Season,Calendar' && !!state.current, state);
    }
    await go('#/social');
    check('Discover tab returns to the last view (Calendar)', (await page.getAttribute('.nav-links [data-page="discover"]', 'href')) === '#/calendar');

    // Settings: five tabs, ?tab= opens one, the design switch loads Material 3 Expressive and back
    await go('#/settings?tab=jellyfin');
    const settings = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('[data-settings-tab]')].map(b => b.textContent).join(','),
        visible: [...document.querySelectorAll('.settings-panel')].filter(p => !p.hidden).map(p => p.id).join(','),
    }));
    check('settings: tabs Appearance, Lists, Watch Party, Jellyfin, Discord; ?tab= opens one',
        settings.tabs === 'Appearance,Lists,Watch Party,Jellyfin,Discord' && settings.visible === 'settings-jellyfin', settings);
    await page.click('[data-settings-tab="appearance"]');
    await page.waitForTimeout(800);
    const m3 = await page.evaluate(() => ({
        attr: document.documentElement.dataset.design,
        css: !!document.querySelector('link#m3-css'),
        primary: getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim(),
        font: getComputedStyle(document.body).fontFamily,
        variantShown: !document.getElementById('m3-variant').hidden,
    }));
    check('design: Material 3 Expressive is the default (stylesheet, generated palette, Google Sans Flex)',
        m3.attr === 'm3' && m3.css && /^(#[0-9a-f]{6}|rgb\()/.test(m3.primary) && m3.font.includes('Google Sans Flex') && m3.variantShown, m3);
    await page.click('[data-variant="vibrant"]');
    await page.waitForTimeout(800);
    const vibrant = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim());
    check('design: colour style changes the palette', /^(#[0-9a-f]{6}|rgb\()/.test(vibrant) && vibrant !== m3.primary, { tonal: m3.primary, vibrant });
    await page.click('#legacy-design');
    await page.waitForTimeout(300);
    const off = await page.evaluate(() => ({ attr: document.documentElement.dataset.design || null, css: !!document.querySelector('link#m3-css'),
        stored: localStorage.getItem('aniroll_design_v2'), accent: !document.getElementById('accent-card').hidden }));
    check('design: the legacy switch brings back AniRoll’s first design (kept, accent colour offered)', off.attr === null && !off.css && off.stored === 'aniroll' && off.accent, off);
    // Accent by hex code: short codes expand, junk is flagged and not saved
    await page.fill('#accent-hex', 'zz');
    const junk = await page.evaluate(() => ({ invalid: document.getElementById('accent-hex').classList.contains('invalid'), saved: localStorage.getItem('aniroll_accent') }));
    await page.fill('#accent-hex', '0cf');
    const hex = await page.evaluate(() => ({ saved: localStorage.getItem('aniroll_accent'), accent: getComputedStyle(document.documentElement).getPropertyValue('--user-accent').trim() }));
    check('accent: any colour by hex code', junk.invalid && junk.saved !== 'zz' && hex.saved === '#00ccff' && hex.accent === '#00ccff', { junk, hex });
    await page.evaluate(() => { localStorage.removeItem('aniroll_settings_tab'); localStorage.removeItem('aniroll_m3_variant'); });
    // Skipping intros for every show: a switch under Jellyfin → Player
    await page.click('[data-settings-tab="jellyfin"]').catch(() => {});
    await settle(300);
    await page.click('#toggle-autoskip').catch(() => {});
    const autoskipAll = await page.evaluate(() => localStorage.getItem('aniroll_autoskip_all'));
    await page.evaluate(() => { localStorage.removeItem('aniroll_autoskip_all'); localStorage.removeItem('aniroll_settings_tab'); });
    check('settings: skip intros automatically, for every show', autoskipAll === 'on', autoskipAll);

    // My List → Planning offers Roll
    await go('#/list');
    const planningTab = await page.$('#list-tabs .list-tab:nth-child(2)');
    const rollHiddenFirst = await page.$eval('#list-roll', el => el.hidden);
    if (planningTab) {
        await planningTab.click();
        await settle(300);
        const planning = await page.$eval('#list-tabs .list-tab.active', el => el.textContent);
        const rollShown = await page.$eval('#list-roll', el => !el.hidden);
        check('My List: Roll offered on Planning only', rollHiddenFirst && rollShown, { planning, rollHiddenFirst, rollShown });
        await page.click('#list-roll a');
        await settle();
        check('Roll from this list opens Roll', page.url().endsWith('#/roll'));
    }

    // Roll: ticking "Include recommended titles" adds recommendations to the pool, a recommended pick
    // offers Plan to Watch and saves a new entry by mediaId
    await go('#/roll');
    const countBefore = await page.$eval('#roll-count', el => el.textContent);
    await page.evaluate(() => { const c = document.getElementById('roll-recs'); if (c.checked) c.click(); });
    await settle(300);
    const countPlanning = await page.$eval('#roll-count', el => el.textContent);
    await page.click('#roll-recs');
    await settle(1500);
    const countRecs = await page.$eval('#roll-count', el => el.textContent);
    check('Roll: "Include recommended titles" adds recommendations', /\d+ recommended/.test(countRecs) && !/recommended/.test(countPlanning), { countBefore, countPlanning, countRecs });
    // Roll until a recommended pick comes up (tiny pool, so a few tries are enough)
    let recPick = false;
    for (let i = 0; i < 12 && !recPick; i++) {
        await page.evaluate(() => { localStorage.removeItem('aniroll_req_times'); document.getElementById('roll-btn').click(); });
        await page.waitForSelector('#roll-result:not([hidden])', { timeout: 15000 });
        recPick = !!(await page.$('#roll-plan'));
    }
    if (recPick) {
        const before = mutations.length;
        await page.click('#roll-plan');
        await settle(800);
        const planned = await page.$eval('#roll-plan', el => el.textContent);
        check('Roll: recommended pick → Plan to Watch saves an entry', planned.includes('Planned') && mutations.slice(before).includes('SaveMediaListEntry'), { planned, mutations: mutations.slice(before) });
    } else {
        check('Roll: a recommended pick comes up within 12 rolls', false, countRecs);
    }
    // A round of rolls hands out every show once before any comes again (a shuffle bag, remembered in
    // aniroll_roll_seen): four rolls from a fresh start, four different shows
    await page.evaluate(() => localStorage.removeItem('aniroll_roll_seen'));
    const winners = [];
    for (let i = 0; i < 4; i++) {
        await page.evaluate(() => { localStorage.removeItem('aniroll_req_times'); document.getElementById('roll-btn').click(); });
        await page.waitForSelector('#roll-result:not([hidden])', { timeout: 15000 });
        winners.push(await page.evaluate(() => JSON.parse(localStorage.getItem('aniroll_roll_seen') || '[]').at(-1)));
    }
    check('Roll: no show comes up twice until the others had their turn', new Set(winners).size === winners.length && winners.every(Boolean), winners);
    await page.evaluate(() => localStorage.removeItem('aniroll_roll_filters'));

    // My List: −/+ changes progress and must not open the detail panel; the card itself does
    await go('#/list');
    const inc = await page.$('.list-card [data-action="inc"], .list-entry [data-action="inc"]');
    check('My List has +/- buttons', !!inc);
    if (inc) {
        const saves = mutations.length;
        await inc.click();
        await settle(1200);
        check('+ saves progress', mutations.slice(saves).includes('SaveMediaListEntry'), mutations.slice(saves).join(', ') || 'no mutation');
        check('+ does not open the detail panel', !(await panelOpen()));
        await closePanel();

        // Offline (no answer at all): the change is kept, not lost, and goes out once back online
        const offline = (route) => (route.request().postDataJSON()?.query || '').includes('SaveMediaListEntry') ? route.abort('internetdisconnected') : route.fallback();
        await page.route('https://graphql.anilist.co/**', offline);
        await page.$eval('.list-card [data-action="inc"], .list-entry [data-action="inc"]', b => b.click());
        await settle(1200);
        const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('aniroll_pending_saves') || '[]').length);
        await page.unroute('https://graphql.anilist.co/**', offline);
        const before = mutations.length;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        // The app sends after a short pause of its own
        await page.waitForFunction(() => !JSON.parse(localStorage.getItem('aniroll_pending_saves') || '[]').length, null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(300);
        const sent = mutations.slice(before).includes('SaveMediaListEntry');
        const left = await page.evaluate(() => JSON.parse(localStorage.getItem('aniroll_pending_saves') || '[]').length);
        check('offline: a + is kept and sent once back online', kept >= 1 && sent && left === 0, { kept, sent, left });
    }
    // A card with −/+1 in it is not a button itself: its title is
    const card = await page.$('.list-card [role="button"][data-open], .list-card[role="button"][data-open], .list-entry-title[data-open]');
    if (card) {
        await card.focus();
        await page.keyboard.press('Enter');
        await settle(800);
        check('My List entry opens with Enter', await panelOpen());
        await closePanel();
    }

    // Calendar and notifications: keyboard opens the panel
    for (const [hash, selector] of [['#/calendar', '.calendar-week-item[data-open], .calendar-entry[data-open], .calendar-entry-img[data-open], .schedule-item[data-open]'],
        ['#/notifications', '.notif-item[data-open]']]) {
        await go(hash);
        const el = await page.$(selector);
        check(`${hash}: has entries that open the panel`, !!el);
        if (!el) continue;
        await el.focus();
        await page.keyboard.press('Enter');
        await settle(800);
        check(`${hash}: Enter opens the panel`, await panelOpen());
        await closePanel();
    }

    // Calendar: week by default, switch to month and back, remembered
    await page.evaluate(() => localStorage.removeItem('aniroll_cal_view'));
    await go('#/calendar');
    const week = await page.evaluate(() => ({ columns: document.querySelectorAll('.calendar-week-day').length, today: !!document.querySelector('.calendar-week-day.today'), label: document.getElementById('cal-month').textContent }));
    check('calendar: week view by default, 7 days, today marked', week.columns === 7 && week.today && /–/.test(week.label), week);
    const room = await page.evaluate(() => {
        const heights = [...document.querySelectorAll('.calendar-week-day')].map(d => Math.round(d.getBoundingClientRect().height));
        const controls = document.querySelector('.calendar-controls').getBoundingClientRect();
        const week = document.querySelector('.calendar-week').getBoundingClientRect();
        return { width: Math.round(week.width), home: 1200, aligned: Math.abs(controls.left - week.left) < 1 && Math.abs(controls.right - week.right) < 1, heights: [...new Set(heights)] };
    });
    check('calendar week: wider than other pages, lined up with its controls, days equally tall', room.width > room.home && room.aligned && room.heights.length === 1, room);
    await page.click('[data-view="month"]');
    await settle();
    const month = await page.evaluate(() => ({ grid: !!document.querySelector('.calendar-grid'), label: document.getElementById('cal-month').textContent, stored: localStorage.getItem('aniroll_cal_view') }));
    check('calendar: Month shows the grid and is remembered', month.grid && !/–/.test(month.label) && month.stored === 'month', month);
    await page.click('#cal-next');
    await settle();
    check('calendar: Today button after moving away', await page.$eval('#cal-today', b => !b.hidden));
    await page.click('#cal-today');
    await settle();
    await page.click('[data-view="week"]');
    await settle();
    check('calendar: back to the week with today', await page.evaluate(() => !!document.querySelector('.calendar-week-day.today')));
    // A week across two months: dates run on, the label names both months
    await page.evaluate(() => sessionStorage.setItem('aniroll_cal_anchor', String(new Date(2026, 8, 28).getTime())));
    await go('#/season');
    await go('#/calendar');
    const across = await page.evaluate(() => ({
        label: document.getElementById('cal-month').textContent,
        days: [...document.querySelectorAll('.calendar-week-head strong')].map(e => e.textContent).join(','),
    }));
    check('calendar: week across months (28 Sep – 4 Oct)', across.days === '28,29,30,1,2,3,4' && /Sep.* – 4 Oct 2026/.test(across.label), across);
    await page.evaluate(() => sessionStorage.removeItem('aniroll_cal_anchor'));

    // Social: markdown renders, replies open, "Reply" mentions the author
    await go('#/social');
    check('social: list markup in a post', !!(await page.$('.activity-text .activity-list li')));
    const toggle = await page.$('.reply-toggle');
    if (toggle) {
        await toggle.click();
        await settle(1000);
        const replyTo = await page.$('.activity-reply-to');
        check('social: replies show a Reply button', !!replyTo);
        if (replyTo) {
            const name = await replyTo.getAttribute('data-name');
            await replyTo.click();
            const value = await page.$eval('.activity-reply-form input', i => i.value);
            check('social: Reply puts @name into the field', value.startsWith(`@${name} `), value);
        }
    } else {
        check('social: posts have a reply toggle', false);
    }

    // One browser, two accounts: cached answers and queued saves never cross over (js/api.js)
    const isolation = await page.evaluate(async () => {
        const api = await import(document.querySelector('script[type="module"]').src.replace('app.js', 'api.js'));
        const me = localStorage.getItem('aniroll_user');
        const as = (id) => localStorage.setItem('aniroll_user', JSON.stringify({ ...JSON.parse(me), id }));
        const q = 'query { Page(perPage: 1) { media(search: "isolation") { id mediaListEntry { status } } } }';
        localStorage.removeItem('aniroll_req_times');
        as(111); const a = await api.cachedQuery(q, {}, 'e2e-token', 60000);
        as(222); const b = await api.cachedQuery(q, {}, 'e2e-token', 60000);
        as(111); const a2 = await api.cachedQuery(q, {}, 'e2e-token', 60000);
        localStorage.setItem('aniroll_pending_saves', JSON.stringify([
            { key: 'x1', user: 111, vars: { mediaId: 1, progress: 1 }, ts: 1 },
            { key: 'x2', vars: { mediaId: 2, progress: 1 }, ts: 1 },  // from before accounts: would add a show, dropped
            { key: 'x3', vars: { id: 3, progress: 1 }, ts: 1 },       // from before accounts: an entry id, only its owner can save
        ]));
        as(222); const countB = api.pendingSaveCount();
        as(111); const countA = api.pendingSaveCount();
        localStorage.removeItem('aniroll_pending_saves');
        localStorage.setItem('aniroll_user', me);
        return { separate: a !== b, reused: a === a2, countA, countB };
    });
    check('without the "reduce motion" setting smooth scrolling stays on', await page.evaluate(() => document.documentElement.classList.contains('lenis')));
    check("accounts: another account never gets this one's cached answers or queued saves",
        isolation.separate && isolation.reused && isolation.countA === 2 && isolation.countB === 1, isolation);

    // ===== v134 =====
    // My List: an "All" tab, filters, the score as a button, and a change in the detail panel shows at once
    await go('#/list');
    const listUi = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('#list-tabs .list-tab')].map(t => t.textContent.trim().split(' ')[0]),
        behind: !!document.getElementById('list-behind'), genre: !!document.querySelector('#list-toolbar .glass-menu'),
        exportBtn: !!document.getElementById('list-export'), current: document.querySelector('#list-tabs [aria-pressed="true"]')?.textContent || '',
    }));
    check('My List: status lists first, an All tab last, Behind and genre filters, export', listUi.tabs.at(-1) === 'All' && listUi.behind && listUi.genre && listUi.exportBtn && !!listUi.current, listUi);
    await page.click('#list-tabs .list-tab:last-child');
    await settle(300);
    const firstCard = await page.$eval('#list-content [data-media-id]', el => Number(el.dataset.mediaId)).catch(() => null);
    if (firstCard) {
        await page.evaluate((id) => window.dispatchEvent(new CustomEvent('aniroll:list-changed', { detail: { mediaId: id, removed: true } })), firstCard);
        await settle(300);
        const gone = await page.evaluate((id) => !document.querySelector(`#list-content [data-media-id="${id}"]`), firstCard);
        check('My List: an entry removed elsewhere leaves the list at once', gone);
    }

    // Search: your own shows from the first letter, without asking AniList
    await page.evaluate(() => document.getElementById('search-btn').click());
    await settle(300);
    const reqBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('graphql')).length);
    await page.fill('#search-input', 'Sh');
    await page.waitForTimeout(400);
    const own = await page.evaluate(() => ({ group: document.querySelector('.search-group-title')?.textContent, rows: document.querySelectorAll('#search-results .search-result-item').length,
        status: !!document.querySelector('.search-result-status') }));
    const reqAfter = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('graphql')).length);
    check('search: your own shows at once, with their status, no request', own.group === 'On your list' && own.rows > 0 && own.status && reqAfter === reqBefore, { ...own, reqBefore, reqAfter });
    await page.keyboard.press('Escape');
    await settle(300);

    // Season: format chips and "Not on my list"; a page heading names the tab and takes focus
    await go('#/season');
    const season = await page.evaluate(() => ({ chips: document.querySelectorAll('#season-formats [data-format]:not([hidden])').length,
        notListed: !document.getElementById('season-not-listed').hidden, title: document.title, focus: document.activeElement?.tagName }));
    check('season: format chips and Not on my list; the tab says which page', season.chips >= 1 && season.notListed && /Season · AniRoll/.test(season.title), season);

    // Calendar: the week as a calendar file
    await go('#/calendar');
    const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('#cal-ics').catch(() => {});
    const file = await download;
    let ics = '';
    if (file) { const pathOnDisk = await file.path(); ics = pathOnDisk ? fs.readFileSync(pathOnDisk, 'utf8') : ''; }
    check('calendar: Add to my calendar downloads the episodes as an .ics file', /BEGIN:VCALENDAR/.test(ics) && /BEGIN:VEVENT/.test(ics) && /#\/anime\/\d+/.test(ics), ics.slice(0, 200));

    // Profile: where your scores and AniList's differ most
    // The test account carries no statistics: give the cached one some, as AniList's Viewer would
    await page.evaluate((v) => import(`/js/store.js?v=${v}`).then(st => st.setState({ user: { ...st.getState().user, statistics: { anime: {
        count: 40, minutesWatched: 30000, episodesWatched: 500, meanScore: 78,
        genres: [{ genre: 'Action', count: 20, meanScore: 80 }, { genre: 'Drama', count: 10, meanScore: 70 }],
        tags: [{ tag: { name: 'Isekai' }, count: 8, meanScore: 72 }],
        scores: [{ score: 80, count: 10 }], formats: [{ format: 'TV', count: 30 }],
        releaseYears: [{ releaseYear: 2024, count: 9 }, { releaseYear: 2025, count: 12 }], startYears: [{ startYear: 2025, count: 20 }], studios: [],
    } } } })), APP_VERSION);
    await go('#/profile');
    await settle(600);
    const takes = await page.evaluate(() => ({ title: [...document.querySelectorAll('#hot-takes .section-title')].map(h => h.textContent).join(), rows: document.querySelectorAll('.hot-take').length,
        charts: [...document.querySelectorAll('.stat-chart-title')].map(t => t.textContent) }));
    check('profile: tags, averages per genre and the release years are shown', takes.charts.includes('Top tags') && takes.charts.includes('Your era (release year)'), takes);

    // Login: the page you were on comes back after AniList's login
    const back = await page.evaluate(async (v) => {
        const auth = await import(`/js/auth.js?v=${v}`);
        const keep = localStorage.getItem('aniroll_token');
        history.replaceState(null, '', '#/watchparty?host=Friend');
        auth.rememberReturn();
        history.replaceState(null, '', '#access_token=new-token&token_type=Bearer');
        const ok = auth.handleOAuthCallback();
        const hash = location.hash;
        localStorage.setItem('aniroll_token', keep);
        history.replaceState(null, '', '#/');
        return { ok, hash };
    }, APP_VERSION);
    check('login: back on the page where Log in was pressed (a party invite)', back.ok && back.hash === '#/watchparty?host=Friend', back);

    // Toasts are read out; the skip link is the first stop
    await go('#/list');
    const a11y = await page.evaluate(() => ({ live: document.getElementById('toast-container').getAttribute('aria-live'),
        skip: document.querySelector('a.skip-link')?.getAttribute('href'), current: document.querySelector('.nav-links [aria-current="page"]')?.dataset.page,
        title: document.title }));
    check('a11y: toasts in a live region, a skip link, the current page marked in the nav and the tab title',
        a11y.live === 'polite' && a11y.skip === '#content' && a11y.current === 'list' && /My List · AniRoll/.test(a11y.title), a11y);

    await page.close();
    };

    groups.party = async () => {
    // Watch Party as a guest: the invite link shows the host's party, joining starts the sync; then the
    // host's own view. Runs against the obfuscated build too (scripts/deploy.sh), where joining once broke
    const wp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    wp.on('pageerror', e => errors.push(`watch party: ${e.message}`));
    const party = { hostName: 'Hosty', mediaId: 21, mediaTitle: 'One Piece', active: true, members: [], hostProgress: 3, hostProgressAt: Date.now(), startedAt: Date.now(), startEp: 2 };
    await wp.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
    await wp.route(`${base}/api/**`, route => {
        const p = new URL(route.request().url()).pathname;
        // The live stream: one event per connection, the browser comes back for the next after `retry`
        if (p.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: `retry: 1000\ndata: ${JSON.stringify(party)}\n\n` });
        if (p.startsWith('/api/party/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(party) });
        route.fulfill({ status: p === '/api/maintenance' ? 200 : 404, contentType: 'application/json', body: '{"maintenance":false}' });
    });
    await wp.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
    await wp.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);
    const wpText = () => wp.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
    await wp.goto(base + '/#/watchparty?host=Hosty&anime=21');
    await idle(wp, 3000);
    const invited = await wpText();
    // Clicked only when there: a broken page must fail this check, not stop the whole run
    const joinBtn = wp.locator('button:has-text("Join Watch Party")');
    if (await joinBtn.count()) {
        await joinBtn.first().click();
        await wp.waitForTimeout(1000);
        if (await wp.locator('#wp-bg-open').count()) await wp.click('#wp-bg-open');
        await wp.waitForTimeout(2500);
    }
    const joined = await wpText();
    check('watch party: an invite shows the host, joining starts the sync',
        /Host progress/.test(invited) && /Auto-sync active/.test(joined) && !/is not a function/.test(invited + joined), { invited: invited.slice(0, 160), joined: joined.slice(0, 160) });
    // The host moves on: the live stream brings it in seconds (the regular sync would take 20)
    party.hostProgress = 7;
    const pushed = await wp.waitForFunction(() => document.getElementById('wp-host-ep')?.textContent === '7', null, { timeout: 5000 })
        .then(() => true, () => false);
    check('watch party: the host\'s next episode arrives live, not with the next poll', pushed,
        await wp.evaluate(() => document.getElementById('wp-host-ep')?.textContent));
    Object.assign(party, { hostName: VIEWER.name, hostKey: 'k' });
    await wp.evaluate(n => {
        localStorage.setItem('aniroll_watchparty', JSON.stringify({ hostName: n, mediaId: 21, hostKey: 'k', mediaTitle: 'One Piece', startEp: 2 }));
        location.hash = `/watchparty?host=${n}&anime=21`;
    }, VIEWER.name);
    await idle(wp, 3000);
    const hosting = await wpText();
    check("watch party: the host's view with its episode counter", /You are the host/.test(hosting) && /EPISODE COUNTER/i.test(hosting), hosting.slice(0, 160));
    await wp.close();

    };

    groups.discover = async () => {
    // What came from comparing notes with a friend's app: shows from Planning that start soon (Home), format
    // chips (My List), studios as cards with a page of their own and related shows as covers (detail)
    const nx = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    nx.on('pageerror', e => errors.push(`new pieces: ${e.message}`));
    await nx.route('https://graphql.anilist.co/**', route => {
        const answer = respond(route.request().postDataJSON());
        // The mock has every show airing and every show on TV: one planned show premieres in 8 days, one is a movie
        for (const list of answer.data?.MediaListCollection?.lists || []) {
            if (list.status === 'PLANNING' && list.entries[0]) {
                Object.assign(list.entries[0].media, { status: 'NOT_YET_RELEASED', nextAiringEpisode: { episode: 1, airingAt: Math.floor(Date.now() / 1000) + 8 * 86400, timeUntilAiring: 8 * 86400 } });
            }
            if (list.status === 'CURRENT' && list.entries[1]) list.entries[1].media.format = 'MOVIE';
        }
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer) });
    });
    await nx.route(`${base}/api/**`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"maintenance":false}' }));
    await nx.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
    await nx.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);
    const nxGo = async (hash) => { await nx.evaluate(h => { localStorage.removeItem('aniroll_req_times'); location.hash = h; }, hash); await idle(nx, 2500); };
    await nx.goto(base + '/#/');
    await idle(nx, 3000);
    const soon = await nx.evaluate(() => ({ shown: !document.getElementById('starting-soon')?.hidden,
        text: document.querySelector('#starting-soon-row .starting-soon-when')?.textContent.replace(/\s+/g, ' ').trim() }));
    check('home: a planned show that premieres soon, with its date', soon.shown && /^Episode 1 in 8d/.test(soon.text || ''), soon);
    // The countdown widget (Material 3): the cover, the ring, when it airs; the last hour counts seconds
    const clock = await nx.evaluate(() => {
        const w = document.querySelector('.m3-widget-clock');
        return w && { cover: !!w.querySelector('.m3-clock-cover'), ring: w.querySelector('.m3-clock-ring-fill')?.style.strokeDashoffset,
            when: w.querySelector('.m3-clock-when')?.textContent, chip: !!w.querySelector('.m3-clock-chip'), num: w.querySelector('.m3-widget-clock-num')?.textContent };
    });
    check('home: the countdown widget shows the cover, a ring and when it airs', !clock || (clock.cover && clock.ring && /, \d/.test(clock.when || '') && /\d/.test(clock.num || '')), clock);

    // Nothing being watched airs any more: the countdown on Home turns to the next premiere from Planning
    const quiet = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    quiet.on('pageerror', e => errors.push(`premiere countdown: ${e.message}`));
    await quiet.route('https://graphql.anilist.co/**', route => {
        const answer = respond(route.request().postDataJSON());
        for (const list of answer.data?.MediaListCollection?.lists || []) {
            if (list.status === 'PLANNING' && list.entries[0]) {
                Object.assign(list.entries[0].media, { status: 'NOT_YET_RELEASED', nextAiringEpisode: { episode: 1, airingAt: Math.floor(Date.now() / 1000) + 3 * 86400, timeUntilAiring: 3 * 86400 } });
            }
            if (list.status === 'CURRENT') for (const e of list.entries) Object.assign(e.media, { status: 'FINISHED', nextAiringEpisode: null });
        }
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer) });
    });
    await quiet.route(`${base}/api/**`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"maintenance":false}' }));
    await quiet.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
    await quiet.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);
    await quiet.goto(base + '/#/');
    await idle(quiet, 3500);
    const premiereClock = await quiet.evaluate(() => {
        const w = document.querySelector('.m3-widget-clock');
        return { label: w?.querySelector('.m3-widget-label')?.textContent, num: w?.querySelector('.m3-widget-clock-num')?.textContent.replace(/\s+/g, ''),
            sub: w?.querySelector('.m3-widget-sub')?.textContent };
    });
    check('home: nothing airing, the countdown shows the next premiere from Planning',
        /^Starts in( Premiere)?$/.test(premiereClock.label || '') && /^[23]d\d\dh$/.test(premiereClock.num || '') && /· Ep 1$/.test(premiereClock.sub || ''), premiereClock);
    await quiet.close();

    await nxGo('#/list');
    const chips = await nx.evaluate(() => Object.fromEntries([...document.querySelectorAll('#list-formats [data-format]')].map(b => [b.dataset.format, !b.hidden])));
    const count = () => nx.evaluate(() => document.querySelectorAll('#list-content [data-media-id]').length);
    const all = await count();
    await nx.click('#list-formats [data-format="MOVIE"]');
    const movies = await count();
    await nx.click('#list-formats [data-format="MOVIE"]');
    const again = await count();
    check('my list: format chips only for formats on the list; one filters, clicked again shows all',
        chips.TV && chips.MOVIE && !chips.OVA && movies === 1 && all > 1 && again === all, { chips, all, movies, again });

    await nxGo('#/anime/101/full');
    const detail = await nx.evaluate(() => ({ studios: [...document.querySelectorAll('.detail-studio')].map(a => a.getAttribute('href')),
        related: document.querySelectorAll('.detail-related-item[data-open]').length }));
    check('detail: studios as cards that open their page, related shows as covers',
        detail.studios.length > 0 && detail.studios.every(h => /^#\/studio\/\d+$/.test(h)) && detail.related > 0, detail);
    await nx.click('.detail-studio');
    await idle(nx, 2500);
    const studio = await nx.evaluate(() => ({ hash: location.hash, title: document.getElementById('studio-title')?.textContent.trim(),
        cards: document.querySelectorAll('#studio-grid .media-card').length, discover: document.querySelector('.nav-links [data-page="discover"]')?.classList.contains('active') }));
    // From the side panel: the studio page opens and the panel goes
    await nx.evaluate(() => window.__openDetailPanel(101));
    await idle(nx, 2500);
    await nx.click('#detail-panel-overlay .detail-studio');
    await idle(nx, 2000);
    const fromPanel = await nx.evaluate(() => ({ hash: location.hash, panelOpen: document.getElementById('detail-panel-overlay').classList.contains('open') }));
    check('detail panel: a studio card opens the studio page and closes the panel', /^#\/studio\//.test(fromPanel.hash) && !fromPanel.panelOpen, fromPanel);
    check('studio page: its name and its anime, under Discover', /^#\/studio\/\d+$/.test(studio.hash) && !!studio.title && studio.cards > 0 && studio.discover, studio);
    await nx.close();

    };

    groups.player = async () => {
    // Jellyfin player. A page logged in to AniList and to Jellyfin (a friend's sign-in, not an API key)
    async function playerPage(jellyfinUp, signedIn = true, jfMock = {}) {
        const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const pageErrors = [];
        p.on('pageerror', e => pageErrors.push(e.message));
        p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) pageErrors.push(m.text()); });
        const saves = [];
        await p.route('https://graphql.anilist.co/**', route => {
            const body = route.request().postDataJSON();
            if (/^\s*mutation/.test(body.query) && /SaveMediaListEntry/.test(body.query)) saves.push(body.variables);
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(body)) });
        });
        await p.route(`${base}/api/**`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"maintenance":false,"configured":false}' }));
        await p.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
        // The stack switched off: every request to Jellyfin fails the way a dead host does
        const calls = jellyfinUp ? await mockJellyfin(p, jfMock) : [];
        if (!jellyfinUp) await p.route(`${JF_URL}/**`, route => route.abort('connectionrefused'));
        await p.addInitScript(({ id, name, jf }) => {
            localStorage.setItem('aniroll_token', 'e2e-token');
            localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
            localStorage.setItem('aniroll_user_ts', String(Date.now()));
            localStorage.setItem('aniroll_seen_changes', '9999');
            for (const [k, v] of Object.entries(jf)) localStorage.setItem(k, v);
        }, { ...VIEWER, jf: signedIn ? JF_STORAGE : {} });
        return { p, pageErrors, saves, calls };
    }

    // Watch Party: "Play episode N" right on the party page — the one after the host's counter
    {
        const { p, pageErrors } = await playerPage(true);
        const party = { hostName: 'Hosty', mediaId: 101, mediaTitle: 'Show', active: true, members: [], hostProgress: 1, startedAt: Date.now(), startEp: 0 };
        await p.route(`${base}/api/party/**`, route => route.request().url().endsWith('/events')
            ? route.fulfill({ contentType: 'text/event-stream', body: `retry: 1000\ndata: ${JSON.stringify(party)}\n\n` })
            : route.fulfill({ contentType: 'application/json', body: JSON.stringify(party) }));
        await p.goto(base + '/#/watchparty?host=Hosty&anime=101');
        await p.waitForSelector('.wp-play', { timeout: 8000 }).catch(() => {});
        const play = await p.evaluate(() => {
            const a = document.querySelector('.wp-play');
            return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), episodes: !!document.querySelector('.wp-episodes') } : null;
        });
        check('watch party: Play the episode the group watches next, straight from the party', /^#\/play\/\d+\/2$/.test(play?.href || '')
            && /Play episode 2/.test(play.text) && play.episodes && !pageErrors.length, { play, pageErrors });
        await p.close();
    }

    // Discord status: Settings shows the three steps (a stand-in for the extension answers here), and once it
    // is on, the player's episode goes out with its time left, paused without it, and a link to the show
    {
        const { p, pageErrors } = await playerPage(true);
        await p.addInitScript(() => {
            window.__activities = [];
            window.addEventListener('message', (e) => {
                const m = e.data;
                if (m?.aniroll !== 'presence') return;
                if (m.type === 'activity') window.__activities.push(m.activity);
                window.postMessage({ aniroll: 'presence-ext', type: 'status', extension: '1.0.0', helper: true, discord: true }, location.origin);
            });
        });
        await p.goto(base + '/#/settings?tab=discord');
        await p.waitForSelector('.dc-step.is-done', { timeout: 5000 }).catch(() => {});
        const steps = await p.evaluate(() => [...document.querySelectorAll('.dc-step')].map(s => s.classList.contains('is-done')));
        await p.click('#dc-toggle').catch(() => {});
        const stored = await p.evaluate(() => localStorage.getItem('aniroll_discord'));
        await p.goto(base + '/#/play/101/3');
        await p.waitForFunction(() => { const v = document.getElementById('player-video'); return v && v.readyState >= 2; }, null, { timeout: 10000 }).catch(() => {});
        await p.evaluate(() => document.getElementById('player-video').play().catch(() => {}));
        await p.waitForFunction(() => window.__activities.some(a => a?.timestamps), null, { timeout: 5000 }).catch(() => {});
        const playingNow = await p.evaluate(() => window.__activities.filter(a => a?.timestamps).at(-1));
        await p.evaluate(() => document.getElementById('player-video').pause());
        await p.waitForTimeout(800);
        const paused = await p.evaluate(() => window.__activities.at(-1));
        check('discord: Settings ticks the steps, the switch turns it on; the episode with time left, paused without, a link to the show',
            steps.length === 3 && steps.every(Boolean) && stored === 'on'
            && playingNow?.type === 3 && /^Episode 3( of \d+)?$/.test(playingNow.state || '') && playingNow.details?.length >= 2
            && playingNow.timestamps.end > playingNow.timestamps.start && /^https:\/\/aniroll\.app\/a\/\d+$/.test(playingNow.buttons?.[0]?.url || '')
            && /Paused$/.test(paused?.state || '') && !paused?.timestamps && !pageErrors.length, { steps, stored, playingNow, paused, pageErrors });
        await p.close();
    }

    // Episodes in the player: E (or the button) lists them, the one playing marked; another one plays right
    // there, the one playing just closes the list, and the player's keys stay off while it is open
    {
        const { p, pageErrors } = await playerPage(true);
        await p.goto(base + '/#/play/101/3');
        await p.waitForFunction(() => { const v = document.getElementById('player-video'); return v && v.readyState >= 2; }, null, { timeout: 10000 }).catch(() => {});
        const button = await p.evaluate(() => !document.getElementById('player-episodes')?.hidden);
        await p.keyboard.press('e');
        await p.waitForSelector('.ep-row.is-current', { timeout: 5000 }).catch(() => {});
        const shown = await p.evaluate(() => {
            const cur = document.querySelector('.ep-row.is-current');
            return { href: cur?.getAttribute('href'), label: cur?.querySelector('.ep-next')?.textContent, time: document.getElementById('player-video').currentTime };
        });
        await p.keyboard.press('ArrowRight');
        const kept = await p.evaluate(t => Math.abs(document.getElementById('player-video').currentTime - t) < 5, shown.time);
        await p.evaluate(() => document.querySelector('.ep-row.is-current')?.click());
        await p.waitForTimeout(300);
        const same = await p.evaluate(() => ({ open: !!document.querySelector('.ep-dialog'), hash: location.hash }));
        await p.evaluate(() => document.getElementById('player-episodes')?.click());
        await p.waitForSelector('.ep-row[href$="/4"]', { timeout: 5000 }).catch(() => {});
        await p.evaluate(() => document.querySelector('.ep-row[href$="/4"]')?.click());
        await p.waitForFunction(() => /Episode 4/.test(document.getElementById('player-episode')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const other = await p.evaluate(() => ({ open: !!document.querySelector('.ep-dialog'), hash: location.hash,
            title: document.getElementById('player-episode')?.textContent }));
        check('player: Episodes (E) marks the one playing, keeps the player keys off, plays another right there',
            button && /^#\/play\/\d+\/3$/.test(shown.href || '') && shown.label === 'Playing' && kept && !same.open && same.hash === '#/play/101/3'
            && !other.open && /^#\/play\/\d+\/4$/.test(other.hash) && /Episode 4/.test(other.title || '') && !pageErrors.length, { button, shown, kept, same, other, pageErrors });
        await p.close();
    }

    // Watch Party from the player: one click starts it for the show being watched, the link goes to the clipboard
    {
        const { p, pageErrors } = await playerPage(true);
        await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
        let created = null;
        await p.route(`${base}/api/party/**`, route => {
            const req = route.request();
            if (req.method() === 'PUT' && /\/api\/party\/[^/]+\/\d+$/.test(new URL(req.url()).pathname)) created = req.postDataJSON();
            if (req.method() === 'DELETE') ended = true;
            // Three members: in step with the host, one episode behind, two behind
            const state = { hostKey: 'k', active: true, hostProgress: 3, members: [
                { name: 'inStep', avatar: '', progress: 3 }, { name: 'oneBehind', avatar: '', progress: 2 }, { name: 'twoBehind', avatar: '', progress: 1 }] };
            if (req.url().endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: `retry: 60000\ndata: ${JSON.stringify(state)}\n\n` });
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
        });
        let ended = false;
        await p.goto(base + '/#/play/101/3');
        await p.waitForSelector('#player-party', { timeout: 8000 }).catch(() => {});
        // Clicked once the episode plays
        await p.waitForFunction(() => { const v = document.getElementById('player-video'); return v && v.readyState >= 2; }, null, { timeout: 10000 }).catch(() => {});
        // A DOM click: the resume question keeps the controls coming and going, which a real click waits out
        await p.evaluate(() => document.getElementById('player-party')?.click());
        await p.waitForFunction(() => localStorage.getItem('aniroll_watchparty'), null, { timeout: 5000 }).catch(() => {});
        await p.waitForTimeout(300);
        const res = await p.evaluate(async () => ({ stored: JSON.parse(localStorage.getItem('aniroll_watchparty') || 'null'),
            clip: await navigator.clipboard.readText().catch(() => ''), hash: location.hash }));
        check('player: Watch Party button starts a party for this show, link in the clipboard, playback stays',
            created?.startEp === 2 && res.stored?.startEp === 2 && /#\/watchparty\?host=/.test(res.clip) && res.hash === '#/play/101/3' && !pageErrors.length,
            { created, res, pageErrors });
        const note = await p.evaluate(() => document.querySelector('.pl-party-note')?.textContent);
        check('player: starting the party says so at the top of the player', /Watch Party started/.test(note || ''), { note });

        // Clicked again: who is in (orange one behind, red two behind), End stops playback and asks End or End & Post
        await p.evaluate(() => document.getElementById('player-party')?.click());
        await p.waitForSelector('.pl-party-member', { timeout: 5000 }).catch(() => {});
        const panel = await p.evaluate(() => [...document.querySelectorAll('.pl-party-member')].map(li => li.querySelector('.pl-party-name').textContent + ':' + li.className.replace('pl-party-member', '').trim()));
        await p.evaluate(() => document.querySelector('[data-party="end"]')?.click());
        await p.waitForSelector('[data-end="post"]', { timeout: 3000 }).catch(() => {});
        const asked = await p.evaluate(() => ({ paused: document.getElementById('player-video').paused, panel: !!document.querySelector('.pl-party-panel'),
            buttons: [...document.querySelectorAll('[data-end]')].map(b => b.textContent.trim()) }));
        await p.evaluate(() => document.querySelector('[data-end="end"]')?.click());
        await p.waitForFunction(() => !localStorage.getItem('aniroll_watchparty'), null, { timeout: 5000 }).catch(() => {});
        const after = await p.evaluate(() => ({ note: document.querySelector('.pl-party-note')?.textContent, hash: location.hash }));
        check('player: party panel lists members, marks who is behind, End pauses and offers End Party or End Party & Post',
            panel.join() === 'inStep:,oneBehind:is-behind,twoBehind:is-off' && asked.paused && !asked.panel
            && asked.buttons.join() === 'End Party,End Party & Post' && ended && after.note === 'Watch Party ended' && after.hash === '#/play/101/3' && !pageErrors.length,
            { panel, asked, ended, after, pageErrors });
        await p.close();
    }

    // Friends connect with a Quick Connect code: no password field, the code shown, connected once confirmed
    {
        const { p, pageErrors, calls } = await playerPage(true, false);
        await p.goto(base + '/#/settings?tab=jellyfin');
        await p.waitForSelector('#jf-connect', { timeout: 8000 });
        const form = await p.evaluate(() => ({ password: !!document.querySelector('#jf-settings input[type=password]'), button: document.getElementById('jf-connect').textContent }));
        await p.fill('#jf-url', 'https://jellyfin.e2e.test');
        await p.click('#jf-connect');
        await p.waitForSelector('.jf-qc-code', { timeout: 5000 }).catch(() => {});
        const code = await p.evaluate(() => document.querySelector('.jf-qc-code')?.textContent);
        await p.waitForFunction(() => /Connected/.test(document.getElementById('jf-settings-state')?.textContent || ''), null, { timeout: 12000 }).catch(() => {});
        const done = await p.evaluate(() => ({ state: document.getElementById('jf-settings-state')?.textContent, kind: localStorage.aniroll_jf_kind,
            token: localStorage.aniroll_jf_apikey, local: !!document.getElementById('jf-local') }));
        check('jellyfin: Quick Connect code instead of a password, connected once confirmed',
            !form.password && /Quick Connect/.test(form.button) && code === '482913' && /Connected/.test(done.state || '') && done.kind === 'user'
            && done.token === 'qc-token' && done.local && calls.some(c => c.type === 'qcAuth' && c.body?.Secret === 'qc-secret') && !pageErrors.length,
            { form, code, done, pageErrors });
        await p.close();
    }

    // Stack off (required): the app starts as always, no Play button, no error, no waiting
    {
        const { p, pageErrors } = await playerPage(false);
        const t0 = Date.now();
        await p.goto(base + '/#/anime/101/full');
        await p.waitForSelector('.detail-title', { timeout: 10000 });
        const shownAfter = Date.now() - t0;
        await p.waitForTimeout(4000); // longer than the reachability timeout
        const off = await p.evaluate(() => ({
            play: !!document.querySelector('.detail-play'),
            slotHidden: document.getElementById('detail-play')?.hidden,
            title: document.querySelector('.detail-title')?.textContent,
        }));
        check('player, Jellyfin off: detail page as always, no Play button, no errors',
            !off.play && off.slotHidden === true && !!off.title && shownAfter < 4000 && !pageErrors.length, { ...off, shownAfter, pageErrors });
        await p.evaluate(() => { location.hash = '#/play/101/2'; });
        await idle(p, 2500);
        const msg = await p.evaluate(() => document.getElementById('player-status')?.textContent.trim());
        check('player, Jellyfin off: #/play says the server cannot be reached', /cannot be reached/.test(msg || ''), msg);
        await p.close();
    }

    // Library check: Jellyfin names the show differently, the TVDB id from our server's anime map finds it.
    // The mock's detail id comes from a hash: a first look without a map tells which id the page asks for.
    {
        const { p, pageErrors, calls } = await playerPage(true, true, { library: [{ Id: 'series1', Name: 'Other Name', Type: 'Series', ProviderIds: { Tvdb: '4242' } }] });
        const asked = [];
        let mapFor = null;
        await p.route(`${base}/api/animemap`, route => {
            asked.push(route.request().postDataJSON());
            const entries = mapFor ? [{ a: mapFor, tvdb: 4242, ts: 1, to: 0, tmdb: null, ms: null, mo: 0, movie: [] }] : [];
            route.fulfill({ contentType: 'application/json', body: JSON.stringify({ at: Date.now(), entries }) });
        });
        await p.goto(base + '/#/anime/101/full');
        await p.waitForFunction(() => /missing/.test(localStorage.aniroll_jf_match3 || ''), null, { timeout: 8000 }).catch(() => {});
        mapFor = Number(await p.evaluate(() => Object.keys(JSON.parse(localStorage.aniroll_jf_match3 || '{}').map || {})[0]));
        const before = await p.evaluate(() => !!document.querySelector('.detail-play'));
        // Jellyfin was off and is back: the profile menu's status check runs the library check again
        await p.evaluate(() => {
            const s = JSON.parse(localStorage.aniroll_jf_animemap);
            localStorage.aniroll_jf_animemap = JSON.stringify({ ...s, online: false });
        });
        await p.reload();
        await p.waitForSelector('.detail-play', { timeout: 8000 }).catch(() => {});
        const button = await p.evaluate(() => document.querySelector('.detail-play')?.getAttribute('href') || null);
        check('player: a show Jellyfin names differently is found by its TVDB id, checked again once Jellyfin is back',
            !before && new RegExp(`^#/play/${mapFor}/2$`).test(button || '')
            && asked.length >= 2 && asked.every(b => b.tvdb?.includes(4242)) && calls.some(c => c.type === 'libraryList')
            && !pageErrors.length, { before, mapFor, button, asked, pageErrors });
        await p.close();
    }

    // Stack on: Play button, direct play from the stream URL, reports to Jellyfin, AniList exactly once at 90%
    {
        const { p, pageErrors, saves, calls } = await playerPage(true);
        await p.goto(base + '/#/anime/101/full');
        await p.waitForSelector('.detail-play', { timeout: 8000 }).catch(() => {});
        const button = await p.evaluate(() => {
            const a = document.querySelector('.detail-play');
            return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null;
        });
        check('player: Play button for the next episode when Jellyfin has it', /^#\/play\/\d+\/2$/.test(button?.href || '') && /Play episode 2/.test(button.text), button);
        // Home's Up next hero: Play beside "Watched episode N", which steps back to a secondary button
        await p.evaluate(() => { location.hash = '#/'; });
        await p.waitForSelector('.hero-play', { timeout: 8000 }).catch(() => {});
        const hero = await p.evaluate(() => {
            const a = document.querySelector('.hero-play');
            const w = document.querySelector('[data-hero-inc], [data-ar-inc]');
            return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), watched: w?.className } : { slot: !!document.querySelector('[data-hero-play]'), title: document.querySelector('.m3-hero-title, .ar-home-head .detail-title')?.textContent, jf: localStorage.aniroll_jf_url };
        });
        check('home: the Up next hero plays the next episode from Jellyfin', /^#\/play\/\d+\/\d+$/.test(hero?.href || '')
            && /Play episode \d+|Resume episode \d+/.test(hero.text) && /glass-btn-secondary/.test(hero.watched || ''), hero);
        await p.goto(base + '/#/anime/101/full');
        await p.waitForSelector('.detail-play', { timeout: 8000 }).catch(() => {});

        // Episodes: every episode Jellyfin has, the next one marked, watched and started ones told apart;
        // the sequel's chip switches the list over (the mock Jellyfin has none of its episodes)
        await p.click('.detail-episodes').catch(() => {});
        await p.waitForSelector('.ep-row', { timeout: 5000 }).catch(() => {});
        const eps = await p.evaluate(() => {
            const rows = [...document.querySelectorAll('.ep-row')];
            return { rows: rows.length, next: document.querySelector('.ep-row.is-next')?.getAttribute('href'),
                watched: rows[0]?.classList.contains('is-watched'), started: !!rows[2]?.querySelector('.ep-progress'),
                thumb: rows[0]?.querySelector('img')?.getAttribute('src') || '', play: rows[3]?.getAttribute('href'),
                chip: document.querySelector('.ep-seasons [data-season]')?.dataset.season || null };
        });
        await p.click('.ep-seasons [data-season]').catch(() => {});
        await p.waitForTimeout(1500);
        const switched = await p.evaluate(() => ({ first: document.querySelector('.ep-row')?.getAttribute('href') || null,
            empty: /None of its episodes/.test(document.querySelector('.ep-list')?.textContent || '') }));
        await p.keyboard.press('Escape');
        await p.waitForTimeout(300);
        const epsClosed = await p.evaluate(() => !document.querySelector('.ep-dialog'));
        check('player: Episodes lists every episode, marks the next, watched and started; seasons switch; Escape closes',
            eps.rows === 11 && /^#\/play\/\d+\/2$/.test(eps.next || '') && eps.watched && eps.started && /\/Items\/ep1\/Images\/Primary/.test(eps.thumb)
            && /^#\/play\/\d+\/4$/.test(eps.play || '') && eps.chip && (switched.empty || (!!switched.first && switched.first.split('/')[2] !== (eps.next || '').split('/')[2])) && epsClosed, { ...eps, ...switched, epsClosed });

        const playHash = button?.href || '#/play/101/2';
        await p.click('.detail-play').catch(() => p.evaluate(h => { location.hash = h; }, playHash));
        await p.waitForFunction(() => { const v = document.getElementById('player-video'); return v && v.readyState >= 2; }, null, { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(1500);
        const playing = await p.evaluate(() => {
            const v = document.getElementById('player-video');
            return { src: v?.currentSrc || '', ready: v?.readyState, tracks: v ? [...v.textTracks].map(t => `${t.label}:${t.mode}`) : [],
                status: document.getElementById('player-status')?.hidden, method: document.getElementById('player-method')?.textContent,
                open: document.body.classList.contains('player-open') };
        });
        const info = calls.find(c => c.type === 'PlaybackInfo');
        const profile = info?.body?.DeviceProfile;
        check('player: PlaybackInfo with this browser\'s profile (VP9 direct, no 10-bit H.264, Auto: the bitrate the line measured)',
            info?.item === 'ep2' && profile?.DirectPlayProfiles?.some(d => /webm/.test(d.Container) && /vp9/.test(d.VideoCodec))
            && JSON.stringify(profile.CodecProfiles).includes('VideoBitDepth') && profile.MaxStreamingBitrate > 0 && profile.MaxStreamingBitrate <= 120000000
            && calls.some(c => c.type === 'bitrateTest'), profile);
        check('player: direct play from the static stream, subtitles shown, full screen',
            /\/Videos\/ep2\/stream\?static=true/.test(playing.src) && playing.ready >= 2 && playing.tracks.join() === 'English:showing'
            && playing.status === true && playing.method === 'Direct play' && playing.open, playing);
        const start = calls.find(c => c.type === 'Playing');
        check('player: Jellyfin gets the start report with this device', start?.body?.ItemId === 'ep2' && start.body.PlaySessionId === 'ps-ep2'
            && /Client="AniRoll".*DeviceId="[^"]+".*Token="e2e-jf-token"/.test(start.auth), start);

        const savesBefore = saves.length;
        // Stays on episode 2 at its end: Up next is cancelled each time it comes up
        const stay = () => p.evaluate(() => document.querySelector('[data-act="cancelNext"]')?.click());
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.5; v.play(); });
        await p.waitForTimeout(400);
        await stay();
        await p.waitForTimeout(2100);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 2; });
        await p.waitForTimeout(500);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 19; });
        await p.waitForTimeout(400);
        await stay();
        await p.waitForTimeout(1100);
        const written = saves.slice(savesBefore);
        check('player: AniList gets episode 2 exactly once, past 90%', written.length === 1 && written[0].progress === 2, written);

        // Skip intro from Jellyfin's media segments: shown inside the intro, jumps to its end
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 3; return v.play(); }).catch(() => {});
        await p.waitForTimeout(700);
        const skip = await p.evaluate(() => { const b = document.querySelector('.pl-skip-segment'); return { shown: b && !b.hidden, text: b?.textContent }; });
        // After 8 s of the intro it goes, controls or not; seeking back to where it came up brings it again
        await p.evaluate(() => { document.getElementById('player-video').currentTime = 11.5; });
        await p.waitForTimeout(500);
        const faded = await p.evaluate(() => ({ gone: document.querySelector('.pl-skip-segment').hidden,
            nextBtn: !document.querySelector('[data-act="nextEp"]').hidden }));
        await p.evaluate(() => { document.getElementById('player-video').currentTime = 2.5; });
        await p.waitForTimeout(500);
        faded.back = await p.evaluate(() => !document.querySelector('.pl-skip-segment').hidden);
        check('player: Skip intro goes by itself after 8 s and comes back when seeking back; a Next episode button',
            faded.gone && faded.back && faded.nextBtn, faded);
        await p.click('.pl-skip-segment').catch(() => {});
        await p.waitForTimeout(400);
        const skipped = await p.evaluate(() => ({ t: document.getElementById('player-video').currentTime, hidden: document.querySelector('.pl-skip-segment').hidden }));
        check('player: Skip intro from the media segments, jumps past it', skip.shown && skip.text === 'Skip intro' && skipped.t >= 13.9 && skipped.hidden, { skip, skipped });

        // Own M3 controls: no native ones, Space pauses, the wave follows, ← jumps back 10 s, C switches subtitles off
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 12; return v.play(); }).catch(() => {});
        await p.waitForTimeout(400);
        await p.mouse.move(640, 400);
        await p.keyboard.press('Space');
        await p.waitForTimeout(300);
        const ui = await p.evaluate(() => {
            const v = document.getElementById('player-video');
            return { native: v.controls, paused: v.paused, cls: document.getElementById('player').classList.contains('is-paused'),
                label: document.querySelector('.pl-play').getAttribute('aria-label'), now: Number(document.querySelector('.pl-seek').getAttribute('aria-valuenow')),
                pos: getComputedStyle(document.getElementById('player')).getPropertyValue('--pl-pos') };
        });
        await p.keyboard.press('ArrowLeft');
        await p.keyboard.press('c');
        await p.waitForTimeout(300);
        const after = await p.evaluate(() => ({ t: document.getElementById('player-video').currentTime, subs: [...document.getElementById('player-video').textTracks].map(t => t.mode).join() }));
        check('player: own controls — Space pauses, the wave follows, ← back 10 s, C toggles subtitles',
            !ui.native && ui.paused && ui.cls && ui.label === 'Play' && ui.now >= 11 && parseFloat(ui.pos) > 50 && after.t < 4 && after.subs === 'disabled', { ui, after });
        // Off with C is kept for the show; the next checks start from Jellyfin's pick again
        const offKept = await p.evaluate(() => { const v = Object.values(JSON.parse(localStorage.getItem('aniroll_subs_pref') || '{}'))[0]; localStorage.removeItem('aniroll_subs_pref'); return v; });
        check('player: subtitles switched off are remembered for the show', offKept?.off === true, offKept);

        await p.evaluate(() => { location.hash = '#/anime/101/full'; });
        await p.waitForTimeout(1200);
        const stopped = calls.find(c => c.type === 'Playing/Stopped');
        check('player: leaving reports where it stopped and frees the page', stopped?.body?.ItemId === 'ep2' && stopped.body.PositionTicks > 0
            && !(await p.evaluate(() => document.body.classList.contains('player-open'))), stopped);

        // Stopped half-way before (episode 3 in the mock): Continue or Start over, playing only once chosen
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/3'));
        await p.waitForSelector('.pl-resume', { timeout: 8000 }).catch(() => {});
        const resume = await p.evaluate(() => ({ shown: !!document.querySelector('.pl-resume'),
            label: document.querySelector('[data-resume="continue"]')?.textContent.trim(), paused: document.getElementById('player-video')?.paused,
            focused: document.activeElement?.dataset.resume }));
        await p.click('[data-resume="restart"]').catch(() => {});
        await p.waitForTimeout(1200);
        const restarted = await p.evaluate(() => ({ gone: !document.querySelector('.pl-resume'), t: document.getElementById('player-video').currentTime,
            playing: !document.getElementById('player-video').paused }));
        check('player: a started episode asks Continue at 0:10 or Start over; Start over plays from the beginning',
            resume.shown && resume.label === 'Continue at 0:10' && resume.paused && resume.focused === 'continue'
            && restarted.gone && restarted.t < 3 && restarted.playing, { resume, restarted });

        // N (or the button next to the time) goes straight to the next episode
        await p.evaluate(h => { location.hash = h; }, playHash);
        await idle(p, 2500);
        await p.mouse.move(640, 420);
        await p.keyboard.press('n');
        await idle(p, 1500);
        const viaN = await p.evaluate(() => location.hash);
        check('player: N plays the next episode', /\/3$/.test(viaN), viaN);

        // Up next: from the last seconds a card counts down; Cancel keeps the episode, going back and
        // forward brings it again, Play now opens the next one. Halfway, the next subtitles are unpacked ahead
        await p.evaluate(h => { location.hash = h; }, playHash);
        await idle(p, 2500);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.6; v.play(); });
        await p.waitForTimeout(800);
        const upNext = await p.evaluate(() => ({ shown: !document.querySelector('.pl-next').hidden,
            title: document.querySelector('.pl-next-title').textContent, label: document.querySelector('.pl-next-label').textContent }));
        await p.click('[data-act="cancelNext"]');
        // Watch credits: the card goes, and no Skip credits button takes its place
        const cancelled = await p.evaluate(() => document.querySelector('.pl-next').hidden && document.querySelector('.pl-skip-segment').hidden);
        // Watched the credits to the end: the card asks once more instead of leaving at once
        await p.waitForTimeout(1800);
        const atEnd = await p.evaluate(() => ({ ended: document.getElementById('player-video').ended, shown: !document.querySelector('.pl-next').hidden, hash: location.hash }));
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 5; });
        await p.waitForTimeout(400);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.6; v.play(); });
        await p.waitForTimeout(800);
        const again = await p.evaluate(() => !document.querySelector('.pl-next').hidden);
        await p.click('[data-act="playNext"]');
        await idle(p, 2500);
        const moved = await p.evaluate(() => location.hash);
        const askedOnUpNext = await p.evaluate(() => !!document.querySelector('.pl-resume'));
        check('player: Up next counts down from the end, Watch credits hides it until the very end, Play now opens the next episode, its subtitles warmed',
            upNext.shown && upNext.title === 'Episode 3' && /^Play now · \d+$/.test(upNext.label) && cancelled
            && atEnd.ended && atEnd.shown && /\/2$/.test(atEnd.hash) && again
            && /\/3$/.test(moved) && calls.some(c => c.type === 'PlaybackInfo' && c.item === 'ep3') && calls.some(c => c.type === 'vtt' && c.item === 'ep3')
            && !askedOnUpNext, { upNext, cancelled, atEnd, again, moved, askedOnUpNext });

        // Styled ASS: drawn by JASSUB on its canvas with the MKV's fonts, listed in the menu
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/3'));
        await idle(p, 4000);
        const ass = await p.evaluate(() => {
            const c = document.querySelector('.pl-subs-canvas');
            return { canvas: !!c, shown: c && !c.hidden, w: c?.width || 0, textTracks: [...document.getElementById('player-video').textTracks].map(t => t.mode).join() };
        });
        await p.mouse.move(640, 500);
        await p.click('[data-act="subs"]').catch(() => {});
        await p.waitForTimeout(300);
        const menuItems = await p.$$eval('.pl-menu-item', els => els.map(e => e.textContent.trim()));
        await p.keyboard.press('Escape');
        check('player: styled ASS through JASSUB with the embedded font, text tracks stay off',
            ass.canvas && ass.shown && ass.w > 0 && ass.textTracks === 'disabled' && calls.some(c => c.type === 'ass') && calls.some(c => c.type === 'font' && /Token=/.test(c.auth))
            && menuItems.join('|') === 'Off|English|English (Signs & Songs)', { ...ass, menuItems });

        // Blu-ray subtitles (PGS): libpgs draws the picture on its own canvas, at the place the disc puts it
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/4'));
        // libpgs draws in a worker (its requests are not the page's): wait for the picture itself
        await p.waitForFunction(() => [...document.querySelectorAll('.pl-subs-canvas')].some(c => !c.hidden && c.width > 300), null, { timeout: 8000 }).catch(() => {});
        await p.waitForTimeout(400);
        const pgs = await p.evaluate(() => {
            const v = document.getElementById('player-video');
            const c = [...document.querySelectorAll('.pl-subs-canvas')].find(x => !x.hidden);
            if (!c) return { canvas: false };
            // Sample the middle of the bar (x 960, y 990 on the 1920x1080 picture) from a copy of the canvas
            const copy = document.createElement('canvas');
            copy.width = c.width;
            copy.height = c.height;
            const g = copy.getContext('2d');
            g.drawImage(c, 0, 0);
            const at = (x, y) => [...g.getImageData(Math.round(x * c.width / 1920), Math.round(y * c.height / 1080), 1, 1).data];
            return { canvas: true, w: c.width, h: c.height, bar: at(960, 990), above: at(960, 500), time: v.currentTime,
                noteGone: document.querySelector('.pl-subs-note')?.hidden === true,
                textTracks: [...v.textTracks].map(t => t.mode).join() };
        });
        await p.mouse.move(640, 500);
        await p.click('[data-act="subs"]').catch(() => {});
        await p.waitForTimeout(300);
        const pgsMenu = await p.$$eval('.pl-menu-item', els => els.map(e => e.textContent.trim()));
        await p.keyboard.press('Escape');
        check('player: Blu-ray subtitles (PGS) drawn by libpgs where the disc places them, the loading note gone',
            pgs.canvas && pgs.noteGone && pgs.bar?.[3] > 200 && pgs.bar[0] > 200 && pgs.above?.[3] === 0 && pgs.textTracks === 'disabled'
            && calls.some(c => c.type === 'pgs') && pgsMenu.join('|') === 'Off|English|English [PGS]', { ...pgs, pgsMenu });

        // Subtitles chosen in one episode stay for the next of the show: plain English on episode 4 (whose
        // default is Blu-ray), then episode 3 starts with plain English instead of its ASS default
        await p.waitForTimeout(300);
        await p.mouse.move(640, 500);
        await p.click('[data-act="subs"]').catch(() => {});
        await p.waitForTimeout(300);
        await p.click('[data-track="2"]').catch(() => {});
        await p.waitForTimeout(500);
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/3'));
        await idle(p, 3000);
        const keptSubs = await p.evaluate(() => ({
            text: [...document.getElementById('player-video').textTracks].map(t => `${t.label}:${t.mode}`).join(),
            pictures: [...document.querySelectorAll('.pl-subs-canvas')].some(c => !c.hidden),
            pref: Object.values(JSON.parse(localStorage.getItem('aniroll_subs_pref') || '{}'))[0],
        }));
        await p.evaluate(() => localStorage.removeItem('aniroll_subs_pref'));
        check('player: the subtitles picked carry over to the next episode', keptSubs.text === 'English:showing' && !keptSubs.pictures && keptSubs.pref?.label === 'English', keptSubs);

        // Audio tracks: a second section in the menu; picking the dub asks Jellyfin again with that track and
        // goes on from the same spot; the next episode of the show starts with the dub
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/6'));
        await idle(p, 3000);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 6; });
        await p.waitForTimeout(500);
        await p.mouse.move(640, 500);
        await p.click('[data-act="subs"]').catch(() => {});
        await p.waitForTimeout(300);
        const audioMenu = await p.evaluate(() => ({
            titles: [...document.querySelectorAll('.pl-menu-title')].map(e => e.textContent),
            audio: [...document.querySelectorAll('[data-audio]')].map(e => `${e.textContent.trim()}:${e.getAttribute('aria-checked')}`),
        }));
        await p.click('[data-audio="5"]').catch(() => {});
        await idle(p, 2500);
        const dubbed = await p.evaluate(() => ({ time: document.getElementById('player-video').currentTime,
            pref: JSON.parse(localStorage.getItem('aniroll_audio_pref') || '{}') }));
        const asked = calls.filter(c => c.type === 'PlaybackInfo' && c.item === 'ep6').map(c => c.audio);
        await p.mouse.move(600, 500);
        await p.click('[data-act="subs"]').catch(() => {});
        await p.waitForTimeout(300);
        const checkedAfter = await p.evaluate(() => document.querySelector('[data-audio][aria-checked="true"]')?.dataset.audio);
        await p.keyboard.press('Escape');
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/7'));
        await idle(p, 3000);
        const nextAsked = calls.filter(c => c.type === 'PlaybackInfo' && c.item === 'ep7').map(c => c.audio);
        const reportedAudio = calls.filter(c => c.type === 'Playing' && c.body?.ItemId === 'ep7').map(c => c.body.AudioStreamIndex);
        check('player: audio tracks in the menu, switching asks Jellyfin for that track from the same spot, the show remembers the dub',
            audioMenu.titles.join() === 'Audio,Subtitles,Timing,Size' && audioMenu.audio.join('|') === 'Japanese - Opus - Stereo:true|English - Opus - Stereo:false'
            && asked.join() === ',5' && dubbed.time > 4 && checkedAfter === '5'
            && Object.values(dubbed.pref).some(v => v.lang === 'eng') && reportedAudio.includes(5) && !reportedAudio.includes(1),
            { audioMenu, asked, dubbed, checkedAfter, nextAsked, reportedAudio });

        // Quality & stats: Auto (measured), Maximum and Jellyfin's bitrate steps; a step asks Jellyfin again under that
        // bitrate from the same spot and is kept; I shows the stats for nerds
        await p.mouse.move(640, 500);
        await p.click('[data-act="settings"]').catch(() => {});
        await p.waitForTimeout(300);
        const qMenu = await p.$$eval('[data-quality]', els => els.map(e => `${e.textContent.trim()}:${e.getAttribute('aria-checked')}`));
        const before7 = calls.filter(c => c.type === 'PlaybackInfo' && c.item === 'ep7').length;
        await p.click('[data-quality="4000000"]').catch(() => {});
        await idle(p, 2500);
        const asked7 = calls.filter(c => c.type === 'PlaybackInfo' && c.item === 'ep7').slice(before7).map(c => c.bitrate);
        const kept = await p.evaluate(() => localStorage.getItem('aniroll_player_quality'));
        await p.keyboard.press('i');
        await p.waitForTimeout(1300);
        const nerd = await p.evaluate(() => ({ shown: !document.querySelector('.pl-stats').hidden,
            titles: [...document.querySelectorAll('.pl-stats-title')].map(e => e.textContent),
            quality: [...document.querySelectorAll('.pl-stats-row')].find(r => r.firstElementChild.textContent === 'Quality')?.lastElementChild.textContent }));
        await p.keyboard.press('i');
        const nerdGone = await p.evaluate(() => document.querySelector('.pl-stats').hidden);
        await p.evaluate(() => localStorage.removeItem('aniroll_player_quality'));
        check('player: quality menu (Auto measured, Maximum, bitrate steps) asks Jellyfin under the bitrate and keeps it; I toggles the stats',
            /^Auto \(\d/.test(qMenu[0] || '') && qMenu[0].endsWith(':true') && /^Maximum \(120 Mbps\)/.test(qMenu[1] || '') && qMenu.some(q => q.startsWith('4 Mbps'))
            && asked7.join() === '4000000' && kept === '4000000' && calls.some(c => c.type === 'bitrateTest')
            && nerd.shown && nerd.titles.join() === 'Playback,Source,Stream,This browser' && nerd.quality === '4 Mbps' && nerdGone,
            { qMenu: qMenu.slice(0, 3), asked7, kept, nerd, nerdGone });

        // Connected with an API key, Jellyfin keeps nothing for the user by itself: AniRoll writes the spot
        // where it stopped, and "played" from 90 %, for the user
        await p.evaluate(() => localStorage.setItem('aniroll_jf_kind', 'key'));
        const before = calls.length;
        await p.evaluate(h => { location.hash = h; }, playHash);
        await idle(p, 3000);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 9; });
        await p.waitForTimeout(400);
        await p.evaluate(() => { location.hash = '#/anime/101/full'; });
        await p.waitForTimeout(800);
        await p.evaluate(h => { location.hash = h; }, playHash);
        await idle(p, 3000);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.3; return v.play(); }).catch(() => {});
        await p.waitForTimeout(1200);
        await p.evaluate(() => { location.hash = '#/anime/101/full'; });
        await p.waitForTimeout(800);
        await p.evaluate(() => localStorage.setItem('aniroll_jf_kind', 'user'));
        const userData = calls.slice(before).filter(c => c.type === 'userData' && c.item === 'ep2');
        const resumeAt = userData.find(c => c.body?.PlaybackPositionTicks > 0 && !c.body.Played);
        const played = userData.filter(c => c.body?.Played === true);
        check('player: with an API key, the resume spot and "played" (once) go to Jellyfin for the user',
            !!resumeAt && Math.abs(resumeAt.body.PlaybackPositionTicks / 1e7 - 9) < 1.5 && played.length === 1 && played[0].item === 'ep2' && !!played[0].user,
            userData.map(c => ({ item: c.item, user: !!c.user, body: c.body })));

        // The last episode Jellyfin has: a card instead of a black frame, with what is next and a way back
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/12'));
        await idle(p, 3000);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 19; return v.play(); }).catch(() => {});
        await p.waitForTimeout(2500);
        const endCard = await p.evaluate(() => { const b = document.querySelector('.pl-end');
            return { shown: !!b && !b.hidden, kicker: b?.querySelector('.pl-next-kicker')?.textContent, title: b?.querySelector('.pl-end-title')?.textContent,
                back: !!b?.querySelector('a[href^="#/anime/"]') }; });
        check('player: the last episode ends on a card saying what is next, with a way back', endCard.shown && !!endCard.kicker && !!endCard.title && endCard.back, endCard);

        // The server cannot convert (graphics card full): a clear message, no endless spinner, the conversion ended
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/5'));
        await idle(p, 3500);
        const failed = await p.evaluate(() => ({ text: document.getElementById('player-status')?.textContent.trim(), error: document.getElementById('player-status')?.classList.contains('error') }));
        const segTries = calls.filter(c => c.type === 'segment').length;
        check('player: a failed conversion says so at once (no endless retrying), with Try again',
            failed.error && /could not convert/.test(failed.text || '') && /Try again/.test(failed.text || '') && segTries <= 2, { ...failed, segTries });
        check('player: no errors', !pageErrors.length, pageErrors);
        await p.close();
    }

    // v134: a double episode, the keys and what they show, the media keys, segments on the wave, intros
    // skipped by themselves, and the AniList progress mirrored to Jellyfin season by season
    {
        const { p, pageErrors, saves, calls } = await playerPage(true);
        await p.goto(base + '/#/play/101/10');
        await p.waitForFunction(() => { const v = document.getElementById('player-video'); return v && v.readyState >= 2; }, null, { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(1200);
        const dbl = await p.evaluate(() => ({
            label: document.getElementById('player-episode')?.textContent || '',
            title: document.title,
            next: document.querySelector('.pl-next-title')?.textContent || '',
            thumb: !document.querySelector('.pl-next-thumb')?.hidden,
            session: navigator.mediaSession?.metadata ? { title: navigator.mediaSession.metadata.title, artist: navigator.mediaSession.metadata.artist } : null,
            segs: [...document.querySelectorAll('.pl-seek-seg')].map(x => x.dataset.type),
        }));
        check('player: a double-episode file plays as episodes 10–11, Up next is 12 with its picture, the tab and media keys know it',
            /Episodes 10–11/.test(dbl.label) && /Episodes 10–11/.test(dbl.title) && /Episode 12/.test(dbl.next) && dbl.thumb
            && /Episodes 10–11/.test(dbl.session?.title || '') && !!dbl.session?.artist, dbl);
        check('player: the intro shows as a stretch on the wave', dbl.segs.join() === 'Intro', dbl.segs);

        // The label over the wave names the intro when the pointer is in it
        const seek = await p.$('.pl-seek');
        const box = await seek.boundingBox();
        await p.mouse.move(box.x + box.width * (5 / 20), box.y + box.height / 2);
        await p.waitForTimeout(200);
        const hover = await p.evaluate(() => ({ seg: document.querySelector('.pl-seek-hover-seg')?.textContent, hidden: document.querySelector('.pl-seek-hover-seg')?.hidden,
            time: document.querySelector('.pl-seek-hover-time')?.textContent }));
        check('player: hovering the intro says so next to the time', hover.seg === 'Intro' && !hover.hidden && /^0:0[45]$/.test(hover.time || ''), hover);
        // Chapters from the file: a mark where one starts (none at 0), its name in the label
        await p.mouse.move(box.x + box.width * (17 / 20), box.y + box.height / 2);
        await p.waitForTimeout(200);
        const chap = await p.evaluate(() => ({ marks: document.querySelectorAll('.pl-seek-chapter').length,
            left: document.querySelector('.pl-seek-chapter')?.style.left, label: document.querySelector('.pl-seek-hover-seg')?.textContent }));
        check('player: chapters from the file as marks on the wave, the name when hovering', chap.marks === 1 && /^7[45]/.test(chap.left || '') && chap.label === 'Part B', chap);

        // Keys: volume shows its number, ] speeds up, 5 jumps to half
        await p.mouse.move(640, 300);
        await p.keyboard.press('ArrowDown');
        await p.waitForTimeout(150);
        const osd = await p.evaluate(() => ({ text: document.querySelector('.pl-osd')?.textContent, shown: !document.querySelector('.pl-osd')?.hidden }));
        await p.keyboard.press(']');
        await p.keyboard.press('5');
        await p.waitForTimeout(200);
        const keys = await p.evaluate(() => { const v = document.getElementById('player-video'); return { rate: v.playbackRate, t: v.currentTime, d: v.duration }; });
        check('player: keys answer on screen — volume, ] for speed, 5 for half way', osd.shown && /^Volume \d+ %$/.test(osd.text || '') && keys.rate === 1.25 && Math.abs(keys.t - keys.d / 2) < 1.5, { osd, keys });
        await p.keyboard.press('[');

        // Past 90 %: AniList gets 11, the file's last episode, not 10
        const before = saves.length;
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.8; return v.play(); }).catch(() => {});
        await p.waitForTimeout(900);
        const written = saves.slice(before);
        check('player: a double episode saves its last episode to AniList', written.length === 1 && written[0].progress === 11, written);

        // Intros skip themselves once switched on for the show, with a way back. The video above ran into its
        // last second: stop it there first, or the end card covers the settings button and the click misses
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.pause(); v.currentTime = 1; });
        await p.waitForFunction(() => !document.getElementById('player-video').ended, null, { timeout: 2000 }).catch(() => {});
        await p.click('[data-act="settings"]');
        await p.waitForSelector('[data-autoskip]', { timeout: 3000 }).catch(() => {});
        await p.click('[data-autoskip]').catch(() => {});
        await p.waitForFunction(() => JSON.parse(localStorage.getItem('aniroll_autoskip') || '{}').m101 === 1, null, { timeout: 3000 }).catch(() => {});
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 1.2; return v.play(); }).catch(() => {});
        // Waits for the jump itself: under load the video reaches the intro later
        await p.waitForFunction(() => document.getElementById('player-video').currentTime >= 13.9, null, { timeout: 8000 }).catch(() => {});
        const auto = await p.evaluate(() => ({ t: document.getElementById('player-video').currentTime, osd: document.querySelector('.pl-osd')?.textContent || '',
            undo: !!document.querySelector('.pl-osd-act'), kept: JSON.parse(localStorage.getItem('aniroll_autoskip') || '{}') }));
        check('player: intros skip themselves for a show once asked, with Undo', auto.t >= 13.9 && /Skipped intro/.test(auto.osd) && auto.undo && auto.kept.m101 === 1, auto);

        // AniList progress mirrored to Jellyfin: only season 1, up to that episode, not what was played already
        await p.route('https://graphql.anilist.co/**', route => {
            const body = route.request().postDataJSON();
            if (/^\s*mutation/.test(body.query) && /SaveMediaListEntry/.test(body.query)) {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { SaveMediaListEntry: {
                    id: 5, mediaId: 101, status: 'CURRENT', score: 0, progress: 3, progressVolumes: 0, repeat: 0, notes: null, startedAt: null, completedAt: null } } }) });
            }
            return route.fallback();
        });
        const playedBefore = calls.filter(c => c.type === 'played').length;
        await p.evaluate((v) => import(`/js/api.js?v=${v}`).then(api => api.saveMediaListEntry({ id: 5, progress: 3 }, 'e2e-token')), APP_VERSION);
        await p.waitForTimeout(1500);
        const scoreOnly = calls.filter(c => c.type === 'played').length;
        await p.evaluate((v) => import(`/js/api.js?v=${v}`).then(api => api.saveMediaListEntry({ id: 5, scoreRaw: 80 }, 'e2e-token')), APP_VERSION);
        await p.waitForTimeout(1200);
        const marked = calls.filter(c => c.type === 'played').map(c => c.item);
        check('jellyfin: progress 3 marks episodes 2 and 3 of the right season played, a score change touches nothing',
            marked.slice(playedBefore).join() === 'ep2,ep3' && calls.filter(c => c.type === 'played').length === scoreOnly, { marked });
        check('player v134: no errors', !pageErrors.length, pageErrors);
        await p.close();
    }

    };

    groups.seats = async () => {
    // A full house: logged in, the app waits on the waiting page with the place in line, nothing of the app
    // underneath, and lets the person in by itself once the server has a seat; logout gives the seat back
    {
        const sq = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        sq.on('pageerror', e => errors.push(`seats: ${e.message}`));
        const seatCalls = [];
        await sq.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
        await sq.route(`${base}/api/**`, route => {
            const p = new URL(route.request().url()).pathname;
            if (p === '/api/admin/stats') {
                const now = Date.now();
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ now, max: 100, seats: 1, vip: 1, queue: 1, watching: 0, parties: 0,
                    samples: Array.from({ length: 90 }, (_, i) => ({ t: now - (90 - i) * 60000, seats: i % 7, vip: 1, queue: 0, req: 20 + i, watching: 0 })),
                    vips: [{ id: 6649000, name: 'tester' }], maintenance: null, online: [{ key: 'vip:6649000', name: 'tester', vip: true, seen: now }],
                    waiting: [{ key: 'u:5', name: 'someone', since: now }], accounts: { backgroundSync: 1, jellyfin: 1, webhooks: 0 },
                    anilist: { syncPausedFor: 0, verifyPausedFor: 0, browsersPausedNow: 1, serverCallsLastMin: 4, serverBudget: 30,
                        hour: { sync: 0, verify: 0, browser: 1 }, day: { sync: 0, verify: 0, browser: 2 }, last: { sync: 0, verify: 0, browser: now - 60000 },
                        recent: [{ at: now - 60000, kind: 'browser', status: 429 }] }, errors: { count: 0, latest: [] }, server: { uptime: 60000, rss: 1e8, node: 'v24' } }) });
            }
            if (p !== '/api/seat') return route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' });
            seatCalls.push({ method: route.request().method(), auth: route.request().headers().authorization || '' });
            const posts = seatCalls.filter(c => c.method === 'POST').length;
            const body = posts <= 2 ? { seat: false, position: posts === 1 ? 3 : 1, waiting: 3, max: 100 } : { seat: true, vip: false, max: 100 };
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        await sq.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
        await sq.addInitScript(({ id, name }) => {
            localStorage.setItem('aniroll_token', 'e2e-token');
            localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
            localStorage.setItem('aniroll_user_ts', String(Date.now()));
            localStorage.setItem('aniroll_seen_changes', '9999');
        }, VIEWER);
        await sq.clock.install();
        await sq.goto(base + '/#/');
        await sq.waitForTimeout(1500);
        const full = await sq.evaluate(() => ({ page: !!document.getElementById('seat-wait'), line: document.querySelector('.seat-wait-line')?.textContent.trim(),
            app: !!document.querySelector('.home-section, #continue-watching') }));
        await sq.clock.runFor(16000);
        await sq.waitForTimeout(300);
        const next = await sq.evaluate(() => document.querySelector('.seat-wait-line')?.textContent.trim());
        await sq.clock.runFor(16000);
        await sq.waitForTimeout(2500);
        const inside = await sq.evaluate(() => ({ page: !!document.getElementById('seat-wait'), app: !!document.querySelector('.home-section, #continue-watching') }));
        check('seats: a full house shows the waiting page and the place in line, then lets in by itself',
            full.page && /number 3 in line/.test(full.line || '') && !full.app && /next in line/.test(next || '') && !inside.page && inside.app
            && seatCalls.every(c => c.auth === 'Bearer e2e-token'), { full, next, inside, calls: seatCalls.length });
        // The mock account is the owner's id: the link shows, the page draws the numbers
        const adminView = await sq.evaluate(async () => {
            const link = document.getElementById('admin-link')?.hidden === false;
            location.hash = '#/admin';
            await new Promise(r => setTimeout(r, 50));
            return link;
        });
        await sq.clock.runFor(2000);
        await sq.waitForTimeout(1200);
        const adminPage = await sq.evaluate(() => ({ tiles: document.querySelectorAll('.adm-tile').length, charts: document.querySelectorAll('.adm-chart svg').length,
            online: document.querySelector('#adm-online')?.textContent || '', letIn: !!document.querySelector('[data-let-in]'),
            anilist: document.querySelector('#adm-anilist')?.textContent.replace(/\s+/g, ' ') || '' }));
        check('admin: the owner sees tiles, four charts, who is online and who waits, and whether AniList limits AniRoll',
            adminView && adminPage.tiles === 7 && adminPage.charts === 4 && /tester/.test(adminPage.online) && adminPage.letIn
            && /1 browser rate limited/.test(adminPage.anilist) && /A browser/.test(adminPage.anilist), { adminView, ...adminPage });
        await sq.evaluate((v) => import(`/js/auth.js?v=${v}`).then(m => m.logout()), APP_VERSION);
        await sq.waitForTimeout(800);
        check('seats: logout gives the seat back', seatCalls.some(c => c.method === 'DELETE'), seatCalls.map(c => c.method));
        await sq.close();
    }

    // Anyone else: no Admin link, and #/admin shows no numbers (the server would refuse them too)
    {
        const na = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        na.on('pageerror', e => errors.push(`admin, not owner: ${e.message}`));
        await na.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
        await na.route(`${base}/api/**`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"maintenance":false}' }));
        await na.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
        await na.addInitScript(() => {
            localStorage.setItem('aniroll_token', 'e2e-token');
            localStorage.setItem('aniroll_user', JSON.stringify({ id: 1, name: 'someone', avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
            localStorage.setItem('aniroll_user_ts', String(Date.now()));
            localStorage.setItem('aniroll_seen_changes', '9999');
        });
        await na.goto(base + '/#/admin');
        await idle(na, 2500);
        const other = await na.evaluate(() => ({ link: document.getElementById('admin-link')?.hidden, text: document.querySelector('.adm-page')?.textContent || '',
            tiles: document.querySelectorAll('.adm-tile').length }));
        check('admin: no link and no numbers for anyone but the owner', other.link === true && /only for AniRoll/.test(other.text) && !other.tiles, other);
        await na.close();
    }

    };

    groups.misc = async () => {
    // "Reduce motion": no smooth scrolling (Lenis marks <html>), no cards flying in, no count-up
    const calm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await calm.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
    await calm.route(`${base}/api/**`, route => route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' }));
    await calm.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
    await calm.goto(base + '/#/');
    await idle(calm, 1500);
    const motion = await calm.evaluate(() => ({
        lenis: document.documentElement.classList.contains('lenis'),
        hiddenCards: [...document.querySelectorAll('.media-card, .landing-feature')].filter(el => getComputedStyle(el).opacity !== '1').length,
        transition: getComputedStyle(document.querySelector('.glass-btn') || document.body).transitionDuration,
    }));
    check('reduced motion: no smooth scrolling, no fly-in, no transitions',
        !motion.lenis && motion.hiddenCards === 0 && motion.transition.split(',').every(t => parseFloat(t) < 0.001), motion);
    await calm.close();

    // "What's new": returning visitors get everything they have not confirmed, on every visit until "Got it";
    // new visitors never get a pop-up
    async function visitor(storage, time) {
        const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        if (time) await p.clock.install({ time });
        await p.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
        await p.route(`${base}/api/**`, route => route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' }));
        await p.route(/cdn|googleapis|gstatic|aniskip/, route => route.abort());
        await p.addInitScript(entries => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const [k, v] of entries) localStorage.setItem(k, v); } }, Object.entries(storage));
        p.on('pageerror', e => errors.push(`whatsnew: ${e.message}`));
        await p.goto(base + '/#/');
        if (time) await p.clock.runFor(4000); else await p.waitForTimeout(4000);
        return p;
    }
    const dialogTitle = (p) => p.evaluate(() => document.querySelector('.whatsnew .modal-title')?.textContent || null);

    const back = await visitor({ aniroll_theme: 'dark' });
    const both = await back.evaluate(() => [...document.querySelectorAll('.whatsnew .whatsnew-heading')].map(h => h.textContent));
    check('returning visitor who confirmed nothing: every change, oldest (the move) first',
        (await dialogTitle(back)) === 'A few things changed' && both[0] === 'A few things moved' && both.length === CHANGE_COUNT && both[2].startsWith('Roll recommendations') && both[3].startsWith('Material 3') && both[4].startsWith('A new Home') && both[5].startsWith('Starting soon') && both[6].startsWith('Material 3 for everyone') && both[7].startsWith('Browse by tag') && both[8].startsWith('Next episode'), both);
    const demoTabs = await back.$$eval('.whatsnew-bar [data-k]', els => els.map(e => e.dataset.k).join(','));
    check('notice: animation ends on the new tab order', demoTabs === 'home,list,roll,discover,social', demoTabs);
    await back.click('.whatsnew [data-close]');
    const after = await back.evaluate(() => ({
        stored: localStorage.getItem('aniroll_seen_changes'),
        hint: document.querySelectorAll('.whatsnew-hint').length,
        open: !!document.querySelector('.whatsnew'),
    }));
    check('notice: closes, remembers, points at the real tabs', !after.open && after.stored && after.hint >= 2, after);
    await back.reload();
    await back.waitForTimeout(3000);
    check('notice: gone once confirmed', (await dialogTitle(back)) === null);
    await back.close();

    // Confirmed the move with "Got it" already: only what came after it
    const confirmed = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: '2026-09-22' });
    const only = await confirmed.evaluate(() => ({ title: document.querySelector('.whatsnew .modal-title')?.textContent, demo: !!document.querySelector('.whatsnew-demo'), sections: document.querySelectorAll('.whatsnew .whatsnew-entry').length }));
    check('returning visitor who confirmed the move: only what came after, no tab animation', only.title === 'A few things changed' && !only.demo && only.sections === CHANGE_COUNT - 1, only);
    await confirmed.close();

    const fresh = await visitor({});
    check('new visitor: no notice', (await dialogTitle(fresh)) === null);
    // Landing: headline in words, a roll to try in the hero, a tour whose tabs switch the clip, Watch Party as an invite
    const landing = await fresh.evaluate(async () => {
        const words = document.querySelectorAll('.landing-title .lw').length;
        // The hero's roll gets its covers from the trending shows the page loads anyway
        for (let i = 0; i < 40 && document.getElementById('try-roll')?.disabled; i++) await new Promise(r => setTimeout(r, 100));
        const machine = { window: !!document.querySelector('.lp-hero #try-window .roll-item img'), ready: document.getElementById('try-roll')?.disabled === false };
        const items = [...document.querySelectorAll('.landing-tour-item')];
        items[1]?.click();
        const navTop = document.getElementById('navbar').classList.contains('is-scrolled');
        window.scrollTo(0, 400);
        await new Promise(r => setTimeout(r, 300));
        const navScrolled = document.getElementById('navbar').classList.contains('is-scrolled') && !navTop;
        const invite = document.querySelector('.lp-invite-title')?.textContent;
        const also = document.querySelectorAll('.lp-also p').length;
        const oldCards = document.querySelectorAll('.landing-feature, .landing-stage, .landing-try').length;
        return { words, machine, invite, also, oldCards, items: items.length, active: document.querySelector('.landing-tour-frame video.active')?.dataset.tour,
            selected: items[1]?.getAttribute('aria-selected'), navScrolled };
    });
    check('landing: headline words, a roll ready in the hero with a cover showing, tour switches clips (the player included)',
        landing.words === 6 && landing.machine.window && landing.machine.ready && landing.items === 4 && landing.active === 'calendar' && landing.selected === 'true', landing);
    check('landing: nav frosted once scrolled; Watch Party as an invite, two plain lines for the rest, no old cards',
        landing.navScrolled && landing.invite === 'Mika is hosting a Watch Party' && landing.also === 2 && landing.oldCards === 0, landing);
    // The roll stops exactly on the winner: every cover is the window's size, none of the next one shows
    const tryRoll = await fresh.evaluate(async () => {
        const btn = document.getElementById('try-roll');
        btn.click();
        for (let i = 0; i < 80 && btn.textContent !== 'Roll again'; i++) await new Promise(r => setTimeout(r, 100));
        const win = document.getElementById('try-window').getBoundingClientRect();
        const items = [...document.querySelectorAll('#try-reel .roll-item')].map(el => el.getBoundingClientRect());
        const last = items[items.length - 1];
        return { done: btn.textContent === 'Roll again', items: items.length, offset: Math.abs(last.top - win.top),
            sizes: items.every(r => Math.abs(r.height - win.height) < 0.5) };
    });
    check('landing: the roll stops on one whole cover, each cover the window’s size',
        tryRoll.done && tryRoll.items > 3 && tryRoll.offset < 0.5 && tryRoll.sizes, tryRoll);
    // Material 3 only: shaped tiles with trending covers, the colour section with its clip, no design switch
    const m3landing = await fresh.evaluate(() => ({ design: document.documentElement.dataset.design, tiles: document.querySelectorAll('.lp-tile').length,
        colour: document.querySelector('.lp-colour video')?.getAttribute('src'), tryDesign: !!document.querySelector('[data-try-design], .landing-designs') }));
    // The colour shapes: the page in that palette for a look, nothing stored, back with "From the show"
    const palette = await fresh.evaluate(async () => {
        const primary = () => getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim();
        const before = primary();
        document.querySelector('[data-preview-seed="#006a6a"]').click();
        await new Promise(r => setTimeout(r, 1200));
        const picked = primary();
        const pressed = document.querySelector('[data-preview-seed="#006a6a"]').getAttribute('aria-pressed');
        const stored = localStorage.getItem('aniroll_m3_seed');
        document.querySelector('[data-preview-seed=""]').click();
        await new Promise(r => setTimeout(r, 1200));
        return { before, picked, pressed, stored, after: primary() };
    });
    check('landing: a colour shape turns the page into its palette, keeps nothing, and goes back',
        palette.picked !== palette.before && palette.pressed === 'true' && palette.stored === null && palette.after === palette.before, palette);
    check('landing: Material 3 only, shapes behind the roll, the colours section, no design switch',
        m3landing.design === 'm3' && m3landing.tiles === 2 && m3landing.colour === 'media/m3.mp4' && !m3landing.tryDesign, m3landing);
    await fresh.close();

    // Confirmed today's entry before it grew: its new id brings it back, on its own
    const grown = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: '2026-09-25', aniroll_design_v2: 'aniroll' });
    const grownHeads = await grown.evaluate(() => [...document.querySelectorAll('.whatsnew .whatsnew-heading')].map(h => h.textContent));
    check("a day's entry that grew after going live pops up again", grownHeads[0]?.startsWith('Roll recommendations'), grownHeads);

    // Confirmed the first release of a day: the pop-up shows only what the later releases added
    const today = (fs.readFileSync(path.join(ROOT, 'js', 'whatsnew.js'), 'utf8').match(/id: '(\d{4}-\d\d-\d\d)\.\d+'/) || [])[1];
    if (today) {
        const later = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: today, aniroll_design_v2: 'aniroll' });
        const shown = await later.evaluate(() => [...document.querySelectorAll('.whatsnew .whatsnew-list li')].map(li => li.textContent));
        check('a day confirmed earlier shows only the items added since', shown.length >= 1 && !shown.some(t => /^The player answers every key/.test(t)), shown);
        await later.close();
    }
    check('logged out: always Material 3, even with the legacy design chosen', await grown.evaluate(() => document.documentElement.dataset.design === 'm3' && !!document.querySelector('#m3-css')));
    await grown.close();

    const late = await visitor({ aniroll_theme: 'dark' }, new Date(2026, 10, 1, 9, 0));
    const lateNotice = await late.evaluate(() => ({ title: document.querySelector('.whatsnew .modal-title')?.textContent, demo: !!document.querySelector('.whatsnew-demo'),
        headings: [...document.querySelectorAll('.whatsnew .whatsnew-heading')].map(h => h.textContent) }));
    check('from November: still a pop-up, with changelog wording and without the tab animation',
        lateNotice.title === 'A few things changed' && !lateNotice.demo && lateNotice.headings[0] === 'Navigation and calendar', lateNotice);
    const unread = await late.evaluate(() => document.documentElement.classList.contains('whatsnew-unread') && getComputedStyle(document.querySelector('.landing-foot .whatsnew-link'), '::after').content !== 'none');
    await late.click('.whatsnew [data-close]');
    await late.clock.runFor(300);
    await late.click('.landing-foot .whatsnew-link');
    await late.clock.runFor(500);
    const log = await late.evaluate(() => ({ hash: location.hash, title: document.querySelector('.whatsnew-page h1')?.textContent, entries: document.querySelectorAll('.whatsnew-page .whatsnew-entry').length,
        back: document.querySelector('.whatsnew-back')?.textContent.trim(), dialog: !!document.querySelector('[aria-modal="true"]'), unread: document.documentElement.classList.contains('whatsnew-unread') }));
    check('changelog: still there, marked unread, opens as its own page with all entries and the version',
        unread && log.hash === '#/whatsnew' && /^What's new AniRoll \d+(\.\d+){2,3}$/.test(log.title || '') && log.entries === CHANGE_COUNT && !log.dialog && !log.unread, { unread, ...log });
    await late.click('.whatsnew-back');
    await late.clock.runFor(500);
    const backTo = await late.evaluate(() => ({ hash: location.hash || '#/', landing: !!document.querySelector('.landing-foot') }));
    check("changelog: 'Back' returns to the page it was opened from", backTo.hash === '#/' && backTo.landing && log.back === 'Back to Home', { back: log.back, ...backTo });

    // An entry with a clip: it sits behind "See it in action"; opening it widens the dialog
    const clipped = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: '2026-09-26' });
    const teaser = await clipped.evaluate(() => ({ heads: [...document.querySelectorAll('.whatsnew .whatsnew-heading')].map(h => h.textContent), teaser: !!document.querySelector('.whatsnew-watch') }));
    await clipped.click('.whatsnew-watch');
    await clipped.waitForTimeout(700);
    const played = await clipped.evaluate(() => ({ wide: document.querySelector('.whatsnew').classList.contains('is-wide'), video: document.querySelector('.whatsnew-video')?.getAttribute('src'),
        width: Math.round(document.querySelector('.whatsnew').getBoundingClientRect().width) }));
    check("what's new: today's clip behind 'See it in action', the dialog widens to play it",
        teaser.heads.some(h => h.startsWith('A new Home')) && teaser.teaser && played.wide && played.video === 'media/design-aniroll.mp4' && played.width > 600, { ...teaser, ...played });
    await clipped.close();
    await late.close();

    };

    // Checks kept out of the published source, when present
    const extra = path.join(__dirname, 'private.js');
    if (fs.existsSync(extra)) groups.private = () => require(extra)({ browser, base, check, respond, VIEWER, errors, idle });

    // The groups share nothing but the browser: several run at once, each in its own tabs (E2E_WORKERS,
    // default 3). E2E_ONLY=player,private runs just those (handy while working on one part; the deploy
    // always runs everything). The longest go first.
    const only = (process.env.E2E_ONLY || '').split(',').map(x => x.trim()).filter(Boolean);
    const unknown = only.filter(n => !groups[n]);
    if (unknown.length) throw new Error(`E2E_ONLY: no group ${unknown.join(', ')} (there are ${Object.keys(groups).join(', ')})`);
    const order = ['player', 'main', 'misc', 'private', 'discover', 'seats', 'party'].filter(n => groups[n] && (!only.length || only.includes(n)));
    let next = 0;
    await Promise.all(Array.from({ length: Math.max(1, Number(process.env.E2E_WORKERS) || 3) }, async () => {
        while (next < order.length) {
            const name = order[next++];
            try { await groups[name](); } catch (e) { check(`${name}: the group runs to its end`, false, e.stack || e.message); }
        }
    }));

    check('no errors on any page', !errors.length, errors.join('\n      '));
    await browser.close();
    server.close();
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
