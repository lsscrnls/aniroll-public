// Screenshots of every page in the M3 design, logged in as the made-up demo account (tools/showcase/demo.js).
// Run via preview.sh:  tools/m3/preview.sh [dark|light] [page names...]   → tools/m3/out/<theme>-<page>.png
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const demo = require('../showcase/demo');
const { mockJellyfin, JF_STORAGE } = require('../e2e/jellyfin-mock');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
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
        // A running Watch Party with two friends, for the "party" shot
        await c.route(`${base}/api/party/**`, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
            hostName: demo.VIEWER.name, mediaId: 154587, mediaTitle: 'Frieren', active: true, hostProgress: 5, hostProgressAt: Date.now(), startedAt: Date.now(), startEp: 3,
            members: [{ id: 2, name: 'Mika', avatar: '', progress: 5 }, { id: 3, name: 'Jonas', avatar: '', progress: 3 }] }) }));
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
    // The Jellyfin card on Home, fed the way the webhook state arrives (needs EXTRA='{"aniroll_jf_hook":"x"}')
    await shot(p, 'now-playing', null, { ms: 300, act: async q => {
        await q.evaluate(() => {
            const min = 600000000;
            window.dispatchEvent(new CustomEvent('aniroll:jf-now', { detail: { trackAt: 0.9, sessions: [{
                type: 'Episode', series: 'Jigokuraku', name: 'The Samurai and the Woman', season: 1, episode: 5,
                position: 16 * min, runtime: 23 * min, device: 'living room' }] } }));
            document.getElementById('jf-now-section')?.scrollIntoView({ block: 'center' });
        });
    } });
    await shot(p, 'list', '#/list');
    await shot(p, 'roll', '#/roll', { ms: 6000, act: async q => { await q.click('#roll-btn'); await wait(300); await settle(q); } });
    await shot(p, 'search', '#/search', { ms: 6000 });
    await shot(p, 'calendar', '#/calendar', { ms: 6000 });
    await shot(p, 'social', '#/social', { ms: 5000 });
    await shot(p, 'notifications', '#/notifications', { ms: 4000 });
    await shot(p, 'settings', '#/settings?tab=appearance', { ms: 2500 });
    await shot(p, 'profile', '#/profile', { ms: 5000 });
    await shot(p, 'full', '#/anime/154587/full', { ms: 6000, full: true });
    await shot(p, 'studio', '#/studio/11', { ms: 6000 });
    await shot(p, 'panel', '#/', { ms: 3000, act: q => q.evaluate(() => window.__openDetailPanel(154587)) });
    await p.evaluate(n => localStorage.setItem('aniroll_watchparty', JSON.stringify({ hostName: n, mediaId: 154587, hostKey: 'k', mediaTitle: 'Frieren', startEp: 3 })), demo.VIEWER.name);
    await shot(p, 'party', `#/watchparty?host=${encodeURIComponent(demo.VIEWER.name)}&anime=154587`, { ms: 6000 });
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

    // The player (Jellyfin mocked): paused mid-episode, playing with the subtitle menu, on a phone
    async function player(q, name, mobile) {
        if (!want(name) && !want(name + '-menu')) return;
        await mockJellyfin(q, { anyTitle: true });
        await q.evaluate(jf => { for (const [k, v] of Object.entries(jf)) localStorage.setItem(k, v); sessionStorage.clear(); }, JF_STORAGE);
        await q.evaluate(() => { localStorage.removeItem('aniroll_req_times'); location.hash = '#/play/154587/2'; });
        await wait(5000);
        await q.evaluate(() => { const v = document.getElementById('player-video'); v.pause(); v.currentTime = 8.4; });
        await wait(800);
        await q.mouse.move(mobile ? 200 : 700, mobile ? 700 : 820);
        await wait(600);
        if (want(name)) { await q.screenshot({ path: path.join(OUT, `${theme}-${name}.png`) }); console.log('shot', name); }
        if (want(name + '-menu')) {
            await q.evaluate(() => document.getElementById('player-video').play());
            await q.click('[data-act="subs"]');
            await wait(900);
            await q.screenshot({ path: path.join(OUT, `${theme}-${name}-menu.png`) });
            console.log('shot', name + '-menu');
        }
        await q.evaluate(() => { location.hash = '#/'; });
        await wait(800);
    }
    await player(p, 'player', false);
    const m = await open(true);
    await player(m, 'm-player', true);
    await shot(m, 'm-home', null, { ms: 3000 });
    await shot(m, 'm-roll', '#/roll', { ms: 6000, act: async q => { await q.click('#roll-btn'); await wait(300); await settle(q); } });
    await shot(m, 'm-list', '#/list', { ms: 5000 });
    await browser.close();
    server.close();
})().catch(e => { console.error(e); process.exit(1); });
