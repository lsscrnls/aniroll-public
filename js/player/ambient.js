// @ts-check
// Ambient light: where the picture does not fill the player (a 16:9 episode on a 21:9 screen, a window that is
// taller or wider than the stream), the black bars glow in the colours of the picture's nearest edge, scene by
// scene. The picture itself keeps its size. Behind the video a small canvas in the player's shape holds the
// frame where the video shows it, with the picture next to each bar mirrored out into it, blurred far by CSS.
// Mirrored, not stretched: a stretched edge strip turns every row into a line and the bars into blinds.
// Above the canvas (and under the video) a veil lets the light fall off towards the screen's edge, like light
// on a wall, with a fine grain against the steps a dark gradient shows on an 8-bit screen.
// Each new frame is laid over the last at SMOOTH, so the light glides into a new scene instead of jumping;
// after a jump in the video, a resize or a pause it is drawn whole at once.
// The canvas is blurred at its own small size and only then scaled up to the player: blurring the full screen
// on every new frame (a 21:9 monitor is 3440 pixels wide) is what made the light trail the picture.
// It reaches a margin past the player on every side, filled with its own edge: a blur reaching past a canvas
// finds nothing there and would dim the ends of the bars into notches.
// Only drawn, never read back, so a stream from another origin works too.
// On by default; the player's settings menu, the A key and Settings → Jellyfin → Player switch it.
const KEY = 'aniroll_ambient';
const CW = 96; // canvas width; the height follows the player's shape
const EVERY_MS = 33; // up to 30 frames a second, drawn as each new frame of the video is shown
const BLUR = 0.3; // of the bar's width (or height), in CSS pixels on screen ...
const BLUR_MIN = 32, BLUR_MAX = 140; // ... within these
const MIN_BAR = 8; // bars thinner than this (in CSS pixels) are not worth lighting
const SMOOTH = 0.22; // how much of each new frame goes over the last: about a third of a second to a new scene

export const ambientOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setAmbient(on) {
    try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, 'off'); } catch { /* not kept */ }
}

// A small tile of noise, made once: light and dark specks a step or two either way
let grain = '';
function grainTile() {
    if (grain) return grain;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (!g) return '';
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.random() * 10;
    }
    g.putImageData(img, 0, 0);
    grain = `url(${c.toDataURL()})`;
    return grain;
}

/**
 * @param {HTMLElement} root the .player
 * @param {HTMLVideoElement} video
 * @returns {{ toggle(): boolean, destroy(): void }}
 */
