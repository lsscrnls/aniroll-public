// @ts-check
// "Previously on": back after a long break, the last minute of the previous episode plays first, right up to
// where its ending starts, then it fades into the new episode. It plays in a video of its own: nothing of it
// is reported to Jellyfin and nothing is saved to AniList (the player's watched mark and Up next only know the
// main video), so it can never count as a rewatch.
// When: not a movie, not episode 1, the episode starts from the beginning, the previous one is in Jellyfin,
// and the last time the show was watched is two weeks or more ago. Where its ending starts comes from Jellyfin's
// segments or AniSkip (for a file of that length); without it there is no recap rather than a guessed one.
// Settings → Jellyfin → Player switches it off. Pause, subtitles and full screen work in it too.
import { HtmlVideoEngine } from './engine.js?v=177';
import { icon } from './controls.js?v=177';
import { findEpisode } from './library.js?v=177';
import { getConfig, jfAuth, deviceId } from '../jellyfin.js?v=177';
import { esc, titlePref } from '../store.js?v=177';

const KEY = 'aniroll_recap';
const SEEN_KEY = 'aniroll_last_watched'; // { [mediaId]: ms } when an episode was last watched in AniRoll
const BREAK_MS = 14 * 24 * 60 * 60 * 1000;
const LENGTH_S = 60;
const TICKS = 10_000_000;

export const recapOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setRecap(on) {
    try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, 'off'); } catch { /* not kept */ }
}

/** Called when an episode is watched in AniRoll: the break counts from here */
export function noteWatched(mediaId) {
    try {
        const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
        all[mediaId] = Date.now();
        localStorage.setItem(SEEN_KEY, JSON.stringify(all));
    } catch { /* not kept */ }
}

function lastWatchedHere(mediaId) {
    try { return Number((JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {})[mediaId]) || 0; } catch { return 0; }
}

const ago = (ms) => {
    const days = Math.round(ms / 86_400_000);
    return days >= 60 ? `${Math.round(days / 30)} months ago` : `${days} days ago`;
};

/**
 * Plays the recap if one is due; resolves when it is over (or there is none).
 * @param {object} o
 * @param {HTMLElement} o.root the .player
 * @param {any} o.media AniList media (mediaListEntry.updatedAt when known)
 * @param {number} o.episode the episode about to play
 * @param {{ base: string }} o.avail
 * @param {(itemId: string, startTime: number) => Promise<any>} o.playbackInfo
 * @param {(itemId: string, source: any) => { url: string, hls: boolean }} o.playPlan
 * @param {(itemId: string) => Promise<{ type: string, start: number }[]>} o.segments
 * @param {(episode: number) => Promise<{ type: string, start: number, length: number }[]>} o.ending
 * @param {(video: HTMLVideoElement, itemId: string, source: any) => any} o.subtitles the show's subtitle choice on this video
 * @param {(track: any) => void} o.subtitlesChanged switched in the recap: kept for the show and the episode after it
 * @param {() => boolean} o.closed
 */
