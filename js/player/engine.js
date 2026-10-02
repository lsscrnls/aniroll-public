// Playback behind a small interface, so the page does not care how the picture gets there.
// Today: <video> for files the browser plays as they are, hls.js (or Safari's own HLS) for
// what Jellyfin remuxes or converts. Another engine (a desktop mpv shell, say) would offer the same.
//   engine = { load(source), play(), pause(), seek(s), time, duration, paused, destroy(), on(event, fn) }
const HLS_URL = '../vendor/hls.light-1.7.3.min.js';

export class HtmlVideoEngine {
    constructor(video) {
        this.video = video;
        this.hls = null;
        this.listeners = [];
    }

    // source: { url, hls: boolean, startTime: seconds }
    async load(source) {
        this.detach();
        const video = this.video;
        const start = source.startTime || 0;

        // hls.js wherever Media Source Extensions exist, even where the browser plays HLS itself
        // (Chrome does now): it tells a server error from a broken file. Native HLS is the fallback (iPhone).
        const Hls = source.hls ? (await import(HLS_URL)).default : null;
        if (source.hls && !Hls.isSupported() && !video.canPlayType('application/vnd.apple.mpegurl')) {
            throw new Error('This browser cannot play streams');
        }
        if (source.hls && Hls.isSupported()) {
            // No worker: our CSP allows scripts from 'self' only, and fMP4 segments need no transmuxing
            const hls = new Hls({ enableWorker: false, startPosition: start, maxBufferLength: 60, backBufferLength: 90 });
            this.hls = hls;
            await new Promise((resolve, reject) => {
                let started = false;
                hls.on(Hls.Events.MANIFEST_PARSED, () => { started = true; resolve(); });
                hls.on(Hls.Events.ERROR, (_, data) => {
                    // A 5xx on a segment means Jellyfin's converter died (e.g. the graphics card is full):
                    // asking again only brings the same answer, and hls.js would keep retrying for a long while
                    const serverFailed = data.response?.code >= 500 && /frag|manifest|level/i.test(data.details || '');
                    if (!data.fatal && !serverFailed) return;
                    if (serverFailed) hls.stopLoad();
                    const err = new Error(hlsMessage(data));
                    err.code = data.response?.code || 0;
                    // What broke, for the player to decide whether a quiet retry can help
                    err.kind = serverFailed ? 'server' : data.type === 'networkError' ? 'network' : data.type === 'mediaError' ? 'media' : 'other';
                    if (!started) reject(err);
                    else this.emit('error', err);
                });
                hls.loadSource(source.url);
                hls.attachMedia(video);
            });
            return;
        }

        video.src = source.url;
        if (start) video.currentTime = start;
        await new Promise((resolve, reject) => {
            const ok = () => { off(); resolve(); };
            const bad = () => { off(); reject(mediaError(video.error)); };
            const off = () => { video.removeEventListener('loadedmetadata', ok); video.removeEventListener('error', bad); };
            video.addEventListener('loadedmetadata', ok);
            video.addEventListener('error', bad);
        });
        if (start && Math.abs(video.currentTime - start) > 1) video.currentTime = start;
        const onError = () => this.emit('error', mediaError(video.error));
        video.addEventListener('error', onError);
        this.listeners.push(() => video.removeEventListener('error', onError));
    }

    play() { return this.video.play(); }
    pause() { this.video.pause(); }
    seek(seconds) { this.video.currentTime = Math.max(0, seconds); }
    get time() { return this.video.currentTime || 0; }
    get duration() { return Number.isFinite(this.video.duration) ? this.video.duration : 0; }
    get paused() { return this.video.paused; }

    on(event, fn) {
        (this.handlers ||= {})[event] ||= [];
        this.handlers[event].push(fn);
    }

    emit(event, value) {
        (this.handlers?.[event] || []).forEach(fn => fn(value));
    }

    detach() {
        this.listeners.forEach(off => off());
        this.listeners = [];
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }

    destroy() {
        this.detach();
        this.handlers = {};
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
    }
}

// kind: 'network' (code 2, the connection broke), 'unsupported' (code 4, the file itself), else 'other'
function mediaError(error) {
    const err = new Error(mediaMessage(error));
    err.kind = error?.code === 2 ? 'network' : error?.code === 4 ? 'unsupported' : 'other';
    return err;
}

function mediaMessage(error) {
    if (!error) return 'Playback failed';
    if (error.code === 4) return 'This browser cannot play the file';
    if (error.code === 2) return 'The connection to the server broke off';
    return error.message || 'Playback failed';
}

function hlsMessage(data) {
    const code = data.response?.code;
    // Jellyfin answers 500 when its converter fails, e.g. the graphics card has no memory left
    if (code >= 500) return 'Jellyfin could not convert this episode right now. Is its graphics card busy, with a game for example?';
    if (code === 401 || code === 403) return 'Jellyfin refused the stream';
    if (data.type === 'networkError') return 'The connection to the server broke off';
    return `Playback failed (${data.details || data.type})`;
}