export function mountAmbient(root, video) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pl-ambient';
    canvas.setAttribute('aria-hidden', 'true');
    const veil = document.createElement('div');
    veil.className = 'pl-ambient-veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.style.setProperty('--amb-grain', grainTile());
    video.before(canvas, veil);
    const ctx = canvas.getContext('2d', { alpha: false });
    let last = 0;
    let frame = 0;
    let on = false;
    let whole = true; // the next frame is drawn whole, not laid over the last
    // Where the picture sits on the canvas (inside the margin), in canvas pixels; null when there are no bars to light
    /** @type {{ x: number, y: number, w: number, h: number } | null} */
    let box = null;
    let pad = 0, cw = 0, ch = 0; // the margin, and the player's size on the canvas

    const measure = () => {
        const W = video.clientWidth, H = video.clientHeight;
        const vw = video.videoWidth, vh = video.videoHeight;
        box = null;
        if (W && H && vw && vh) {
            const s = Math.min(W / vw, H / vh);
            const barX = (W - vw * s) / 2, barY = (H - vh * s) / 2;
            if (barX >= MIN_BAR || barY >= MIN_BAR) {
                cw = CW;
                ch = Math.max(1, Math.round(CW * H / W));
                const k = CW / W;
                const bar = Math.max(barX, barY);
                const blur = Math.min(BLUR_MAX, Math.max(BLUR_MIN, bar * BLUR)) * k;
                pad = Math.ceil(blur * 3);
                if (canvas.width !== cw + 2 * pad || canvas.height !== ch + 2 * pad) {
                    canvas.width = cw + 2 * pad; canvas.height = ch + 2 * pad;
                }
                const sx = W / cw, sy = H / ch;
                canvas.style.width = `${canvas.width}px`;
                canvas.style.height = `${canvas.height}px`;
                canvas.style.transform = `translate(${-pad * sx}px, ${-pad * sy}px) scale(${sx}, ${sy})`;
                canvas.style.setProperty('--amb-blur', `${blur.toFixed(2)}px`);
                veil.style.setProperty('--amb-bar', `${Math.round(bar)}px`);
                box = { x: pad + barX * k, y: pad + barY * k, w: vw * s * k, h: vh * s * k };
            }
        }
        root.classList.toggle('ambient-bars', !!box);
        root.classList.toggle('ambient-tall', !!box && box.y > box.x);
        whole = true;
    };

    const draw = () => {
        if (!ctx || !box || video.readyState < 2) return;
        const { x, y, w, h } = box;
        const bx = x - pad, by = y - pad; // the bars' size
        const vw = video.videoWidth, vh = video.videoHeight;
        const s = w / vw; // canvas pixels per pixel of the stream
        try {
            ctx.globalAlpha = whole ? 1 : SMOOTH;
            ctx.drawImage(video, x, y, w, h);
            // Each bar gets as much picture as it is wide, turned over at the picture's edge
            if (bx > 0) {
                const sw = Math.min(vw / 2, bx / s);
                ctx.save();
                ctx.translate(x, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(video, 0, 0, sw, vh, 0, y, bx, h);
                ctx.restore();
                ctx.save();
                ctx.translate(x + w, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(video, vw - sw, 0, sw, vh, -bx, y, bx, h);
                ctx.restore();
            }
            if (by > 0) {
                const sh = Math.min(vh / 2, by / s);
                ctx.save();
                ctx.translate(0, y);
                ctx.scale(1, -1);
                ctx.drawImage(video, 0, 0, vw, sh, x, 0, w, by);
                ctx.restore();
                ctx.save();
                ctx.translate(0, y + h);
                ctx.scale(1, -1);
                ctx.drawImage(video, 0, vh - sh, vw, sh, x, -by, w, by);
                ctx.restore();
            }
            // The margin: the player's outermost row and column drawn out to the canvas's edge (corners last)
            ctx.globalAlpha = 1;
            const fw = cw + 2 * pad, fh = ch + 2 * pad;
            ctx.drawImage(canvas, pad, pad, cw, 1, pad, 0, cw, pad);
            ctx.drawImage(canvas, pad, pad + ch - 1, cw, 1, pad, pad + ch, cw, pad);
            ctx.drawImage(canvas, pad, 0, 1, fh, 0, 0, pad, fh);
            ctx.drawImage(canvas, pad + cw - 1, 0, 1, fh, pad + cw, 0, pad, fh);
            whole = false;
        } catch { /* no frame yet */ }
        ctx.globalAlpha = 1;
    };
    // Drawn when the video shows a new frame where the browser can say so, else on the next screen refresh
    const byFrame = 'requestVideoFrameCallback' in video;
    const next = () => {
        frame = byFrame ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    const stop = () => {
        if (byFrame) video.cancelVideoFrameCallback(frame); else cancelAnimationFrame(frame);
    };
    const loop = (now) => {
        if (!on) return;
        if (box && now - last >= EVERY_MS && !video.paused) { last = now; draw(); }
        next();
    };
    // Paused or after a jump: the light shows the picture as it is, whole
    const once = () => { if (on) { whole = true; draw(); } };
    const remeasure = () => { measure(); once(); };
    video.addEventListener('seeked', once);
    video.addEventListener('loadeddata', remeasure);
    video.addEventListener('pause', once);
    // The stream's own size can change (another quality, another file); the player's on every resize
    video.addEventListener('resize', remeasure);
    const watcher = new ResizeObserver(remeasure);
    watcher.observe(video);

    const apply = (value) => {
        on = value;
        root.classList.toggle('has-ambient', on);
        stop();
        if (on) { measure(); draw(); next(); }
    };
    apply(ambientOn());

    return {
        toggle() {
            setAmbient(!on);
            apply(!on);
            return on;
        },
        destroy() {
            on = false;
            stop();
            watcher.disconnect();
            video.removeEventListener('seeked', once);
            video.removeEventListener('loadeddata', remeasure);
            video.removeEventListener('pause', once);
            video.removeEventListener('resize', remeasure);
            canvas.remove();
            veil.remove();
            root.classList.remove('has-ambient', 'ambient-bars', 'ambient-tall');
        },
    };
}