export async function maybeRecap({ root, media, episode, avail, playbackInfo, playPlan, segments, ending, subtitles, subtitlesChanged, closed }) {
    if (!recapOn() || media.format === 'MOVIE' || episode < 2) return;
    const prev = await findEpisode(avail.base, media, episode - 1).catch(() => null);
    if (!prev || closed()) return;
    const last = Math.max(prev.lastPlayed || 0, (media.mediaListEntry?.updatedAt || 0) * 1000, lastWatchedHere(media.id));
    if (!last || Date.now() - last < BREAK_MS) return;

    // Where the previous episode's ending starts
    const runtime = prev.runTimeTicks / TICKS;
    const [segs, eds] = await Promise.all([segments(prev.itemId).catch(() => []), media.idMal ? ending(episode - 1).catch(() => []) : []]);
    const outro = segs.find(s => s.type === 'Outro')?.start;
    const ed = eds.find(e => (!e.length || !runtime || Math.abs(e.length - runtime) <= 20))?.start;
    const end = outro || ed;
    if (!end || end < 10 || closed()) return;
    const from = Math.max(0, end - LENGTH_S);

    const info = await playbackInfo(prev.itemId, from).catch(() => null);
    const source = info?.MediaSources?.[0];
    if (!source || closed()) return;
    const plan = playPlan(prev.itemId, source);

    const box = document.createElement('div');
    box.className = 'pl-recap';
    box.innerHTML = `<video class="pl-recap-video" playsinline crossorigin="anonymous"></video>
        <div class="pl-recap-card">
            <span class="pl-recap-kicker">Previously on</span>
            <span class="pl-recap-title">${esc(titlePref(media.title))}</span>
            <span class="pl-recap-sub">Episode ${episode - 1} · watched ${ago(Date.now() - last)}</span>
        </div>
        <div class="pl-recap-bar">
            <button class="pl-recap-btn" type="button" data-act="play" aria-label="Pause">${icon('pause')}</button>
            <button class="pl-recap-btn" type="button" data-act="subs" aria-label="Subtitles" aria-pressed="false" hidden>${icon('subtitles')}</button>
            <button class="pl-recap-btn" type="button" data-act="fullscreen" aria-label="Full screen">${icon('fullscreen')}</button>
            <button class="pl-recap-skip" type="button">Skip recap</button>
        </div>`;
    root.append(box);
    const video = /** @type {HTMLVideoElement} */ (box.querySelector('video'));
    const engine = new HtmlVideoEngine(video);
    const btn = (act) => /** @type {HTMLButtonElement} */ (box.querySelector(`[data-act="${act}"]`));

    // Pause: the button, a click on the picture, Space or K
    const paintPlay = () => {
        btn('play').innerHTML = icon(video.paused ? 'play' : 'pause');
        btn('play').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    };
    const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    video.addEventListener('play', paintPlay);
    video.addEventListener('pause', paintPlay);
    video.addEventListener('click', togglePlay);
    btn('play').addEventListener('click', togglePlay);

    // Full screen like the player: the whole document, so the episode after it keeps it
    const paintFull = () => { btn('fullscreen').innerHTML = icon(document.fullscreenElement ? 'exitFullscreen' : 'fullscreen'); };
    const toggleFull = () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
    };
    if (!document.documentElement.requestFullscreen) btn('fullscreen').hidden = true;
    paintFull();
    document.addEventListener('fullscreenchange', paintFull);
    btn('fullscreen').addEventListener('click', toggleFull);
    video.addEventListener('dblclick', toggleFull);

    // Subtitles on or off (C): the show's track, else the full English one, else the first
    const subs = subtitles(video, prev.itemId, source);
    const tracks = subs.list();
    let lastOn = subs.current();
    const paintSubs = () => btn('subs').setAttribute('aria-pressed', String(subs.current() != null));
    const toggleSubs = () => {
        if (!tracks.length) return;
        const id = subs.current() != null ? null
            : (lastOn ?? (tracks.find(t => /^(eng|en)$/i.test(t.lang) && !t.forced) || tracks.find(t => !t.forced) || tracks[0]).id);
        if (id != null) lastOn = id;
        subs.select(id);
        paintSubs();
        subtitlesChanged(tracks.find(t => t.id === id) || null);
    };
    btn('subs').hidden = !tracks.length;
    paintSubs();
    btn('subs').addEventListener('click', toggleSubs);
    const stopEncoding = () => {
        const cfg = getConfig();
        if (!plan.hls || !info.PlaySessionId || !cfg) return;
        fetch(`${avail.base}/Videos/ActiveEncodings?deviceId=${encodeURIComponent(deviceId())}&playSessionId=${encodeURIComponent(info.PlaySessionId)}`,
            { method: 'DELETE', headers: jfAuth(cfg.apiKey), keepalive: true }).catch(() => {});
    };

    await new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('fullscreenchange', paintFull);
            window.removeEventListener('hashchange', finish);
            box.classList.add('is-leaving');
            setTimeout(() => {
                subs.destroy();
                engine.destroy();
                box.remove();
                stopEncoding();
                resolve(undefined);
            }, 700);
        };
        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const key = ev.key.toLowerCase();
            const act = { escape: finish, s: finish, enter: finish, ' ': togglePlay, k: togglePlay, f: toggleFull, c: toggleSubs }[key];
            // A focused button takes Enter and Space itself
            if (act && !((key === 'enter' || key === ' ') && ev.target instanceof HTMLButtonElement && box.contains(ev.target))) {
                ev.preventDefault();
                act();
            }
            ev.stopPropagation(); // the player's keys sleep meanwhile
        };
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('hashchange', finish);
        box.querySelector('.pl-recap-skip')?.addEventListener('click', finish);
        video.addEventListener('timeupdate', () => { if (video.currentTime >= end - 0.3) finish(); });
        video.addEventListener('ended', finish);
        engine.on('error', finish);
        engine.load({ url: plan.url, hls: plan.hls, startTime: from })
            .then(() => (closed() ? finish() : engine.play()))
            // The browser refuses sound without a click: no recap then, the episode is what was asked for
            .catch(finish);
        // A stream that never starts must not hold the episode up (paused on purpose is not that)
        let started = false;
        video.addEventListener('playing', () => { started = true; }, { once: true });
        setTimeout(() => { if (!started) finish(); }, 12000);
    });
}
