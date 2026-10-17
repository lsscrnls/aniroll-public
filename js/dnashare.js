// @ts-check
// Sharing an Anime DNA: the card (1200 × 630, the size link previews show large) is drawn in the browser
// from the DNA's own picture and words, kept by the server for the account (api/server.js "/api/me/dna-card"),
// and the link /d/<name> shows it in Discord & co., then opens the profile, where a signed-in visitor sees
// how well they match. Without the server (localhost), the image can still be saved.
import { getToken } from './auth.js?v=186';
import { toast } from './store.js?v=186';

const W = 1200, H = 630;

// The quirks carry <strong> and escaped titles: plain text for the canvas
function plain(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.textContent || '';
}

// Lines of `text` that fit `width` at the context's current font, at most `max` (the last one cut with …)
function wrap(ctx, text, width, max) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= width || !line) line = next;
        else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    if (lines.length > max) {
        lines.length = max;
        let last = lines[max - 1];
        while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
        lines[max - 1] = `${last.trimEnd()}…`;
    }
    return lines;
}

// The DNA's SVG as an image: the page's CSS does not reach into an <img>, so its look comes along inline
function artImage(svg, accent) {
    const style = `<style>.dna-petal{mix-blend-mode:screen}.dna-stars circle{fill:#fff;opacity:.75}
        .dna-stars circle.fav{fill:${accent};opacity:1}.dna-rings circle{fill:none;stroke:#fff;stroke-opacity:.1}.dna-core{fill:#fff}</style>`;
    const source = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" ').replace(/(<svg[^>]*>)/, `$1${style}`);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    });
}

/**
 * The card as a JPEG
 * @param {{ name: string, dna: any }} who
 * @returns {Promise<Blob>}
 */
export async function drawCard({ name, dna }) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    await document.fonts?.ready;
    const accent = dna.palette[0];

    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(315, 315, 0, 315, 315, 420);
    glow.addColorStop(0, `${accent}66`);
    glow.addColorStop(1, `${accent}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    try { ctx.drawImage(await artImage(dna.art, accent), 15, 15, 600, 600); } catch { /* the words carry it */ }

    const x = 640, width = W - x - 56;
    let y = 92;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#c9c6d0';
    ctx.font = `700 22px ${font}`;
    ctx.fillText(`ANIME DNA · ${name.toUpperCase()}`, x, y);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 58px ${font}`;
    for (const line of wrap(ctx, dna.type.name, width, 2)) { y += 66; ctx.fillText(line, x, y); }
    if (dna.streak) {
        y += 38;
        ctx.fillStyle = '#a9a6b0';
        ctx.font = `500 24px ${font}`;
        ctx.fillText(`with a streak of ${dna.streak}`, x, y);
    }
    y += 22;
    ctx.fillStyle = '#ecebf0';
    ctx.font = `500 26px ${font}`;
    for (const line of wrap(ctx, dna.type.line, width, 2)) { y += 36; ctx.fillText(line, x, y); }

    y += 18;
    ctx.font = `400 21px ${font}`;
    for (const quirk of dna.quirks.slice(0, 3)) {
        const lines = wrap(ctx, plain(quirk), width - 24, 2);
        if (y + lines.length * 28 + 10 > H - 70) break;
        y += 14;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(x + 6, y + 20, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c9c6d0';
        for (const line of lines) { y += 28; ctx.fillText(line, x + 24, y); }
    }

    ctx.fillStyle = '#8f8c97';
    ctx.font = `600 22px ${font}`;
    ctx.fillText("What's yours? aniroll.app", x, H - 44);

    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No image'))), 'image/jpeg', 0.88));
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `anime-dna-${name}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/**
 * The Share button: draw, keep on the server, then the system's share sheet or the link copied
 * @param {{ name: string, dna: any }} who
 */
export async function shareDna({ name, dna }) {
    const blob = await drawCard({ name, dna });
    let url = '';
    try {
        const q = new URLSearchParams({ type: dna.type.name, line: dna.type.line });
        const res = await fetch(`/api/me/dna-card?${q}`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${getToken()}` },
            body: blob,
            signal: AbortSignal.timeout(15000),
        });
        if (res.ok) url = (await res.json()).url || '';
    } catch { /* below: the image alone */ }
    if (!url) {
        toast('The link could not be made right now', 'error', { action: { label: 'Save image', run: () => download(blob, name) } });
        return;
    }
    const title = `I'm ${dna.type.name}`;
    try {
        if (navigator.share) {
            await navigator.share({ title, text: `${title}. What's your Anime DNA?`, url });
            return;
        }
        await navigator.clipboard.writeText(url);
        toast('Link copied', 'success', { action: { label: 'Save image', run: () => download(blob, name) } });
    } catch (err) {
        if (err?.name !== 'AbortError') toast(url, 'info', { action: { label: 'Save image', run: () => download(blob, name) } });
    }
}
