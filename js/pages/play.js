import * as api from '../api.js?v=118';
import { getState, toast, esc, titlePref, emitListChange, emitWatched } from '../store.js?v=118';
import { getToken, isLoggedIn } from '../auth.js?v=118';
import { getConfig, jfAuth, deviceId } from '../jellyfin.js?v=118';
import { availability } from '../player/availability.js?v=118';
import { findEpisode, jfGet } from '../player/library.js?v=118';
import { deviceProfile } from '../player/profile.js?v=118';
import { HtmlVideoEngine } from '../player/engine.js?v=118';
import { controlsHtml, mountControls, icon } from '../player/controls.js?v=118';
import { createSubtitles } from '../player/subtitles.js?v=118';

// #/play/<mediaId>/<episode>: plays an episode from the user's own Jellyfin, full screen.
// Jellyfin gets the usual playback reports (its "continue watching", the webhook, the dashboard),
// AniList gets the episode once 90% of it has played — only forward, never twice.
const TICKS = 10_000_000;
const WATCHED_AT = 0.9;
const REPORT_EVERY = 10_000;
// Halfway through, Jellyfin starts unpacking the next episode's subtitles
const WARM_AT = 0.5;
// The public address sits behind a home upload of about 30 Mbit/s: leave room, let Jellyfin shrink the rest
const PUBLIC_BITRATE = 25_000_000;
const LOCAL_BITRATE = 120_000_000;

