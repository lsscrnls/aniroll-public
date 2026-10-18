// @ts-check
// Ambient light: where the picture does not fill the player (a 16:9 episode on a 21:9 screen, a window that is
// taller or wider than the stream), the black bars glow in the colours of the picture's nearest edge, scene by
// scene. The picture itself keeps its size. Behind the video a small canvas in the player's shape holds the
// frame where the video shows it, with its edge strips stretched out into the bars, blurred far by CSS.
// The canvas is blurred at its own small size and only then scaled up to the player: blurring the full screen
// on every new frame (a 21:9 monitor is 3440 pixels wide) is what made the light trail the picture.
// Only drawn, never read back, so a stream from another origin works too.
// On by default; the player's settings menu, the A key and Settings → Jellyfin → Player switch it.
const KEY = 'aniroll_ambient';
const CW = 96; // canvas width; the height follows the player's shape
const EVERY_MS = 33; // up to 30 frames a second, drawn as each new frame of the video is shown
const BLUR = 48; // CSS pixels on screen
const MIN_BAR = 8; // bars thinner than this (in CSS pixels) are not worth lighting
const EDGE = 0.06; // the share of the picture next to a bar that is stretched into it

export const ambientOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setAmbient(on) {
    try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, 'off'); } catch { /* not kept */ }
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
    video.before(canvas);
    const ctx = canvas.getContext('2d', { alpha: false });
    let last = 0;
    let frame = 0;
    let on = false;
    // Where the picture sits on the canvas, in canvas pixels; null when there are no bars to light
    /** @type {{ x: number, y: number, w: number, h: number } | null} */
    let box = null;

    const measure = () => {
        const W = video.clientWidth, H = video.clientHeight;
        const vw = video.videoWidth, vh = video.videoHeight;
        box = null;
        if (W && H && vw && vh) {
            const s = Math.min(W / vw, H / vh);
            const barX = (W - vw * s) / 2, barY = (H - vh * s) / 2;
            if (barX >= MIN_BAR || barY >= MIN_BAR) {
                const ch = Math.max(1, Math.round(CW * H / W));
                if (canvas.width !== CW || canvas.height !== ch) { canvas.width = CW; canvas.height = ch; }
                const k = CW / W;
                canvas.style.width = `${CW}px`;
                canvas.style.height = `${ch}px`;
                canvas.style.transform = `scale(${W / CW}, ${H / ch})`;
                canvas.style.setProperty('--amb-blur', `${(BLUR * k).toFixed(2)}px`);
                box = { x: barX * k, y: barY * k, w: vw * s * k, h: vh * s * k };
            }
        }
        root.classList.toggle('ambient-bars', !!box);
    };

    const draw = () => {
        if (!ctx || !box || video.readyState < 2) return;
        const { x, y, w, h } = box;
        const vw = video.videoWidth, vh = video.videoHeight;
        const ex = vw * EDGE, ey = vh * EDGE;
        try {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, x, y, w, h);
            // Each bar gets the strip of picture next to it, stretched across (one pixel of overlap against seams)
            if (x > 0) {
                ctx.drawImage(video, 0, 0, ex, vh, 0, y, x + 1, h);
                ctx.drawImage(video, vw - ex, 0, ex, vh, x + w - 1, y, x + 1, h);
            }
            if (y > 0) {
                ctx.drawImage(video, 0, 0, vw, ey, x, 0, w, y + 1);
                ctx.drawImage(video, 0, vh - ey, vw, ey, x, y + h - 1, w, y + 1);
            }
        } catch { /* no frame yet */ }
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
    // Paused or after a jump: the light still shows where the picture is
    const once = () => { if (on) draw(); };
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
            root.classList.remove('has-ambient', 'ambient-bars');
        },
    };
}
