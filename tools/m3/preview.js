// Screenshots of every page in the M3 design, logged in as the made-up demo account (tools/showcase/demo.js).
// Run via preview.sh:  tools/m3/preview.sh [dark|light] [page names...]   → tools/m3/out/<theme>-<page>.png
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const demo = require('../showcase/demo');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const [theme = 'dark', ...only] = process.argv.slice(2);
const want = n => !only.length || only.includes(n);
const design = process.env.DESIGN || 'm3';

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await demo.init();
    const server = http.createServer((req, res) => {
        const u = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, u === '/' ? 'index.html' : u);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch();

    async function open(mobile) {
        const c = await browser.newContext(mobile
            ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: theme }
            : { viewport: { width: 1440, height: 900 }, colorScheme: theme });
        await c.addInitScript(([u, theme, design, extra]) => {
            if (sessionStorage.getItem('init')) return;
            sessionStorage.setItem('init', '1');
            const set = { aniroll_theme: theme, aniroll_seen_changes: '9999', aniroll_design: design, aniroll_token: 'demo',
                aniroll_user: JSON.stringify(u), aniroll_user_ts: String(Date.now()), aniroll_roll_filters: JSON.stringify({ withRecs: true }), ...extra };
            for (const [k, v] of Object.entries(set)) localStorage.setItem(k, v);
        }, [{ ...demo.VIEWER, options: {}, mediaListOptions: { scoreFormat: 'POINT_100' } }, theme, design, JSON.parse(process.env.EXTRA || '{}')]);
        await c.route('https://graphql.anilist.co/**', async route => {
            let body;
            try { body = await demo.respond(route.request().postDataJSON()); } catch (e) { body = { errors: [{ message: e.message }] }; }
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        });
        await c.route(`${base}/api/**`, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
        await c.route(/kitsu\.io/, r => r.abort());
        const p = await c.newPage();
        p.on('pageerror', e => console.log('pageerror', e.message));
        await p.goto(base + '/#/');
        await wait(5000);
        return p;
    }
    const settle = p => p.evaluate(() => {
        localStorage.removeItem('aniroll_req_times');
        if (window.gsap) gsap.globalTimeline.getChildren(true, true, true).forEach(t => t.progress(1));
        document.getAnimations().forEach(a => { try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* */ } });
        document.querySelectorAll('.toast').forEach(t => t.remove());
    });
    async function shot(p, name, hash, { ms = 5000, act, full = false } = {}) {
        if (!want(name)) return;
        if (hash) await p.evaluate(h => { localStorage.removeItem('aniroll_req_times'); location.hash = h; }, hash);
        await wait(ms);
        await settle(p);
        if (act) { await act(p); await wait(1500); await settle(p); }
        await p.screenshot({ path: path.join(OUT, `${theme}-${name}.png`), fullPage: full });
        console.log('shot', name);
    }

    const p = await open(false);
    await shot(p, 'home', null, { ms: 3000 });
    await shot(p, 'home-full', null, { ms: 300, full: true });
    await shot(p, 'list', '#/list');
    await shot(p, 'roll', '#/roll', { ms: 6000, act: async q => { await q.click('#roll-btn'); await wait(300); await settle(q); } });
    await shot(p, 'search', '#/search', { ms: 6000 });
    await shot(p, 'calendar', '#/calendar', { ms: 6000 });
    await shot(p, 'social', '#/social', { ms: 5000 });
    await shot(p, 'notifications', '#/notifications', { ms: 4000 });
    await shot(p, 'settings', '#/settings?tab=appearance', { ms: 2500 });
    await shot(p, 'profile', '#/profile', { ms: 5000 });
    await shot(p, 'full', '#/anime/154587/full', { ms: 6000, full: true });
    await shot(p, 'panel', '#/', { ms: 3000, act: q => q.evaluate(() => window.__openDetailPanel(154587)) });
    // A real click on a cover: the container transform runs (View Transitions); shot mid-way and at the end
    if (want('morph')) {
        await p.keyboard.press('Escape');
        await p.evaluate(() => { location.hash = '#/list'; });
        await wait(4000);
        await settle(p);
        const card = p.locator('.list-card').nth(2);
        await card.click();
        await wait(250);
        await p.screenshot({ path: path.join(OUT, `${theme}-morph-mid.png`) });
        await wait(1800);
        await p.screenshot({ path: path.join(OUT, `${theme}-morph-end.png`) });
        console.log('morph', await p.evaluate(() => ({ vt: !!document.startViewTransition, open: document.getElementById('detail-panel-overlay').classList.contains('open'), scoped: document.querySelector('.detail-panel').className })));
    }
    const m = await open(true);
    await shot(m, 'm-home', null, { ms: 3000 });
    await shot(m, 'm-roll', '#/roll', { ms: 6000, act: async q => { await q.click('#roll-btn'); await wait(300); await settle(q); } });
    await shot(m, 'm-list', '#/list', { ms: 5000 });
    await browser.close();
    server.close();
})().catch(e => { console.error(e); process.exit(1); });
