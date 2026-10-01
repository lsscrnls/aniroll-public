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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };

let failed = 0;
function check(name, ok, detail) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}`);
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
    // Wide enough for the wider Discover pages to show
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const errors = [];
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
    await page.route(/cdn|googleapis|gstatic/, route => route.abort());
    await page.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        // The one-time "things moved" notice is tested on its own below
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);

    const settle = async (ms = 900) => {
        await page.waitForTimeout(ms);
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

    // Settings: four tabs, ?tab= opens one, the design switch loads Material 3 Expressive and back
    await go('#/settings?tab=jellyfin');
    const settings = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('[data-settings-tab]')].map(b => b.textContent).join(','),
        visible: [...document.querySelectorAll('.settings-panel')].filter(p => !p.hidden).map(p => p.id).join(','),
    }));
    check('settings: tabs Appearance, Lists, Watch Party, Jellyfin; ?tab= opens one',
        settings.tabs === 'Appearance,Lists,Watch Party,Jellyfin' && settings.visible === 'settings-jellyfin', settings);
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
    }
    const card = await page.$('.list-card[data-open], .list-entry-title[data-open]');
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
    check("accounts: another account never gets this one's cached answers or queued saves",
        isolation.separate && isolation.reused && isolation.countA === 2 && isolation.countB === 1, isolation);

    // Watch Party as a guest: the invite link shows the host's party, joining starts the sync; then the
    // host's own view. Runs against the obfuscated build too (scripts/deploy.sh), where joining once broke
    const wp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    wp.on('pageerror', e => errors.push(`watch party: ${e.message}`));
    const party = { hostName: 'Hosty', mediaId: 21, mediaTitle: 'One Piece', active: true, members: [], hostProgress: 3, hostProgressAt: Date.now(), startedAt: Date.now(), startEp: 2 };
    await wp.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
    await wp.route(`${base}/api/**`, route => {
        const p = new URL(route.request().url()).pathname;
        if (p.startsWith('/api/party/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(party) });
        route.fulfill({ status: p === '/api/maintenance' ? 200 : 404, contentType: 'application/json', body: '{"maintenance":false}' });
    });
    await wp.route(/cdn|googleapis|gstatic/, route => route.abort());
    await wp.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);
    const wpText = () => wp.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
    await wp.goto(base + '/#/watchparty?host=Hosty&anime=21');
    await wp.waitForTimeout(3000);
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
    Object.assign(party, { hostName: VIEWER.name, hostKey: 'k' });
    await wp.evaluate(n => {
        localStorage.setItem('aniroll_watchparty', JSON.stringify({ hostName: n, mediaId: 21, hostKey: 'k', mediaTitle: 'One Piece', startEp: 2 }));
        location.hash = `/watchparty?host=${n}&anime=21`;
    }, VIEWER.name);
    await wp.waitForTimeout(3000);
    const hosting = await wpText();
    check("watch party: the host's view with its episode counter", /You are the host/.test(hosting) && /EPISODE COUNTER/i.test(hosting), hosting.slice(0, 160));
    await wp.close();

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
    await nx.route(/cdn|googleapis|gstatic/, route => route.abort());
    await nx.addInitScript(({ id, name }) => {
        localStorage.setItem('aniroll_token', 'e2e-token');
        localStorage.setItem('aniroll_user', JSON.stringify({ id, name, avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
        localStorage.setItem('aniroll_user_ts', String(Date.now()));
        localStorage.setItem('aniroll_seen_changes', '9999');
    }, VIEWER);
    const nxGo = async (hash) => { await nx.evaluate(h => { localStorage.removeItem('aniroll_req_times'); location.hash = h; }, hash); await nx.waitForTimeout(2500); };
    await nx.goto(base + '/#/');
    await nx.waitForTimeout(3000);
    const soon = await nx.evaluate(() => ({ shown: !document.getElementById('starting-soon')?.hidden,
        text: document.querySelector('#starting-soon-row .starting-soon-when')?.textContent.replace(/\s+/g, ' ').trim() }));
    check('home: a planned show that premieres soon, with its date', soon.shown && /^Episode 1 in 8d/.test(soon.text || ''), soon);

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
    await nx.waitForTimeout(2500);
    const studio = await nx.evaluate(() => ({ hash: location.hash, title: document.getElementById('studio-title')?.textContent.trim(),
        cards: document.querySelectorAll('#studio-grid .media-card').length, discover: document.querySelector('.nav-links [data-page="discover"]')?.classList.contains('active') }));
    // From the side panel: the studio page opens and the panel goes
    await nx.evaluate(() => window.__openDetailPanel(101));
    await nx.waitForTimeout(2500);
    await nx.click('#detail-panel-overlay .detail-studio');
    await nx.waitForTimeout(2000);
    const fromPanel = await nx.evaluate(() => ({ hash: location.hash, panelOpen: document.getElementById('detail-panel-overlay').classList.contains('open') }));
    check('detail panel: a studio card opens the studio page and closes the panel', /^#\/studio\//.test(fromPanel.hash) && !fromPanel.panelOpen, fromPanel);
    check('studio page: its name and its anime, under Discover', /^#\/studio\/\d+$/.test(studio.hash) && !!studio.title && studio.cards > 0 && studio.discover, studio);
    await nx.close();

    // Jellyfin player. A page logged in to AniList and to Jellyfin (a friend's sign-in, not an API key)
    async function playerPage(jellyfinUp, signedIn = true) {
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
        await p.route(/cdn|googleapis|gstatic/, route => route.abort());
        // The stack switched off: every request to Jellyfin fails the way a dead host does
        const calls = jellyfinUp ? await mockJellyfin(p) : [];
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
        await p.waitForTimeout(2500);
        const msg = await p.evaluate(() => document.getElementById('player-status')?.textContent.trim());
        check('player, Jellyfin off: #/play says the server cannot be reached', /cannot be reached/.test(msg || ''), msg);
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
            eps.rows === 12 && /^#\/play\/\d+\/2$/.test(eps.next || '') && eps.watched && eps.started && /\/Items\/ep1\/Images\/Primary/.test(eps.thumb)
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
        await p.click('.pl-skip-segment').catch(() => {});
        await p.waitForTimeout(400);
        const skipped = await p.evaluate(() => ({ t: document.getElementById('player-video').currentTime, hidden: document.querySelector('.pl-skip-segment').hidden }));
        check('player: Skip intro from the media segments, jumps past it', skip.shown && skip.text === 'Skip intro' && skipped.t >= 6.9 && skipped.hidden, { skip, skipped });

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

        // Up next: from the last seconds a card counts down; Cancel keeps the episode, going back and
        // forward brings it again, Play now opens the next one. Halfway, the next subtitles are unpacked ahead
        await p.evaluate(h => { location.hash = h; }, playHash);
        await p.waitForTimeout(2500);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.6; v.play(); });
        await p.waitForTimeout(800);
        const upNext = await p.evaluate(() => ({ shown: !document.querySelector('.pl-next').hidden,
            title: document.querySelector('.pl-next-title').textContent, label: document.querySelector('.pl-next-label').textContent }));
        await p.click('[data-act="cancelNext"]');
        const cancelled = await p.evaluate(() => document.querySelector('.pl-next').hidden);
        // Watched the credits to the end: the card asks once more instead of leaving at once
        await p.waitForTimeout(1800);
        const atEnd = await p.evaluate(() => ({ ended: document.getElementById('player-video').ended, shown: !document.querySelector('.pl-next').hidden, hash: location.hash }));
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 5; });
        await p.waitForTimeout(400);
        await p.evaluate(() => { const v = document.getElementById('player-video'); v.currentTime = 18.6; v.play(); });
        await p.waitForTimeout(800);
        const again = await p.evaluate(() => !document.querySelector('.pl-next').hidden);
        await p.click('[data-act="playNext"]');
        await p.waitForTimeout(2500);
        const moved = await p.evaluate(() => location.hash);
        const askedOnUpNext = await p.evaluate(() => !!document.querySelector('.pl-resume'));
        check('player: Up next counts down from the end, Watch credits hides it until the very end, Play now opens the next episode, its subtitles warmed',
            upNext.shown && upNext.title === 'Episode 3' && /^Play now · \d+$/.test(upNext.label) && cancelled
            && atEnd.ended && atEnd.shown && /\/2$/.test(atEnd.hash) && again
            && /\/3$/.test(moved) && calls.some(c => c.type === 'PlaybackInfo' && c.item === 'ep3') && calls.some(c => c.type === 'vtt' && c.item === 'ep3')
            && !askedOnUpNext, { upNext, cancelled, atEnd, again, moved, askedOnUpNext });

        // Styled ASS: drawn by JASSUB on its canvas with the MKV's fonts, listed in the menu
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/3'));
        await p.waitForTimeout(4000);
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
        await p.waitForTimeout(3500);
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
        await p.waitForTimeout(3000);
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
        await p.waitForTimeout(3000);
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
        await p.waitForTimeout(2500);
        const dubbed = await p.evaluate(() => ({ time: document.getElementById('player-video').currentTime,
            pref: JSON.parse(localStorage.getItem('aniroll_audio_pref') || '{}') }));
        const asked = calls.filter(c => c.type === 'PlaybackInfo' && c.item === 'ep6').map(c => c.audio);
        await p.mouse.move(600, 500);
        await p.click('[data-act="subs"]').catch(() => {});
        await p.waitForTimeout(300);
        const checkedAfter = await p.evaluate(() => document.querySelector('[data-audio][aria-checked="true"]')?.dataset.audio);
        await p.keyboard.press('Escape');
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/7'));
        await p.waitForTimeout(3000);
        const nextAsked = calls.filter(c => c.type === 'PlaybackInfo' && c.item === 'ep7').map(c => c.audio);
        const reportedAudio = calls.filter(c => c.type === 'Playing' && c.body?.ItemId === 'ep7').map(c => c.body.AudioStreamIndex);
        check('player: audio tracks in the menu, switching asks Jellyfin for that track from the same spot, the show remembers the dub',
            audioMenu.titles.join() === 'Audio,Subtitles' && audioMenu.audio.join('|') === 'Japanese - Opus - Stereo:true|English - Opus - Stereo:false'
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
        await p.waitForTimeout(2500);
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

        // The server cannot convert (graphics card full): a clear message, no endless spinner, the conversion ended
        await p.evaluate(h => { location.hash = h; }, playHash.replace(/\/2$/, '/5'));
        await p.waitForTimeout(3500);
        const failed = await p.evaluate(() => ({ text: document.getElementById('player-status')?.textContent.trim(), error: document.getElementById('player-status')?.classList.contains('error') }));
        const segTries = calls.filter(c => c.type === 'segment').length;
        check('player: a failed conversion says so at once (no endless retrying), with Try again',
            failed.error && /could not convert/.test(failed.text || '') && /Try again/.test(failed.text || '') && segTries <= 2, { ...failed, segTries });
        check('player: no errors', !pageErrors.length, pageErrors);
        await p.close();
    }

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
                    anilist: { verifyPausedFor: 0 }, errors: { count: 0, latest: [] }, server: { uptime: 60000, rss: 1e8, node: 'v24' } }) });
            }
            if (p !== '/api/seat') return route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' });
            seatCalls.push({ method: route.request().method(), auth: route.request().headers().authorization || '' });
            const posts = seatCalls.filter(c => c.method === 'POST').length;
            const body = posts <= 2 ? { seat: false, position: posts === 1 ? 3 : 1, waiting: 3, max: 100 } : { seat: true, vip: false, max: 100 };
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        await sq.route(/cdn|googleapis|gstatic/, route => route.abort());
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
            online: document.querySelector('#adm-online')?.textContent || '', letIn: !!document.querySelector('[data-let-in]') }));
        check('admin: the owner sees tiles, four charts, who is online and who waits',
            adminView && adminPage.tiles === 6 && adminPage.charts === 4 && /tester/.test(adminPage.online) && adminPage.letIn, { adminView, ...adminPage });
        await sq.evaluate(() => import('/js/auth.js?v=124').then(m => m.logout()));
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
        await na.route(/cdn|googleapis|gstatic/, route => route.abort());
        await na.addInitScript(() => {
            localStorage.setItem('aniroll_token', 'e2e-token');
            localStorage.setItem('aniroll_user', JSON.stringify({ id: 1, name: 'someone', avatar: { medium: '' }, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }));
            localStorage.setItem('aniroll_user_ts', String(Date.now()));
            localStorage.setItem('aniroll_seen_changes', '9999');
        });
        await na.goto(base + '/#/admin');
        await na.waitForTimeout(2500);
        const other = await na.evaluate(() => ({ link: document.getElementById('admin-link')?.hidden, text: document.querySelector('.adm-page')?.textContent || '',
            tiles: document.querySelectorAll('.adm-tile').length }));
        check('admin: no link and no numbers for anyone but the owner', other.link === true && /only for AniRoll/.test(other.text) && !other.tiles, other);
        await na.close();
    }

    // "Reduce motion": no smooth scrolling (Lenis marks <html>), no cards flying in, no count-up
    const calm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await calm.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
    await calm.route(`${base}/api/**`, route => route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' }));
    await calm.route(/cdn|googleapis|gstatic/, route => route.abort());
    await calm.goto(base + '/#/');
    await calm.waitForTimeout(1500);
    const motion = await calm.evaluate(() => ({
        lenis: document.documentElement.classList.contains('lenis'),
        hiddenCards: [...document.querySelectorAll('.media-card, .landing-feature')].filter(el => getComputedStyle(el).opacity !== '1').length,
        transition: getComputedStyle(document.querySelector('.glass-btn') || document.body).transitionDuration,
    }));
    check('reduced motion: no smooth scrolling, no fly-in, no transitions',
        !motion.lenis && motion.hiddenCards === 0 && motion.transition.split(',').every(t => parseFloat(t) < 0.001), motion);
    const normal = await page.evaluate(() => document.documentElement.classList.contains('lenis'));
    check('without the setting smooth scrolling stays on', normal);
    await calm.close();

    // "What's new": returning visitors get everything they have not confirmed, on every visit until "Got it";
    // new visitors never get a pop-up
    async function visitor(storage, time) {
        const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        if (time) await p.clock.install({ time });
        await p.route('https://graphql.anilist.co/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(route.request().postDataJSON())) }));
        await p.route(`${base}/api/**`, route => route.fulfill({ contentType: 'application/json', body: '{"maintenance":false}' }));
        await p.route(/cdn|googleapis|gstatic/, route => route.abort());
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
        (await dialogTitle(back)) === 'A few things changed' && both[0] === 'A few things moved' && both.length === 8 && both[2].startsWith('Roll recommendations') && both[3].startsWith('Material 3') && both[4].startsWith('A new Home') && both[5].startsWith('Starting soon') && both[6].startsWith('Material 3 for everyone') && both[7].startsWith('Browse by tag'), both);
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
    check('returning visitor who confirmed the move: only what came after, no tab animation', only.title === 'A few things changed' && !only.demo && only.sections === 7, only);
    await confirmed.close();

    const fresh = await visitor({});
    check('new visitor: no notice', (await dialogTitle(fresh)) === null);
    // Landing: headline in words, the big clip, a tour whose tabs switch the clip
    const landing = await fresh.evaluate(async () => {
        const words = document.querySelectorAll('.landing-title .lw').length;
        const stage = document.querySelector('.landing-stage video')?.getAttribute('src');
        const items = [...document.querySelectorAll('.landing-tour-item')];
        items[1]?.click();
        const navTop = document.getElementById('navbar').classList.contains('is-scrolled');
        window.scrollTo(0, 400);
        await new Promise(r => setTimeout(r, 300));
        const navScrolled = document.getElementById('navbar').classList.contains('is-scrolled') && !navTop;
        const cards = [...document.querySelectorAll('.landing-feature-title')].map(e => e.textContent).join(',');
        return { words, stage, items: items.length, active: document.querySelector('.landing-tour-frame video.active')?.dataset.tour,
            selected: items[1]?.getAttribute('aria-selected'), navScrolled, cards };
    });
    check('landing: headline words, stage clip, tour switches clips (the player included)',
        landing.words === 6 && landing.stage === 'media/roll.mp4' && landing.items === 4 && landing.active === 'calendar' && landing.selected === 'true', landing);
    check('landing: nav frosted once scrolled; more-cards only for what the clips do not show',
        landing.navScrolled && landing.cards === 'Watch Party,Jellyfin Live Tracking,Social Feed', landing);
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
    check('landing: Material 3 only, shaped cover tiles, the colours section, no design switch',
        m3landing.design === 'm3' && m3landing.tiles === 6 && m3landing.colour === 'media/m3.mp4' && !m3landing.tryDesign, m3landing);
    await fresh.close();

    // Confirmed today's entry before it grew: its new id brings it back, on its own
    const grown = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: '2026-09-25', aniroll_design_v2: 'aniroll' });
    const grownHeads = await grown.evaluate(() => [...document.querySelectorAll('.whatsnew .whatsnew-heading')].map(h => h.textContent));
    check("a day's entry that grew after going live pops up again", grownHeads[0]?.startsWith('Roll recommendations'), grownHeads);
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
    const log = await late.evaluate(() => ({ title: document.querySelector('.whatsnew .modal-title')?.textContent, entries: document.querySelectorAll('.whatsnew-entry').length }));
    check('changelog: still there, marked unread, opens with all entries', unread && log.title === "What's new" && log.entries === 8, { unread, ...log });

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

    // Checks kept out of the published source, when present
    const extra = path.join(__dirname, 'private.js');
    if (fs.existsSync(extra)) await require(extra)({ browser, base, check, respond, VIEWER, errors });

    check('no errors on any page', !errors.length, errors.join('\n      '));
    await browser.close();
    server.close();
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
