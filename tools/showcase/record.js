// Stills and clips of AniRoll for the README and the landing page, logged in as the made-up demo account
// (demo.js). Run through run.sh, which also turns the clip frames into video. Pass names to redo only some:
//   tools/showcase/run.sh roll calendar
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const demo = require('./demo');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.OUT || path.join(__dirname, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
    // libass (JASSUB) compiles only from the right type, as nginx serves it live
    '.wasm': 'application/wasm', '.mjs': 'text/javascript' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv.slice(2);
const want = n => !only.length || only.includes(n);
// The promo video's scenes (promo.sh) only run when named
const promo = n => only.includes(n);

// A second made-up account, the friend who joins the demo's Watch Party
const GUEST = { id: 5551234, name: 'Mika',
    avatar: { large: 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png', medium: 'https://s4.anilist.co/file/anilistcdn/user/avatar/medium/default.png' } };

// The real API server (api/server.js with party.js) for the Watch Party scene: AniList's Viewer lookup answered
// here by token ("demo", "guest"), its data in a throwaway folder
async function partyBackend() {
    const viewers = { demo: demo.VIEWER, guest: GUEST };
    const anilist = http.createServer((req, res) => {
        const v = viewers[String(req.headers.authorization || '').slice(7)];
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(!v ? { errors: [{ message: 'Invalid token', status: 401 }] }
                : /Viewer/.test(body) ? { data: { Viewer: { id: v.id, name: v.name, avatar: { medium: v.avatar.medium } } } } : { data: {} }));
        });
    });
    await new Promise(r => anilist.listen(3099, '127.0.0.1', r));
    const dir = fs.mkdtempSync('/tmp/aniroll-api-');
    for (const f of ['server.js', 'party.js']) fs.copyFileSync(path.join(ROOT, 'api', f), path.join(dir, f));
    const proc = spawn('node', ['server.js'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, ANILIST_URL: 'http://127.0.0.1:3099', JF_SECRET: 'showcase-secret-0123456789abcdef', ANILIST_BUDGET_PER_MIN: '200', MAX_SEATS: '50' } });
    for (let i = 0; i < 50; i++) {
        const up = await new Promise(r => http.get('http://127.0.0.1:3001/api/maintenance', res => { res.resume(); r(true); }).on('error', () => r(false)));
        if (up) break;
        await wait(200);
    }
    return () => { proc.kill(); anilist.close(); };
}