export async function render({ params, content }) {
    const mediaId = parseInt(params.id, 10);
    const episode = parseInt(params.episode, 10);
    const token = getToken();

    content.innerHTML = `
        <div class="player is-paused is-loading" id="player">
            <video class="player-video" id="player-video" playsinline crossorigin="anonymous"></video>
            ${controlsHtml()}
            <div class="player-top">
                <a class="pl-btn player-back" id="player-back" href="#/anime/${mediaId}" aria-label="Back" title="Back">${icon('back')}</a>
                <div class="player-title">
                    <div class="player-show" id="player-show"></div>
                    <div class="player-episode" id="player-episode">Episode ${episode}</div>
                </div>
                <div class="player-method" id="player-method" hidden></div>
            </div>
            <div class="player-status" id="player-status" role="status"><div class="loader-spinner"></div></div>
        </div>`;
    document.body.classList.add('player-open');

    const $ = (id) => content.querySelector(`#${id}`);
    const video = $('player-video');
    const engine = new HtmlVideoEngine(video);
    const session = { base: null, itemId: null, mediaSourceId: null, playSessionId: null, hls: false, started: false, done: false };
    let reportTimer = null;
    let closed = false;
    let controls = null;
    let subtitles = null;

    const status = (text, { error = false } = {}) => {
        const box = $('player-status');
        if (!box) return;
        box.hidden = !text;
        box.classList.toggle('error', error);
        $('player')?.classList.toggle('is-loading', !!text && !error);
        $('player')?.classList.toggle('has-error', error);
        box.innerHTML = text ? (error
            ? `<p class="player-error-text">${esc(text)}</p><div class="pl-actions"><button class="pl-pill pl-pill-tonal" data-retry>Try again</button><a class="pl-pill" href="#/anime/${mediaId}">Back to the show</a></div>`
            : `<div class="pl-spinner" aria-hidden="true"></div><p>${esc(text)}</p>`) : '';
    };

    // Try again: the same page from the start (the server may be free again)
    content.addEventListener('click', (ev) => {
        if (!ev.target.closest('[data-retry]')) return;
        cleanup();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    // Going back returns to where the Play button was, when there is such a place
    $('player-back').addEventListener('click', (ev) => {
        if (history.length > 1) {
            ev.preventDefault();
            history.back();
        }
    });

    const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(reportTimer);
        controls?.destroy();
        subtitles?.destroy();
        window.removeEventListener('pagehide', onPageHide);
        document.body.classList.remove('player-open');
        stopSession(session, engine.time);
        engine.destroy();
    };
    const onPageHide = () => stopSession(session, engine.time);
    window.addEventListener('pagehide', onPageHide);

    try {
        const cfg = getConfig();
        if (!cfg) throw new Error('Connect Jellyfin in Settings to play episodes here');
        if (!(mediaId > 0) || !(episode > 0)) throw new Error('No such episode');

        const [avail, media] = await Promise.all([availability(true), api.getMedia(mediaId, token)]);
        if (closed) return cleanup;
        $('player-show').textContent = titlePref(media.title);
        if (!avail) throw new Error('Your Jellyfin server cannot be reached right now');
        session.base = avail.base;

        status('Finding the episode...');
        const ep = await findEpisode(avail.base, media, episode);
        if (closed) return cleanup;
        if (!ep) throw new Error(`Episode ${episode} is not in your Jellyfin library`);
        session.itemId = ep.itemId;
        $('player-episode').textContent = media.format === 'MOVIE' ? '' : `Episode ${episode}${ep.name && !/^episode \d+$/i.test(ep.name) ? ` · ${ep.name}` : ''}`;

        // Continue where it stopped, unless it was watched to the end
        const startTime = !ep.played && ep.positionTicks && ep.runTimeTicks && ep.positionTicks < ep.runTimeTicks * WATCHED_AT
            ? ep.positionTicks / TICKS : 0;

        status('Asking Jellyfin how to play it...');
        const info = await playbackInfo(avail, cfg, ep.itemId, startTime);
        if (closed) return cleanup;
        const source = info.MediaSources?.[0];
        if (!source) throw new Error(info.ErrorCode ? `Jellyfin cannot play this (${info.ErrorCode})` : 'Jellyfin found no playable file');
        session.mediaSourceId = source.Id;
        session.playSessionId = info.PlaySessionId;

        const plan = playPlan(avail.base, cfg, ep.itemId, source);
        session.hls = plan.hls;
        session.method = plan.method;
        $('player-method').textContent = plan.label;
        $('player-method').hidden = false;
        controls = mountControls($('player'), video, { watchedAt: WATCHED_AT, runtime: () => (ep.runTimeTicks ? ep.runTimeTicks / TICKS : 0) });
        subtitles = createSubtitles({ video, base: avail.base, cfg, itemId: ep.itemId, source,
            onLoading: (on) => controls?.setSubtitlesLoading(on) });
        controls.setSubtitles(subtitles);

        status(plan.hls ? 'Starting the stream...' : 'Loading...');
        await engine.load({ url: plan.url, hls: plan.hls, startTime });
        if (closed) return cleanup;
        status('');

        const runtime = () => (ep.runTimeTicks ? ep.runTimeTicks / TICKS : 0) || engine.duration;

        // The next episode, if Jellyfin has it: the Up next card, and its subtitles unpacked ahead
        const nextNumber = episode + 1;
        const nextEp = media.format === 'MOVIE' || (media.episodes && episode >= media.episodes)
            ? Promise.resolve(null)
            : findEpisode(avail.base, media, nextNumber).catch(() => null);
        nextEp.then(n => {
            if (closed || !n) return;
            controls.setNext({
                title: `Episode ${nextNumber}${n.name && !/^episode \d+$/i.test(n.name) ? ` · ${n.name}` : ''}`,
                // Replaces this episode in the history: Back still leads to where Play was pressed
                go: () => location.replace(`#/play/${mediaId}/${nextNumber}`),
            });
        });

        engine.on('error', (err) => status(err.message, { error: true }));
        video.addEventListener('timeupdate', () => {
            const total = runtime();
            if (!session.warmed && total && engine.time / total >= WARM_AT) {
                session.warmed = true;
                nextEp.then(n => { if (n && !closed) warmSubtitles(avail.base, cfg, n.itemId); });
            }
            if (!session.done && total && engine.time / total >= WATCHED_AT) {
                session.done = true;
                if (isLoggedIn()) saveEpisode(media, episode, token);
            }
        });
        const report = () => reportProgress(session, engine);
        video.addEventListener('pause', report);
        video.addEventListener('play', report);
        video.addEventListener('seeked', report);

        loadSegments(avail.base, cfg, ep.itemId).then(list => { if (!closed) controls.setSegments(list); });
        await reportStart(session, engine);
        reportTimer = setInterval(report, REPORT_EVERY);
        engine.play().catch(() => { /* autoplay refused: the controls are there */ });
    } catch (err) {
        if (!closed) status(err.message || 'Playback failed', { error: true });
    }
    return cleanup;
}

// Jellyfin unpacks every subtitle of a file on the first request for one of them, reading the whole
// file (4 s for a small episode, 40 s for a Blu-ray remux). One short request starts it; Jellyfin
// finishes even when the request is dropped (measured), so nothing big is downloaded here.
async function warmSubtitles(base, cfg, itemId) {
    try {
        const item = await jfGet(base, `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(itemId)}`, cfg.apiKey);
        const source = item?.MediaSources?.[0];
        const s = (source?.MediaStreams || []).find(x => x.Type === 'Subtitle' && !x.IsExternal);
        if (!s) return;
        const codec = String(s.Codec).toLowerCase();
        const ext = codec.includes('pgs') ? 'pgssub' : codec === 'ass' || codec === 'ssa' ? 'ass' : 'vtt';
        await fetch(`${base}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(source.Id)}/Subtitles/${s.Index}/0/Stream.${ext}?ApiKey=${encodeURIComponent(cfg.apiKey)}`,
            { signal: AbortSignal.timeout(3000) });
    } catch { /* only a head start */ }
}

// Intro, recap, credits: Jellyfin's media segments (Jellyfin 10.10+, filled by the Intro Skipper plugin).
// Older servers name the types by number. Nothing there, or no answer: simply no Skip button.
const SEGMENT_TYPES = { 1: 'Commercial', 2: 'Preview', 3: 'Recap', 4: 'Outro', 5: 'Intro' };
async function loadSegments(base, cfg, itemId) {
    try {
        const res = await fetch(`${base}/MediaSegments/${encodeURIComponent(itemId)}`, {
            headers: { ...jfAuth(cfg.apiKey), Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.Items || []).map(g => ({
            type: typeof g.Type === 'number' ? SEGMENT_TYPES[g.Type] : g.Type,
            start: (g.StartTicks || 0) / TICKS,
            end: (g.EndTicks || 0) / TICKS,
        })).filter(g => g.type && g.type !== 'Unknown' && g.end > g.start);
    } catch {
        return [];
    }
}

async function playbackInfo(avail, cfg, itemId, startTime) {
    const res = await fetch(`${avail.base}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?userId=${encodeURIComponent(cfg.userId)}`, {
        method: 'POST',
        headers: { ...jfAuth(cfg.apiKey), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            UserId: cfg.userId,
            DeviceProfile: deviceProfile(avail.local ? LOCAL_BITRATE : PUBLIC_BITRATE),
            MaxStreamingBitrate: avail.local ? LOCAL_BITRATE : PUBLIC_BITRATE,
            StartTimeTicks: Math.round(startTime * TICKS),
            EnableDirectPlay: true,
            EnableDirectStream: true,
            EnableTranscoding: true,
            AutoOpenLiveStream: true,
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Jellyfin refused — connect again in Settings');
    if (!res.ok) throw new Error(`Jellyfin answered ${res.status}`);
    return res.json();
}

// Direct file, or the HLS stream Jellyfin prepared; and a word on what the server does for it
function playPlan(base, cfg, itemId, source) {
    if (source.TranscodingUrl) {
        const reasons = new URLSearchParams(source.TranscodingUrl.split('?')[1] || '').get('TranscodeReasons') || '';
        const video = /Video|Bitrate|Resolution|Framerate|Level|Profile|Anamorphic|Interlaced|RefFrames/.test(reasons);
        const audio = /Audio/.test(reasons);
        const label = video ? 'Server converts the video' : audio ? 'Server converts the audio' : 'Server repackages the file';
        return { url: base + source.TranscodingUrl, hls: true, method: 'Transcode', label };
    }
    const q = new URLSearchParams({ static: 'true', mediaSourceId: source.Id, ApiKey: cfg.apiKey });
    if (source.ETag) q.set('Tag', source.ETag);
    return { url: `${base}/Videos/${encodeURIComponent(itemId)}/stream?${q}`, hls: false, method: 'DirectPlay', label: 'Direct play' };
}

// ===== Jellyfin playback reports =====
function sessionBody(session, time, extra = {}) {
    return {
        ItemId: session.itemId,
        MediaSourceId: session.mediaSourceId,
        PlaySessionId: session.playSessionId,
        PlayMethod: session.method,
        PositionTicks: Math.round((time || 0) * TICKS),
        CanSeek: true,
        ...extra,
    };
}

function post(session, path, body, keepalive = false) {
    const cfg = getConfig();
    if (!cfg || !session.base) return Promise.resolve();
    return fetch(session.base + path, {
        method: 'POST',
        headers: { ...jfAuth(cfg.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive,
    }).catch(() => { /* reports are best effort */ });
}

async function reportStart(session, engine) {
    session.started = true;
    await post(session, '/Sessions/Playing', sessionBody(session, engine.time, { IsPaused: engine.paused }));
}

function reportProgress(session, engine) {
    if (!session.started || session.stopped) return;
    post(session, '/Sessions/Playing/Progress', sessionBody(session, engine.time, { IsPaused: engine.paused, EventName: 'timeupdate' }));
}

// On leaving: tell Jellyfin where we stopped and end the conversion, so the graphics card is free again
function stopSession(session, time) {
    if (!session.started || session.stopped) return;
    session.stopped = true;
    post(session, '/Sessions/Playing/Stopped', sessionBody(session, time), true);
    if (session.hls && session.playSessionId) {
        const cfg = getConfig();
        if (cfg) {
            fetch(`${session.base}/Videos/ActiveEncodings?deviceId=${encodeURIComponent(deviceId())}&playSessionId=${encodeURIComponent(session.playSessionId)}`, {
                method: 'DELETE', headers: jfAuth(cfg.apiKey), keepalive: true,
            }).catch(() => {});
        }
    }
}

// ===== AniList =====
// Once per episode page, forward only. The Jellyfin webhook may report the same episode from the
// server side — whoever comes second finds the progress already there and writes nothing.
async function saveEpisode(media, episode, token) {
    const user = getState().user;
    if (!user?.id || !token) return;
    const total = media.episodes || null;
    try {
        const entry = await api.getUserMediaProgress(user.id, media.id, token);
        let vars;
        if (!entry) {
            vars = { mediaId: media.id, progress: episode, status: total && episode >= total ? 'COMPLETED' : 'CURRENT', startedAt: api.fuzzyToday() };
            if (vars.status === 'COMPLETED') vars.completedAt = api.fuzzyToday();
        } else if (entry.status === 'COMPLETED') {
            // Episode 1 of a finished show starts a rewatch; any other single episode is just a revisit
            if (episode !== 1 || !total || total < 2) return;
            vars = { id: entry.id, status: 'REPEATING', progress: 1 };
        } else if ((entry.progress || 0) >= episode) {
            return;
        } else {
            vars = api.progressVars(entry, episode, total);
        }
        const saved = await api.saveMediaListEntry(vars, token);
        emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress });
        emitWatched(media);
        toast(saved.status === 'COMPLETED' ? `${titlePref(media.title)} completed` : `Episode ${saved.progress} saved to AniList`, 'success');
    } catch (err) {
        toast(err.queued ? err.message : `AniList: ${err.message}`, 'error');
    }
}
