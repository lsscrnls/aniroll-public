// Stills and clips of AniRoll for the README and the landing page, logged in as the made-up demo account
// (demo.js). Run through run.sh, which also turns the clip frames into video. Pass names to redo only some:
//   tools/showcase/run.sh roll calendar
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const demo = require('./demo');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.OUT || path.join(__dirname, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv.slice(2);
const want = n => !only.length || only.includes(n);

function staticServer() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, url === '/' ? 'index.html' : url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
    await demo.init();
    const server = await staticServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    // GPU=1 (run.sh, when Docker has the NVIDIA runtime): render through the real GPU via ANGLE/EGL
    const browser = await chromium.launch(process.env.GPU
        ? { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl'] } : {});
    console.log('rendering on', process.env.GPU ? 'the GPU' : 'the CPU (software)');
    fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true });

    async function context({ loggedIn = true, mobile = false, size = { width: 1440, height: 900 }, design = 'aniroll' } = {}) {
        const ctx = await browser.newContext(mobile
            ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' }
            : { viewport: size, colorScheme: 'dark' });
        await ctx.addInitScript(([user, li, design]) => {
            localStorage.setItem('aniroll_theme', 'dark');
            localStorage.setItem('aniroll_design', design);

            // Clips must never show a cover arriving late: every image loads right away, not when scrolled to
            new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                (n.tagName === 'IMG' ? [n] : n.querySelectorAll('img[loading="lazy"]')).forEach(img => { img.loading = 'eager'; });
            }))).observe(document, { childList: true, subtree: true });
            localStorage.setItem('aniroll_seen_changes', '9999');
            if (!localStorage.getItem('aniroll_roll_filters')) localStorage.setItem('aniroll_roll_filters', JSON.stringify({ withRecs: true }));
            localStorage.removeItem('aniroll_req_times');
            if (li) {
                localStorage.setItem('aniroll_token', 'demo');
                localStorage.setItem('aniroll_user', JSON.stringify(user));
                localStorage.setItem('aniroll_user_ts', String(Date.now()));
            }
        }, [{ ...demo.VIEWER, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }, loggedIn, design]);
        await ctx.route('https://graphql.anilist.co/**', async route => {
            let body;
            try { body = await demo.respond(route.request().postDataJSON()); } catch (e) { body = { errors: [{ message: e.message }] }; console.log('demo:', e.message); }
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        await ctx.route(`${base}/api/**`, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
        await ctx.route(/kitsu\.io/, r => r.abort());
        return ctx;
    }

    // Finish running tweens; for stills also drop the cursor dot, toasts and floating buttons
    const settle = (page, still) => page.evaluate(still => {
        if (window.gsap) gsap.globalTimeline.getChildren(true, true, true).forEach(t => t.progress(1));
        document.getAnimations().forEach(a => { try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* */ } });
        document.querySelectorAll('.toast').forEach(t => t.remove());
        // The demo account's feed is invented placeholder data, not worth showing
        document.getElementById('popular-friends-row')?.closest('section')?.remove();
        document.querySelectorAll('.wp-fab, .compare-fab').forEach(el => el.remove());
        if (!still) return;
        document.getElementById('cursor')?.remove();
        document.getElementById('roll-friends')?.remove();
    }, still);

    async function still(page, name, ms = 4000) {
        await wait(ms);
        await settle(page, true); await wait(400); await settle(page, true);
        await page.screenshot({ path: path.join(OUT, 'stills', `${name}.png`) });
        console.log('still', name);
    }

    // Records the page while `act` runs: every painted frame with its timestamp, for ffmpeg's concat demuxer
    async function clip(page, name, act) {
        const dir = path.join(OUT, 'clips', name);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const cdp = await page.context().newCDPSession(page);
        // Ack first, then write the frame straight to disk: holding ~200 KB strings per frame in memory made
        // Node stop for garbage collection every few seconds, the acks came late and the video got holes
        const frames = [];
        const writes = [];
        cdp.on('Page.screencastFrame', f => {
            cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
            const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
            frames.push({ ts: f.metadata.timestamp, file });
            writes.push(fs.promises.writeFile(path.join(dir, file), Buffer.from(f.data, 'base64')));
        });
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: 1280, maxHeight: 720 });
        await act();
        await cdp.send('Page.stopScreencast');
        await wait(200);
        await Promise.all(writes);
        const lines = [];
        frames.forEach((f, i) => {
            const next = frames[i + 1]?.ts ?? f.ts + 0.6; // hold the last frame a moment
            lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`);
        });
        lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
        fs.writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n') + '\n');
        console.log('clip', name, frames.length, 'frames');
    }

    // Never click into something half loaded: wait until every image on screen has arrived
    const imagesReady = (page, timeout = 10000) => page.waitForFunction(() => [...document.images]
        .filter(img => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0; })
        .every(img => img.complete && img.naturalWidth > 0), null, { timeout }).catch(() => console.log('images still loading'));

    // Moves the (custom) cursor to an element in a smooth line, like a person would
    let mouse = { x: 700, y: 500 };
    async function glide(page, selector, { steps = 30, click = false } = {}) {
        const box = await page.locator(selector).first().boundingBox({ timeout: 8000 }).catch(() => null);
        if (!box) {
            await page.screenshot({ path: path.join(OUT, 'debug.png') });
            throw new Error('not found: ' + selector + ' (screenshot: out/debug.png)');
        }
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            await page.mouse.move(mouse.x + (x - mouse.x) * e, mouse.y + (y - mouse.y) * e);
            await wait(12);
        }
        mouse = { x, y };
        if (click) {
            await imagesReady(page);
            await page.evaluate(() => localStorage.removeItem('aniroll_req_times'));
            await page.mouse.down(); await wait(90); await page.mouse.up();
        }
    }

    // Clips: 1440×810 (16:9, room for two rows of cards), scaled to 1280×720 by run.sh
    const page = await (await context({ size: { width: 1440, height: 810 } })).newPage();
    page.on('pageerror', e => console.log('pageerror', e.message));
    // A hash change doesn't reload, so the app's own request budget (20/min) carries over: reset it
    const go = async (hash, ms = 5000) => {
        await page.goto(base + '/#' + hash);
        await page.evaluate(() => localStorage.removeItem('aniroll_req_times'));
        await wait(ms);
        await settle(page, false);
    };

    if (want('roll')) {
        await go('/roll', 7000);
        await page.mouse.move(mouse.x, mouse.y);
        await clip(page, 'roll', async () => {
            await wait(500);
            await glide(page, '#roll-btn', { click: true });
            await wait(5200);
            await glide(page, '#roll-result .glass-btn-primary', { steps: 40 });
            await wait(1200);
        });
    }
    if (want('calendar')) {
        await go('/calendar', 6000);
        // Load All Airing and the month once, so nothing in the clip waits for data
        for (const label of ['All Airing', 'Month', 'Week', 'My List']) {
            await page.click(`button:text-is("${label}")`);
            await wait(2500); await imagesReady(page);
        }
        await page.evaluate(() => localStorage.removeItem('aniroll_req_times'));
        await clip(page, 'calendar', async () => {
            await wait(600);
            await glide(page, 'button:text-is("All Airing")', { click: true });
            await wait(800); await imagesReady(page);
            await wait(2200);
            await glide(page, 'button:text-is("Month")', { click: true });
            await wait(2500);
            await glide(page, 'button:text-is("Week")', { click: true });
            await wait(1500);
        });
    }
    if (want('match')) {
        await go('/', 8000);
        // Warm the detail query, so the panel opens with data instead of a spinner
        await page.evaluate(() => {
            const card = document.querySelector('#recommendations-row > div:nth-child(2) [data-open], #recommendations-row > div:nth-child(2) .media-card');
            const id = Number(card?.dataset.open || card?.dataset.id || card?.querySelector('[data-open]')?.dataset.open);
            if (id) { window.__openDetailPanel(id); }
        });
        await wait(5000);
        await page.keyboard.press('Escape');
        await wait(800);
        // Home opens on the show you're on: the recommendations sit further down
        await page.evaluate(() => { const r = document.getElementById('recommendations-row').getBoundingClientRect(); window.scrollTo({ top: scrollY + r.top - 340 }); });
        await wait(1500);
        await page.evaluate(() => localStorage.removeItem('aniroll_req_times'));
        await imagesReady(page);
        await clip(page, 'match', async () => {
            await wait(400);
            await glide(page, '#recommendations-row .media-card, #recommendations-row [data-open]', { steps: 40 });
            await wait(700);
            await glide(page, '#recommendations-row > div:nth-child(2) .media-card, #recommendations-row > div:nth-child(2) [data-open]', { click: true });
            await wait(4000);
        });
        await page.keyboard.press('Escape');
    }
    if (want('list')) {
        await go('/list', 6000);
        // Load the Planning covers once, so the tab switch in the clip shows them right away
        await page.click('#list-tabs .list-tab:nth-child(2)');
        await wait(1500); await imagesReady(page);
        await page.click('#list-tabs .list-tab:nth-child(1)');
        await wait(1000); await imagesReady(page);
        // A show a few episodes from its end, so two +1 don't complete it
        const id = await page.evaluate(() => [...document.querySelectorAll('.list-card')].find(c => {
            const m = c.querySelector('.media-card-sub')?.textContent.match(/(\d+)\s*\/\s*(\d+)/);
            return m && m[2] - m[1] >= 4;
        })?.dataset.mediaId);
        const card = id ? `.list-card[data-media-id="${id}"]` : '.list-card:nth-child(3)';
        await clip(page, 'list', async () => {
            await wait(400);
            await glide(page, card, { steps: 35 });
            await wait(500);
            await glide(page, `${card} [data-action="inc"]`, { steps: 15, click: true });
            await wait(900);
            await page.mouse.down(); await wait(90); await page.mouse.up();
            await wait(1200);
            await glide(page, '#list-tabs .list-tab:nth-child(2)', { steps: 35, click: true });
            await wait(1000); await imagesReady(page);
            await wait(1200);
        });
    }
    await page.context().close();

    // Material 3 Expressive: arriving on Home (hero, widgets), the cover fan, +1 with its burst, then Roll
    if (want('m3')) {
        const p = await (await context({ size: { width: 1440, height: 810 }, design: 'm3' })).newPage();
        p.on('pageerror', e => console.log('pageerror', e.message));
        const to = async (hash, ms) => { await p.evaluate(h => { localStorage.removeItem('aniroll_req_times'); location.hash = h; }, hash); await wait(ms); await imagesReady(p); };
        // Load everything the clip shows once, so nothing arrives late on camera
        await p.goto(base + '/#/'); await wait(9000); await imagesReady(p);
        await to('#/roll', 7000);
        await to('#/list', 5000);
        await settle(p, false);
        await p.evaluate(() => localStorage.removeItem('aniroll_req_times'));
        mouse = { x: 900, y: 500 };
        await p.mouse.move(mouse.x, mouse.y);
        // Start once Home stands (its hero is still dealing in): the page swap before it is not worth showing
        await glide(p, '.mobile-tab[data-page="home"]', { steps: 20, click: true });
        await p.waitForSelector('.m3-hero-cover.is-front');
        await clip(p, 'm3', async () => {
            await wait(2400);
            await glide(p, '.m3-hero-deck', { steps: 40 });
            await wait(1600);
            await glide(p, '.m3-widget-week', { steps: 30 });
            await wait(1200);
            // Smooth scroll through the app's own scroller; a wheel event would fight it
            await p.evaluate(() => window.scrollTo({ top: 420, behavior: 'smooth' }));
            // Aim only once the page stands still, or the click lands on the card instead of its +1
            await p.waitForFunction(() => new Promise(r => { const y = scrollY; setTimeout(() => r(scrollY === y && y > 0), 150); }), null, { polling: 100, timeout: 5000 }).catch(() => {});
            await wait(300);
            // A show a few episodes from its end, so +1 doesn't complete it
            const id = await p.evaluate(() => [...document.querySelectorAll('#continue-watching .media-card')].find(c => {
                const m = c.querySelector('.media-card-sub')?.textContent.match(/(\d+)\s*\/\s*(\d+)/);
                return c.querySelector('.cw-inc') && m && m[2] - m[1] >= 3;
            })?.dataset.mediaId);
            const card = id ? `#continue-watching .media-card[data-media-id="${id}"]` : '#continue-watching .media-card:has(.cw-inc)';
            await glide(p, card, { steps: 30 });
            await wait(500);
            await glide(p, `${card} .cw-inc`, { steps: 12, click: true });
            await wait(1700);
            await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await wait(1000);
            await glide(p, '.m3-rail-fab', { steps: 35, click: true });
            await wait(300);
            // Rarely the click lands while the page is still settling from the scroll: follow the link then
            await p.evaluate(() => { if (!location.hash.startsWith('#/roll')) location.hash = '#/roll'; });
            await wait(1100);
            await glide(p, '#roll-btn', { steps: 30, click: true });
            await wait(5600);
        });
        await p.context().close();
    }
    // AniRoll's own design: arriving on Home (the show you're on, the ticking countdown, the row below), then the
    // accent colour from a swatch, another and a hex code, and back to Home in the new colour
    if (want('design-aniroll')) {
        const p = await (await context({ size: { width: 1440, height: 810 } })).newPage();
        p.on('pageerror', e => console.log('pageerror', e.message));
        // Load everything the clip shows once, so nothing arrives late on camera
        await p.goto(base + '/#/settings?tab=appearance'); await wait(4000);
        await p.goto(base + '/#/'); await wait(8000); await imagesReady(p);
        await p.goto(base + '/#/list'); await wait(5000); await imagesReady(p);
        await settle(p, false);
        // Every swatch says "Accent color saved"; three stacked toasts only get in the way here
        await p.addStyleTag({ content: '.toast-container, .home-popular-friends { display: none !important; }' });
        await p.evaluate(() => localStorage.removeItem('aniroll_req_times'));
        mouse = { x: 760, y: 420 };
        await p.mouse.move(mouse.x, mouse.y);
        const scrollTo = async (top) => {
            await p.evaluate(t => window.scrollTo({ top: t, behavior: 'smooth' }), top);
            await p.waitForFunction(() => new Promise(r => { const y = scrollY; setTimeout(() => r(scrollY === y), 150); }), null, { polling: 100, timeout: 5000 }).catch(() => {});
        };
        await clip(p, 'design-aniroll', async () => {
            await wait(300);
            // Home comes in: banner, cover, title, then the stats box with its countdown
            await glide(p, '.nav-links [data-page="home"]', { steps: 25, click: true });
            await p.waitForSelector('.ar-home-head');
            await wait(2200);
            await glide(p, '.ar-home-stat .ar-clock', { steps: 35 });
            await wait(1800);
            await scrollTo(380);
            await glide(p, '#continue-watching .media-card:nth-child(2)', { steps: 30 });
            await wait(600);
            await glide(p, '#continue-watching .media-card:nth-child(4)', { steps: 25 });
            await wait(600);
            await scrollTo(0);
            await glide(p, '#user-btn', { steps: 35, click: true });
            await wait(500);
            await glide(p, '#user-dropdown a[href="#/settings"]', { steps: 15, click: true });
            await wait(1300); await imagesReady(p);
            for (const n of [3, 6, 9]) {
                await glide(p, `.accent-swatch:nth-child(${n})`, { steps: 18, click: true });
                await wait(900);
            }
            await glide(p, '#accent-hex', { steps: 20 });
            await p.mouse.down(); await wait(90); await p.mouse.up();
            await p.evaluate(() => { const i = document.getElementById('accent-hex'); i.focus(); i.select(); });
            await p.keyboard.type('#00c2a8', { delay: 110 });
            await wait(1200);
            await glide(p, '.nav-links [data-page="home"]', { steps: 35, click: true });
            await wait(2400);
            await glide(p, '.ar-home-stat .ar-clock', { steps: 30 });
            await wait(1400);
        });
        await p.context().close();
    }

    // Stills (1440×900) for the README
    if (want('stills')) {
        const p = await (await context()).newPage();
        await p.goto(base + '/#/'); await still(p, 'home', 9000);
        await p.goto(base + '/#/list'); await still(p, 'list', 6000);
        await p.goto(base + '/#/calendar'); await wait(3000);
        await p.click('button:text-is("All Airing")'); await still(p, 'calendar', 9000);
        await p.goto(base + '/#/roll'); await wait(7000);
        await p.click('#roll-btn'); await wait(300); await still(p, 'roll', 2500);
        await p.evaluate(() => window.__openDetailPanel(154587)); await still(p, 'detail', 6000);
        await p.context().close();

        const m = await (await context({ mobile: true })).newPage();
        await m.goto(base + '/#/roll'); await wait(7000);
        await m.click('#roll-btn'); await wait(300); await still(m, 'mobile-roll', 2500);
        await m.goto(base + '/#/'); await still(m, 'mobile-home', 9000);
        await m.context().close();
    }
    if (want('landing')) {
        const l = await (await context({ loggedIn: false })).newPage();
        await l.goto(base + '/#/'); await still(l, 'landing', 4000);
        await l.context().close();
    }

    await browser.close();
    server.close();
})().catch(e => { console.error(e); process.exit(1); });
