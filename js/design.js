// Two designs: AniRoll's own and Material 3 Expressive (Settings → Appearance, or the switch on the landing page).
// M3 = css/m3.css (components, shapes, type, motion), js/m3.js (page additions) and a colour scheme generated from
// its own seed colour (not AniRoll's accent)
// with Google's Material Color Utilities (2025 spec, the one M3 Expressive uses). The scheme is written as a
// <style> with a light and a dark block, so System/Light/Dark keep working without recomputing; it is cached
// in localStorage so a reload paints M3 colours before the colour library has even loaded.

const DESIGN_KEY = 'aniroll_design';        // 'aniroll' | 'm3'
const VARIANT_KEY = 'aniroll_m3_variant';   // 'tonal' | 'vibrant' | 'expressive'
const SEED_KEY = 'aniroll_m3_seed';         // M3 has its own palette, unrelated to AniRoll's accent colour
const CACHE_KEY = 'aniroll_m3_scheme3';     // { key, css } — new name when the generated CSS changes
const SHOW_KEY = 'aniroll_m3_show';         // { color, cover } of the show you're on: the app's "wallpaper" 
const CSS_HREF = 'css/m3.css?v=14';

// 'show' themes the whole app from the show you're watching, like a desktop themed from its wallpaper
// (js/m3.js applies it); the others are seeds in the spirit of Google's own M3 palettes
export const SHOW_SEED = 'show';
const BASELINE = '#6750a4';
export const SEEDS = [
    { name: 'From your show', hex: SHOW_SEED },
    { name: 'Baseline', hex: BASELINE },
    { name: 'Rose', hex: '#8e4957' },
    { name: 'Coral', hex: '#b33b15' },
    { name: 'Amber', hex: '#8b5000' },
    { name: 'Moss', hex: '#4c662b' },
    { name: 'Teal', hex: '#006a6a' },
    { name: 'Ocean', hex: '#415f91' },
    { name: 'Orchid', hex: '#8a4c9e' },
];

export const VARIANTS = [
    { key: 'tonal', label: 'Tonal' },
    { key: 'vibrant', label: 'Vibrant' },
    { key: 'expressive', label: 'Expressive' },
];

export function getDesign() {
    try { return localStorage.getItem(DESIGN_KEY) === 'm3' ? 'm3' : 'aniroll'; } catch { return 'aniroll'; }
}
export function getVariant() {
    try { return VARIANTS.some(v => v.key === localStorage.getItem(VARIANT_KEY)) ? localStorage.getItem(VARIANT_KEY) : 'tonal'; } catch { return 'tonal'; }
}
export function getShowTheme() {
    try { return JSON.parse(localStorage.getItem(SHOW_KEY)) || null; } catch { return null; }
}
export function setShowTheme(theme) {
    try { localStorage.setItem(SHOW_KEY, JSON.stringify(theme)); } catch { /* storage blocked */ }
}
export function getSeed() {
    // A preset, 'show', or any colour picked in Settings (hex)
    try {
        const v = localStorage.getItem(SEED_KEY);
        return v === SHOW_SEED || /^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : SHOW_SEED;
    } catch { return SHOW_SEED; }
}
export function setSeed(hex, loggedIn) {
    try { localStorage.setItem(SEED_KEY, hex); } catch { /* storage blocked */ }
    return applyDesign(loggedIn);
}

export function setDesign(design, loggedIn) {
    try { localStorage.setItem(DESIGN_KEY, design); } catch { /* storage blocked */ }
    return applyDesign(loggedIn);
}
export function setVariant(variant, loggedIn) {
    try { localStorage.setItem(VARIANT_KEY, variant); } catch { /* storage blocked */ }
    return applyDesign(loggedIn);
}

let enhancer = null;

// Switches with a flourish: the new design spreads as a circle from where it was chosen (View Transitions,
// where supported; elsewhere it just switches). Waits for the stylesheet, so the circle never shows a half-styled page.
export async function switchDesign(design, loggedIn, from) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce || !from) return setDesign(design, loggedIn);
    const root = document.documentElement;
    root.classList.add('design-swap');
    const vt = document.startViewTransition(() => setDesign(design, loggedIn));
    vt.ready.then(() => {
        const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
        root.animate({ clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
            { duration: 750, easing: 'cubic-bezier(0.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
    try { await vt.finished; } catch { /* skipped */ }
    root.classList.remove('design-swap');
}

// Logged out too: the landing page lets visitors try Material 3 before they log in
export async function applyDesign(loggedIn) {
    const root = document.documentElement;
    const on = getDesign() === 'm3';
    if (!on) {
        root.removeAttribute('data-design');
        document.getElementById('m3-css')?.remove();
        document.getElementById('m3-scheme')?.remove();
        enhancer?.then(m => m.teardown());
        enhancer = null;
        return;
    }
    // Page additions only M3 has (hero, search bar, rail FAB ...)
    if (enhancer) enhancer.then(m => m.refresh());
    enhancer ??= import('./m3.js?v=98').then(m => { m.setup(); return m; });

    // Stylesheet first; keep the page hidden until it's there, so AniRoll's look never flashes
    let sheet = null;
    if (!document.getElementById('m3-css')) {
        root.classList.add('m3-loading');
        const link = document.createElement('link');
        link.id = 'm3-css';
        link.rel = 'stylesheet';
        link.href = CSS_HREF;
        sheet = new Promise(resolve => {
            const done = () => { root.classList.remove('m3-loading'); resolve(); };
            link.onload = done;
            link.onerror = done;
            setTimeout(done, 3000);
        });
        document.head.appendChild(link);
    }
    root.setAttribute('data-design', 'm3');

    const key = `${getSeed()}|${getVariant()}`;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { /* none */ }
    if (cached?.key === key) {
        writeScheme(cached.css);
        await sheet;
        return;
    }
    if (cached?.css) writeScheme(cached.css); // old colours until the new ones are ready
    const seed = getSeed();
    const css = await buildSchemeCss(seed === SHOW_SEED ? BASELINE : seed, getVariant());
    writeScheme(css);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, css })); } catch { /* storage blocked */ }
    await sheet;
}

