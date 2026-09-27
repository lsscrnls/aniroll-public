// Logged-in browser checks: every page with a (fake) AniList login against the mock in mock.js.
// Catches what the API checks cannot: errors in page code, and the keyboard/click behaviour of v79.
//   cd tools/e2e && npm ci && npx playwright install chromium && node run.js
// CHROMIUM_PATH picks a browser binary (defaults to Playwright's own). Runs in CI as the "browser" job.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { respond, VIEWER } = require('./mock');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

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
    await page.click('.design-option[data-design="m3"]');
    await page.waitForTimeout(1500);
    const m3 = await page.evaluate(() => ({
        attr: document.documentElement.dataset.design,
        css: !!document.querySelector('link#m3-css'),
        primary: getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim(),
        font: getComputedStyle(document.body).fontFamily,
        variantShown: !document.getElementById('m3-variant').hidden,
    }));
    check('design: Material 3 Expressive applies (stylesheet, generated palette, Google Sans Flex)',
        m3.attr === 'm3' && m3.css && /^(#[0-9a-f]{6}|rgb\()/.test(m3.primary) && m3.font.includes('Google Sans Flex') && m3.variantShown, m3);
    await page.click('[data-variant="vibrant"]');
    await page.waitForTimeout(800);
    const vibrant = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim());
    check('design: colour style changes the palette', /^(#[0-9a-f]{6}|rgb\()/.test(vibrant) && vibrant !== m3.primary, { tonal: m3.primary, vibrant });
    await page.click('.design-option[data-design="aniroll"]');
    await page.waitForTimeout(300);
    const off = await page.evaluate(() => ({ attr: document.documentElement.dataset.design || null, css: !!document.querySelector('link#m3-css') }));
    check('design: back to AniRoll removes it again', off.attr === null && !off.css, off);
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
        (await dialogTitle(back)) === 'A few things changed' && both[0] === 'A few things moved' && both.length === 5 && both[2].startsWith('Roll recommendations') && both[3].startsWith('Material 3') && both[4].startsWith('A new Home'), both);
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
    check('returning visitor who confirmed the move: only what came after, no tab animation', only.title === 'A few things changed' && !only.demo && only.sections === 4, only);
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
    check('landing: headline words, stage clip, tour switches clips',
        landing.words === 4 && landing.stage === 'media/roll.mp4' && landing.items === 3 && landing.active === 'calendar' && landing.selected === 'true', landing);
    check('landing: nav frosted once scrolled; more-cards only for what the clips do not show',
        landing.navScrolled && landing.cards === 'Watch Party,Jellyfin Live Tracking,Social Feed', landing);
    const designs = await fresh.evaluate(() => [...document.querySelectorAll('.landing-designs video')].map(v => v.getAttribute('src')).join());
    check('landing: both designs presented, each with its clip', designs === 'media/design-aniroll.mp4,media/design-m3.mp4', designs);
    await fresh.evaluate(() => document.querySelector('.landing-designs').scrollIntoView({ block: 'center' }));
    await fresh.click('[data-try-design="m3"]');
    await fresh.waitForTimeout(1500);
    const tried = await fresh.evaluate(() => ({ design: document.documentElement.dataset.design, stored: localStorage.getItem('aniroll_design'),
        pressed: document.querySelector('[data-try-design="m3"]').getAttribute('aria-pressed') }));
    await fresh.click('[data-try-design="aniroll"]');
    await fresh.waitForTimeout(1200);
    const untried = await fresh.evaluate(() => document.documentElement.dataset.design || null);
    check('landing: "Try this look" switches to Material 3 and back, logged out', tried.design === 'm3' && tried.stored === 'm3' && tried.pressed === 'true' && untried === null, { ...tried, untried });
    await fresh.close();

    // Confirmed today's entry before it grew: its new id brings it back, on its own
    const grown = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: '2026-09-25', aniroll_design: 'm3' });
    const grownHeads = await grown.evaluate(() => [...document.querySelectorAll('.whatsnew .whatsnew-heading')].map(h => h.textContent));
    check("a day's entry that grew after going live pops up again", grownHeads[0]?.startsWith('Roll recommendations'), grownHeads);
    check('logged out: the chosen design applies (visitors can try Material 3 on the landing page)', await grown.evaluate(() => document.documentElement.dataset.design === 'm3' && !!document.querySelector('#m3-css')));
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
    check('changelog: still there, marked unread, opens with all entries', unread && log.title === "What's new" && log.entries === 5, { unread, ...log });

    // Today's entry on its own: its clip sits behind "See it in action"; opening it widens the dialog
    const clipped = await visitor({ aniroll_theme: 'dark', aniroll_seen_changes: '2026-09-26' });
    const teaser = await clipped.evaluate(() => ({ title: document.querySelector('.whatsnew .modal-title')?.textContent, teaser: !!document.querySelector('.whatsnew-watch') }));
    await clipped.click('.whatsnew-watch');
    await clipped.waitForTimeout(700);
    const played = await clipped.evaluate(() => ({ wide: document.querySelector('.whatsnew').classList.contains('is-wide'), video: document.querySelector('.whatsnew-video')?.getAttribute('src'),
        width: Math.round(document.querySelector('.whatsnew').getBoundingClientRect().width) }));
    check("what's new: today's clip behind 'See it in action', the dialog widens to play it",
        teaser.title?.startsWith('A new Home') && teaser.teaser && played.wide && played.video === 'media/design-aniroll.mp4' && played.width > 600, { ...teaser, ...played });
    await clipped.close();
    await late.close();

    check('no errors on any page', !errors.length, errors.join('\n      '));
    await browser.close();
    server.close();
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