function staticServer(apiPort) {
    const server = http.createServer((req, res) => {
        // /api/ goes through to the API server when one runs (streamed, so the party's live events arrive)
        if (apiPort && req.url.startsWith('/api/')) {
            const up = http.request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, r => {
                res.writeHead(r.statusCode, r.headers);
                r.pipe(res);
            });
            up.on('error', () => { res.writeHead(502); res.end(); });
            req.pipe(up);
            return;
        }
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
    const stopApi = promo('party') ? await partyBackend() : null;
    const server = await staticServer(stopApi ? 3001 : null);
    const base = `http://127.0.0.1:${server.address().port}`;
    // GPU=1 (run.sh, when Docker has the NVIDIA runtime): render through the real GPU via ANGLE/EGL
    const browser = await chromium.launch(process.env.GPU
        ? { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl'] } : {});
    console.log('rendering on', process.env.GPU ? 'the GPU' : 'the CPU (software)');
    fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true });

    async function context({ loggedIn = true, mobile = false, size = { width: 1440, height: 900 }, scale = 1, design = 'm3',
        api = false, as = demo.VIEWER, token = 'demo', seed = null } = {}) {
        const ctx = await browser.newContext(mobile
            ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' }
            : { viewport: size, deviceScaleFactor: scale, colorScheme: 'dark' });
        await ctx.addInitScript(([user, li, design, token]) => {
            localStorage.setItem('aniroll_theme', 'dark');
            // Material 3 unless a clip wants the legacy design
            if (design === 'aniroll') localStorage.setItem('aniroll_design_v2', 'aniroll');
            else localStorage.removeItem('aniroll_design_v2');

            // Clips must never show a cover arriving late: every image loads right away, not when scrolled to
            new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                (n.tagName === 'IMG' ? [n] : n.querySelectorAll('img[loading="lazy"]')).forEach(img => { img.loading = 'eager'; });
            }))).observe(document, { childList: true, subtree: true });
            localStorage.setItem('aniroll_seen_changes', '9999');
            if (!localStorage.getItem('aniroll_roll_filters')) localStorage.setItem('aniroll_roll_filters', JSON.stringify({ withRecs: true }));
            localStorage.removeItem('aniroll_req_times');
            if (li) {
                localStorage.setItem('aniroll_token', token);
                localStorage.setItem('aniroll_user', JSON.stringify(user));
                localStorage.setItem('aniroll_user_ts', String(Date.now()));
            }
        }, [{ ...as, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }, loggedIn, design, token]);
        // A fixed seed makes Roll land on the same show in every scene that rolls (mulberry32)
        if (seed != null) await ctx.addInitScript(seed => {
            let a = seed;
            Math.random = () => {
                a = (a + 0x6D2B79F5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }, seed);
        await ctx.route('https://graphql.anilist.co/**', async route => {
            let body;
            try { body = await demo.respond(route.request().postDataJSON()); } catch (e) { body = { errors: [{ message: e.message }] }; console.log('demo:', e.message); }
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        if (!api) await ctx.route(`${base}/api/**`, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
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
    async function clip(page, name, act, { folder = 'clips', max = { w: 1280, h: 720 } } = {}) {
        const dir = path.join(OUT, folder, name);
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
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: max.w, maxHeight: max.h });
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
    // One pointer per page: the Watch Party scene records two pages at once
    // (`mouse` is where the next page without its own pointer starts)
    let mouse = { x: 700, y: 500 };
    const mice = new WeakMap();
    async function glide(page, selector, { steps = 30, click = false } = {}) {
        const from = mice.get(page) || mouse;
        // The first visible match: some pages keep a hidden copy (a skeleton, the other layout) in the DOM
        const box = await page.locator(`${selector} >> visible=true`).first().boundingBox({ timeout: 8000 }).catch(() => null);
        if (!box) {
            await page.screenshot({ path: path.join(OUT, 'debug.png') });
            throw new Error('not found: ' + selector + ' (screenshot: out/debug.png)');
        }
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
            await wait(12);
        }
        mouse = { x, y };
        mice.set(page, mouse);
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

    // The player, from a real Jellyfin (run.sh: JF, SHOW_ID, EPISODE, SEEK): the detail page's Episodes list,
    // Play, the stream with its subtitles, the controls and the Audio & subtitles menu. Google Chrome: Playwright's
    // Chromium has no H.264. Material 3, the design the player is built in
    if (want('player')) {
        const jf = JSON.parse(fs.readFileSync(process.env.JF, 'utf8'));
        const showId = Number(process.env.SHOW_ID);
        const episode = Number(process.env.EPISODE) || 1;
        if (!showId) throw new Error('player clip: SHOW_ID missing');
        const chrome = await chromium.launch({ channel: 'chrome', args: process.env.GPU
            ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl', '--autoplay-policy=no-user-gesture-required']
            : ['--autoplay-policy=no-user-gesture-required'] });
        const ctx = await chrome.newContext({ viewport: { width: 1440, height: 810 }, colorScheme: 'dark' });
        await ctx.addInitScript(([user, jf]) => {
            if (sessionStorage.getItem('init')) return;
            sessionStorage.setItem('init', '1');
            const set = { aniroll_theme: 'dark', aniroll_seen_changes: '9999', aniroll_token: 'demo',
                aniroll_user: JSON.stringify(user), aniroll_user_ts: String(Date.now()),
                aniroll_jf_url: jf.url, aniroll_jf_apikey: jf.token, aniroll_jf_userid: jf.userId, aniroll_jf_username: jf.userName,
                aniroll_jf_servername: jf.server, aniroll_jf_kind: 'user', aniroll_jf_scope: 'device' };
            for (const [k, v] of Object.entries(set)) localStorage.setItem(k, v);
        }, [{ ...demo.VIEWER, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }, { url: 'http://localhost:8096', ...jf }]);
        await ctx.route('https://graphql.anilist.co/**', async route => {
            let body;
            try { body = await demo.respond(route.request().postDataJSON()); } catch (e) { body = { errors: [{ message: e.message }] }; }
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        await ctx.route(`${base}/api/**`, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
        const pp = await ctx.newPage();
        pp.on('pageerror', e => console.log('pageerror', e.message));
        pp.on('console', m => { if (['warning', 'error'].includes(m.type())) console.log('console', m.type(), m.text().slice(0, 200)); });
        await pp.goto(base + '/#/');
        await wait(4000);
        // The show's page first, loaded before the recording starts
        await pp.evaluate(id => { localStorage.removeItem('aniroll_req_times'); location.hash = `#/anime/${id}/full`; }, showId);
        await pp.waitForSelector('.detail-episodes', { timeout: 20000 });
        await wait(1500);
        await settle(pp, false);
        mouse = { x: 900, y: 300 };
        await clip(pp, 'player', async () => {
            await wait(900);
            await glide(pp, '.detail-episodes', { click: true });
            await pp.waitForSelector('.ep-row', { timeout: 15000 });
            await wait(900);
            // Pick the episode from the list, as a person would (scrolled into the list's view first)
            await pp.evaluate(n => document.querySelector(`.ep-row[href$="/${n}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), episode);
            await wait(700);
            await glide(pp, `.ep-row[href$="/${episode}"]`, { steps: 40 });
            await wait(500);
            await glide(pp, `.ep-row[href$="/${episode}"]`, { click: true, steps: 2 });
            await pp.waitForFunction(() => { const v = document.getElementById('player-video'); return v && v.readyState >= 3 && !v.paused; }, null, { timeout: 45000 })
                .catch(async (err) => {
                    await pp.screenshot({ path: path.join(OUT, 'debug.png') });
                    console.log('player state:', JSON.stringify(await pp.evaluate(() => { const v = document.getElementById('player-video');
                        return { hash: location.hash, status: document.getElementById('player-status')?.textContent.trim(), method: document.getElementById('player-method')?.textContent,
                            ready: v?.readyState, paused: v?.paused, src: (v?.currentSrc || '').slice(0, 60), error: v?.error?.message }; })));
                    throw err;
                });
            if (process.env.SEEK) {
                await pp.evaluate(t => { document.getElementById('player-video').currentTime = Number(t); }, process.env.SEEK);
                await pp.waitForFunction(() => document.getElementById('player-video').readyState >= 3, null, { timeout: 30000 });
            }
            await wait(2000);
            // In the intro: the Audio & subtitles menu, the dialogue track picked (not the signs-only one)
            await glide(pp, '[data-act="subs"]', { click: true });
            await wait(1400);
            const dialogue = await pp.evaluate(() => {
                const items = [...document.querySelectorAll('.pl-menu-item[data-track]:not([data-track="off"])')];
                const pick = items.find(i => !/forced|signs/i.test(i.textContent) && /eng/i.test(i.textContent));
                if (!pick || pick.getAttribute('aria-checked') === 'true') return false;
                pick.id = 'showcase-dialogue';
                return true;
            });
            if (dialogue) {
                await glide(pp, '#showcase-dialogue', { steps: 25 });
                await wait(400);
                await glide(pp, '#showcase-dialogue', { click: true, steps: 2 });
            } else {
                await pp.keyboard.press('Escape');
            }
            await wait(900);
            // Skip intro, pressed like a person would: the episode goes on where people start talking
            if (await pp.locator('.pl-skip-segment:not([hidden])').count()) {
                await glide(pp, '.pl-skip-segment', { steps: 35 });
                await wait(500);
                await glide(pp, '.pl-skip-segment', { click: true, steps: 2 });
                await pp.waitForFunction(() => document.getElementById('player-video').readyState >= 3, null, { timeout: 30000 }).catch(() => {});
            }
            await glide(pp, '.player-video', { steps: 25 });
            await wait(6500);
            // The wave: where you are, what's buffered, the 90 % mark
            await glide(pp, '.pl-seek', { steps: 30 });
            await wait(2000);
            await glide(pp, '.player-video', { steps: 25 });
            await wait(2500);
            console.log('subtitles:', JSON.stringify(await pp.evaluate(() => ({
                canvases: [...document.querySelectorAll('.pl-subs-canvas')].map(c => `${c.tagName}:${c.width}x${c.height}:${c.hidden ? 'hidden' : 'shown'}`),
                checked: [...document.querySelectorAll('.pl-menu-item[aria-checked="true"]')].map(e => e.textContent.trim()) }))));
        });
        await chrome.close();
    }

    // ===== Promo video (promo.sh): title cards, Roll in full HD, and a Watch Party seen from both sides =====
    const PROMO = { folder: 'promo', max: { w: 1920, h: 1080 } };
    const PROMO_SEED = Number(process.env.SEED) || 7;
    if (promo('cards')) {
        const cp = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
        const cards = {
            'card-roll': ['Can’t decide what to watch?', 'AniRoll picks tonight’s show from your AniList Planning list.'],
            'card-party': ['Watch it together.', 'Start a Watch Party, send the link, and your friends follow along live.'],
            'card-player': ['Play it from your own Jellyfin.', 'Right in the browser, with intro skip and subtitles. AniList keeps up by itself.'],
            'card-end': ['AniRoll', 'Roll, watch parties and your own Jellyfin, on top of the AniList you already have.', 'aniroll.app'],
        };
        fs.mkdirSync(path.join(OUT, 'promo', 'cards'), { recursive: true });
        for (const [name, [head, sub, url]] of Object.entries(cards)) {
            const end = name === 'card-end';
            await cp.setContent(`<!doctype html><html><head><base href="${base}/"><style>
                @font-face { font-family: Flex; src: url(fonts/google-sans-flex-latin-wght-5.3.1.woff2) format('woff2'); font-weight: 100 1000; }
                html, body { margin: 0; height: 100%; }
                body { background: radial-gradient(120% 90% at 85% 10%, #4a2b4f 0%, #1d1820 55%, #141218 100%); color: #ece0ee;
                    font-family: Flex, system-ui, sans-serif; display: grid; align-content: center; padding: 0 180px; box-sizing: border-box; }
                img { width: ${end ? 140 : 72}px; height: auto; margin-bottom: ${end ? 40 : 56}px; }
                h1 { margin: 0; font-size: ${end ? 176 : 112}px; line-height: 1.02; font-weight: 750; letter-spacing: -0.035em; max-width: 1400px; }
                p { margin: 36px 0 0; font-size: 44px; line-height: 1.3; font-weight: 450; color: #cdbfd2; max-width: 1300px; }
                .url { margin-top: 64px; font-size: 56px; font-weight: 650; color: #f2b8d6; }
            </style></head><body><img src="favicon.svg" alt=""><h1>${head}</h1><p>${sub}</p>${url ? `<p class="url">${url}</p>` : ''}</body></html>`);
            await cp.evaluate(() => document.fonts.ready);
            await wait(400);
            await cp.screenshot({ path: path.join(OUT, 'promo', 'cards', `${name}.png`) });
            console.log('card', name);
        }
        await cp.context().close();
    }

    if (promo('promo-roll')) {
        const rp = await (await context({ size: { width: 1440, height: 810 }, scale: 4 / 3, seed: PROMO_SEED })).newPage();
        await rp.goto(base + '/#/roll');
        await wait(7000);
        await settle(rp, false);
        await clip(rp, 'roll', async () => {
            await wait(600);
            await glide(rp, '#roll-btn', { click: true });
            await wait(5200);
            await glide(rp, '#roll-result .glass-btn-primary', { steps: 40 });
            await wait(1500);
        }, PROMO);
        await rp.context().close();
    }

    // Two windows side by side: the demo account rolls and starts a party, Mika opens the link and joins,
    // then every episode the host marks arrives on Mika's side live (the real party code, server-sent events)
    if (promo('party')) {
        const size = { width: 960, height: 1080 };
        const host = await (await context({ size, api: true, seed: PROMO_SEED })).newPage();
        const guest = await (await context({ size, api: true, as: GUEST, token: 'guest' })).newPage();
        [host, guest].forEach(p => p.on('pageerror', e => console.log('pageerror', e.message)));
        const tag = (page, text) => page.evaluate(t => {
            let el = document.getElementById('promo-tag');
            if (!el) {
                el = document.createElement('div');
                el.id = 'promo-tag';
                el.style.cssText = 'position:fixed;right:28px;bottom:28px;z-index:2147483647;padding:12px 26px;'
                    + 'border-radius:999px;background:rgba(20,18,24,.88);color:#fff;font:650 24px system-ui,sans-serif;pointer-events:none;'
                    + 'box-shadow:0 8px 30px rgba(0,0,0,.4)';
                document.body.appendChild(el);
            }
            el.textContent = t;
        }, text);
        // Before the link arrives, Mika's window is a chat (a plain made-up one, no real app's look)
        const chat = (page, msgs) => page.evaluate(msgs => {
            let box = document.getElementById('promo-chat');
            if (!box) {
                box = document.createElement('div');
                box.id = 'promo-chat';
                box.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#17141b;display:flex;flex-direction:column;'
                    + 'justify-content:flex-end;gap:18px;padding:0 56px 140px;font:400 28px system-ui,sans-serif;color:#ece0ee';
                document.body.appendChild(box);
            }
            box.innerHTML = '<div style="position:absolute;top:44px;left:56px;font-weight:700;font-size:30px">Mika and demo</div>' + msgs.map(([who, text, link]) => {
                const me = who === 'Mika';
                return `<div style="align-self:${me ? 'flex-end' : 'flex-start'};max-width:78%;padding:18px 24px;border-radius:26px;`
                    + `background:${me ? '#4a3a63' : '#2b2530'}"><div style="font-size:20px;opacity:.65;margin-bottom:6px">${who}</div>${text}`
                    + `${link ? `<div id="promo-invite" style="margin-top:10px;color:#f2b8d6;text-decoration:underline;font-weight:600">${link}</div>` : ''}</div>`;
            }).join('');
        }, msgs);
        await host.goto(base + '/#/roll');
        await guest.goto(base + '/#/');
        await chat(guest, [['Mika', 'anything tonight?'], ['demo', 'no idea, letting AniRoll pick']]);
        await wait(7000);
        await host.locator('#roll-btn').click();
        await wait(6500);
        await settle(host, false); await settle(guest, false);
        await tag(host, 'You'); await tag(guest, 'Your friend');

        let started, joined;
        const partyUp = new Promise(r => { started = r; });
        const guestIn = new Promise(r => { joined = r; });
        await Promise.all([
            clip(host, 'party-host', async () => {
                await wait(800);
                await glide(host, '#roll-party', { click: true });
                await host.waitForFunction(() => location.hash.startsWith('#/watchparty') && document.getElementById('wp-inc'), null, { timeout: 15000 });
                await tag(host, 'You');
                await wait(1500);
                started();
                await guestIn;
                await wait(1200);
                for (let i = 0; i < 2; i++) {
                    await glide(host, '#wp-inc', { click: true });
                    console.log('host +1:', await host.evaluate(() => {
                        const b = document.querySelector('#wp-inc').getBoundingClientRect();
                        const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
                        return `${document.getElementById('wp-progress')?.textContent} | at ${at?.id || at?.className} | disabled ${document.querySelector('#wp-inc').disabled}`;
                    }));
                    await wait(2600);
                }
            }, PROMO),
            clip(guest, 'party-guest', async () => {
                await wait(1200);
                await partyUp;
                await chat(guest, [['Mika', 'anything tonight?'], ['demo', 'no idea, letting AniRoll pick'],
                    ['demo', 'got one, come watch', 'aniroll.app/w/demo']]);
                await wait(1600);
                await glide(guest, '#promo-invite', { click: false });
                await wait(300);
                await guest.evaluate(() => { document.getElementById('promo-chat')?.remove(); location.hash = '/watchparty?host=demo'; });
                await guest.waitForSelector('#wp-join', { timeout: 15000 });
                await tag(guest, 'Your friend');
                await wait(1200);
                await glide(guest, '#wp-join', { click: true });
                const ok = await guest.waitForSelector('#wp-bg-keep, #wp-join-ok', { timeout: 4000 }).catch(() => null);
                if (ok) { await wait(600); await glide(guest, '#wp-bg-keep, #wp-join-ok', { click: true }); }
                await wait(1500);
                joined();
                await wait(8000);
            }, PROMO),
        ]);
        await host.context().close();
        await guest.context().close();
    }

    await browser.close();
    server.close();
    stopApi?.();
})().catch(e => { console.error(e); process.exit(1); });
