// Store art for AniRoll for Discord into dist/store/: the promo tiles and the screenshots.
// Run in the Playwright image with the repo at /work, served on localhost:3000, the extension at /ext
// and the helper set up (see discord/store/render.sh).
const { chromium } = require('playwright');
const OUT = '/out';

(async () => {
    const browser = await chromium.launch();
    for (const [v, w, h, name] of [['small', 440, 280, 'promo-small-440x280'], ['marquee', 1400, 560, 'promo-marquee-1400x560'], ['status', 1280, 800, 'screenshot-1-status']]) {
        const p = await browser.newPage({ viewport: { width: w, height: h } });
        await p.goto(`http://localhost:3000/discord/store/art.html?v=${v}`);
        await p.waitForLoadState('networkidle');
        await p.evaluate(() => document.fonts.ready);
        await p.screenshot({ path: `${OUT}/${name}.png` });
        await p.close();
    }
    await browser.close();

    // The real app with the extension and helper: the show page, then the setup in Settings
    const ctx = await chromium.launchPersistentContext('/tmp/profile', { channel: 'chromium', headless: true,
        args: ['--disable-extensions-except=/ext', '--load-extension=/ext'], viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto('http://localhost:3000/#/settings?tab=discord');
    await p.waitForFunction(() => document.querySelectorAll('.dc-step.is-done').length === 3, null, { timeout: 20000 }).catch(() => {});
    await p.click('#dc-toggle');
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}/screenshot-3-settings.png` });
    await p.goto('http://localhost:3000/#/anime/154587/full');
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(6000);
    await p.screenshot({ path: `${OUT}/screenshot-2-show.png` });
    await ctx.close();
})();