function writeScheme(css) {
    let style = document.getElementById('m3-scheme');
    if (!style) {
        style = document.createElement('style');
        style.id = 'm3-scheme';
        document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
    // Browser chrome (address bar, PWA title bar) in the surface colour
    const surface = css.match(/--md-surface: (#[0-9a-f]{6})/)?.[1];
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
}

// Every M3 colour role as --md-<role>, light and dark
const ROLES = ['primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'secondary', 'onSecondary',
    'secondaryContainer', 'onSecondaryContainer', 'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
    'error', 'onError', 'errorContainer', 'onErrorContainer', 'surface', 'onSurface', 'onSurfaceVariant',
    'surfaceDim', 'surfaceBright', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
    'surfaceContainerHigh', 'surfaceContainerHighest', 'outline', 'outlineVariant', 'inverseSurface',
    'inverseOnSurface', 'inversePrimary', 'scrim', 'shadow', 'primaryFixed', 'primaryFixedDim', 'onPrimaryFixed',
    'secondaryFixed', 'onSecondaryFixed', 'tertiaryFixed', 'onTertiaryFixed'];
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const CUSTOM = { success: '#16a34a', warning: '#f59e0b' };

const loadMcu = () => import('./vendor/material-color-utilities-0.4.0.js');

async function buildSchemeCss(seedHex, variant) {
    const mcu = await loadMcu();
    const Scheme = { tonal: mcu.SchemeTonalSpot, vibrant: mcu.SchemeVibrant, expressive: mcu.SchemeExpressive }[variant];
    const { light, dark } = blocks(mcu, seedHex, Scheme);
    return `:root[data-design="m3"] { ${light} }
@media (prefers-color-scheme: dark) { :root[data-design="m3"]:not([data-theme="light"]) { ${dark} } }
:root[data-design="m3"][data-theme="dark"] { ${dark} }`;
}

// Colour from content, like Android's media player: a show's own cover colour (AniList's coverImage.color)
// becomes a scheme for one part of the page — or, on the <html>, for the whole app. SchemeContent keeps the
// colours close to the cover. Returns the class to put on that element; its CSS is written once per colour.
const contentClasses = new Map();
export async function contentScheme(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
    const cls = `m3-c-${hex.slice(1).toLowerCase()}`;
    if (!contentClasses.has(cls)) {
        contentClasses.set(cls, loadMcu().then(mcu => {
            const { light, dark } = blocks(mcu, hex, mcu.SchemeContent);
            const on = (theme, sel) => `:root[data-design="m3"]${theme}.${sel}, :root[data-design="m3"]${theme} .${sel}`;
            let style = document.getElementById('m3-content');
            if (!style) {
                style = document.createElement('style');
                style.id = 'm3-content';
                document.head.appendChild(style);
            }
            style.textContent += `${on('', cls)} { ${light} }
@media (prefers-color-scheme: dark) { ${on(':not([data-theme="light"])', cls)} { ${dark} } }
${on('[data-theme="dark"]', cls)} { ${dark} }
`;
        }));
    }
    await contentClasses.get(cls);
    return cls;
}

function blocks(mcu, seedHex, Scheme) {
    const seed = mcu.Hct.fromInt(mcu.argbFromHex(seedHex));
    // AniRoll's own status colours (done = green, paused = amber) pulled towards the seed, the way M3
    // "harmonizes" custom colours: they keep their meaning but sit in the palette
    const custom = (dark) => Object.entries(CUSTOM).map(([name, hex]) => {
        const h = mcu.Hct.fromInt(mcu.Blend.harmonize(mcu.argbFromHex(hex), seed.toInt()));
        const tone = (t) => mcu.hexFromArgb(mcu.Hct.from(h.hue, Math.max(h.chroma, 36), t).toInt());
        return `--md-${name}: ${tone(dark ? 80 : 40)}; --md-${name}-container: ${tone(dark ? 30 : 90)}; --md-on-${name}-container: ${tone(dark ? 90 : 10)};`;
    }).join(' ');
    const block = (dark) => {
        const scheme = new Scheme(seed, dark, 0, '2025', 'phone');
        return ROLES.map(r => `--md-${kebab(r)}: ${mcu.hexFromArgb(scheme[r])};`).join(' ') + ' ' + custom(dark);
    };
    return { light: block(false), dark: block(true) };
}
