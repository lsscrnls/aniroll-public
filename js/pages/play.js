import * as api from '../api.js?v=161';
import { getState, toast, esc, titlePref, emitListChange, emitWatched } from '../store.js?v=161';
import { getToken, isLoggedIn } from '../auth.js?v=161';
import { getConfig, jfAuth, deviceId, TRACKED_EVENT } from '../jellyfin.js?v=161';
import { availability } from '../player/availability.js?v=161';
import { findEpisode, jfGet } from '../player/library.js?v=161';
import { deviceProfile } from '../player/profile.js?v=161';
import { HtmlVideoEngine } from '../player/engine.js?v=161';
import { controlsHtml, mountControls, icon } from '../player/controls.js?v=161';
import { createSubtitles } from '../player/subtitles.js?v=161';
import { neighbours, openEpisodes } from '../player/episodes.js?v=161';

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
        <div class="player is-paused is-loading" id="player" data-lenis-prevent>
            <video class="player-video" id="player-video" playsinline crossorigin="anonymous"></video>
            ${controlsHtml()}
            <div class="player-top">
                <a class="pl-btn player-back" id="player-back" href="#/anime/${mediaId}" aria-label="Back" title="Back">${icon('back')}</a>
                <div class="player-title">
                    <div class="player-show" id="player-show"></div>
                    <div class="player-episode" id="player-episode">Episode ${episode}</div>
                </div>
                <div class="player-method" id="player-method" hidden></div>
                <button class="pl-btn player-episodes" id="player-episodes" type="button" aria-label="Episodes" title="Episodes (E)" hidden>${icon('episodes')}</button>
                ${isLoggedIn() ? `<button class="pl-btn player-party" id="player-party" type="button" aria-label="Watch Party" title="Watch Party: start one for this show, or see who is in">${icon('party')}</button>` : ''}
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
    let endInfo = null;
    let controls = null;
    let subtitles = null;
    let offTracked = () => {};

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

    // Try again: once playing, from the very second it stopped; before that, the same page from the start
    // (the server may be free again)
    let retryInPlace = null;
    content.addEventListener('click', (ev) => {
        if (!ev.target.closest('[data-retry]')) return;
        if (retryInPlace) return retryInPlace();
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

    const pageTitle = document.title;
    const cleanup = () => {
        if (closed) return;
        closed = true;
        document.title = pageTitle;
        clearMediaSession();
        clearInterval(reportTimer);
        controls?.destroy();
        subtitles?.destroy();
        offTracked();
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

        // The show as the last episode left it (Up next, the episode list): no second look-up on AniList
        const [avail, media] = await Promise.all([availability(true), carriedMedia(mediaId) || api.getMedia(mediaId, token)]);
        if (closed) return cleanup;
        $('player-show').textContent = titlePref(media.title);
        $('player-party')?.addEventListener('click', async () => {
            const { partyFromPlayer } = await import('./watchparty.js?v=161');
            partyFromPlayer(media, episode, { root: $('player'), pause: () => video.pause() });
        });
        if (!avail) throw new Error('Your Jellyfin server cannot be reached right now');
        session.base = avail.base;
        // Every episode Jellyfin has, this one marked: picking another plays it right here
        const episodesBtn = $('player-episodes');
        const pickEpisode = () => openEpisodes(media, avail.base, { current: episode });
        episodesBtn.hidden = false;
        // For whatever tells others what you are watching (js/presence.js)
        document.dispatchEvent(new CustomEvent('aniroll:playing', { detail: { media, episode } }));
        episodesBtn.addEventListener('click', pickEpisode);
        const onEpisodesKey = (ev) => {
            if (ev.key.toLowerCase() !== 'e' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (ev.target.closest?.('input, textarea, select, [contenteditable], .modal-backdrop')) return;
            ev.preventDefault();
            pickEpisode();
        };
        document.addEventListener('keydown', onEpisodesKey);
        window.addEventListener('hashchange', () => document.removeEventListener('keydown', onEpisodesKey), { once: true });

        status('Finding the episode...');
        const ep = await findEpisode(avail.base, media, episode);
        if (closed) return cleanup;
        if (!ep) throw new Error(`Episode ${episode} is not in your Jellyfin library`);
        session.itemId = ep.itemId;
        session.runtime = ep.runTimeTicks ? ep.runTimeTicks / TICKS : 0;
        // A file with two episodes ("E05-E06") counts as both: AniList gets 6, Up next is episode 7
        const lastEp = Math.max(episode, Math.min(ep.episodeEnd || episode, media.episodes || Infinity));
        const epLabel = lastEp > episode ? `Episodes ${episode}–${lastEp}` : `Episode ${episode}`;
        $('player-episode').textContent = media.format === 'MOVIE' ? '' : `${epLabel}${ep.name && !/^episode \d+$/i.test(ep.name) ? ` · ${ep.name}` : ''}`;
        document.title = media.format === 'MOVIE' ? `${titlePref(media.title)} · AniRoll` : `${titlePref(media.title)} · ${epLabel} · AniRoll`;

        // Continue where it stopped, unless it was watched to the end
        const startTime = !ep.played && ep.positionTicks && ep.runTimeTicks && ep.positionTicks < ep.runTimeTicks * WATCHED_AT
            ? ep.positionTicks / TICKS : 0;

        status('Asking Jellyfin how to play it...');
        session.quality = savedQuality();
        // Auto: measured once per page (and kept a while); Max: the top step; else the step picked
        let autoBitrate = null;
        const bitrateFor = async (q) => (q === 'max' ? MAX_BITRATE : q !== 'auto' ? q
            : (autoBitrate ??= await measureBitrate(avail, cfg)));
        let info = await playbackInfo(avail, cfg, ep.itemId, startTime, { maxBitrate: await bitrateFor(session.quality) });
        if (closed) return cleanup;
        let source = info.MediaSources?.[0];
        if (!source) throw new Error(info.ErrorCode ? `Jellyfin cannot play this (${info.ErrorCode})` : 'Jellyfin found no playable file');

        // The audio language picked for this show before (dual audio: the dub or the original), when this
        // file has it; otherwise Jellyfin's pick from the user's language settings
        const audioTracks = audioList(source);
        const wanted = preferredAudio(mediaId, audioTracks);
        session.audioIndex = source.DefaultAudioStreamIndex ?? audioTracks[0]?.id ?? null;
        if (wanted != null && wanted !== session.audioIndex) {
            const again = await playbackInfo(avail, cfg, ep.itemId, startTime, { audioIndex: wanted, maxBitrate: await bitrateFor(session.quality) }).catch(() => null);
            if (closed) return cleanup;
            if (again?.MediaSources?.[0]) {
                info = again;
                source = again.MediaSources[0];
                session.audioIndex = wanted;
            }
        }
        session.mediaSourceId = source.Id;
        session.playSessionId = info.PlaySessionId;

        const plan = playPlan(avail.base, cfg, ep.itemId, source, session.audioIndex);
        // What plays right now, for the stats
        const now = { source, plan };
        session.hls = plan.hls;
        session.method = plan.method;
        $('player-method').textContent = plan.label;
        $('player-method').hidden = false;
        controls = mountControls($('player'), video, {
            watchedAt: WATCHED_AT,
            runtime: () => (ep.runTimeTicks ? ep.runTimeTicks / TICKS : 0),
            autoSkip: { get: () => autoSkipFor(mediaId), set: (on) => setAutoSkip(mediaId, on) },
        });
        setupMediaSession(media, epLabel, controls, engine);
        // The subtitles chosen for this show before (or none), when this file has them
        subtitles = createSubtitles({ video, base: avail.base, cfg, itemId: ep.itemId, source,
            pick: (tracks) => preferredSubs(mediaId, tracks),
            onLoading: (on) => controls?.setSubtitlesLoading(on) });
        const subsManager = subtitles;
        controls.setSubtitles({
            ...subsManager,
            select: (id) => {
                subsManager.select(id);
                rememberSubs(mediaId, subsManager.list().find(t => t.id === id));
            },
        });

        // Another audio track or quality: the browser cannot switch inside a file, so Jellyfin serves it
        // again (with that track, under that bitrate) from where it is now
        let switching = false;
        const restart = async ({ audioIndex = session.audioIndex, quality = session.quality }, note) => {
            if (switching || closed) return;
            switching = true;
            const at = engine.time;
            const wasPaused = engine.paused;
            try {
                engine.pause();
                status(note);
                stopSession(session, at);
                const next = await playbackInfo(avail, cfg, ep.itemId, at, { audioIndex, maxBitrate: await bitrateFor(quality) });
                if (closed) return;
                const src = next.MediaSources?.[0];
                if (!src) throw new Error('Jellyfin cannot play it this way');
                const p = playPlan(avail.base, cfg, ep.itemId, src, audioIndex);
                Object.assign(session, { mediaSourceId: src.Id, playSessionId: next.PlaySessionId, audioIndex, quality,
                    hls: p.hls, method: p.method, started: false, stopped: false });
                Object.assign(now, { source: src, plan: p });
                $('player-method').textContent = p.label;
                await engine.load({ url: p.url, hls: p.hls, startTime: at });
                if (closed) return;
                status('');
                await reportStart(session, engine);
                if (!wasPaused) engine.play().catch(() => { /* the controls are there */ });
            } catch (err) {
                if (!closed) status(err.message, { error: true });
            } finally {
                switching = false;
            }
        };
        controls.setAudio({
            list: () => audioTracks.map(t => ({ id: t.id, label: t.label })),
            current: () => session.audioIndex,
            select: (id) => {
                if (id === session.audioIndex) return;
                rememberAudio(mediaId, audioTracks.find(t => t.id === id));
                restart({ audioIndex: id }, 'Switching the audio...');
            },
        });
        controls.setQuality({
            list: () => [
                { id: 'auto', label: autoBitrate ? `Auto (${fmtRate(autoBitrate)})` : 'Auto' },
                { id: 'max', label: `Maximum (${fmtRate(MAX_BITRATE)})` },
                ...BITRATES.map(b => ({ id: b, label: fmtRate(b) })),
            ],
            current: () => session.quality,
            select: (q) => {
                if (q === session.quality) return;
                saveQuality(q);
                restart({ quality: q }, 'Changing the quality...');
            },
        });
        controls.setStats(() => statsFor({ now, session, engine, video, avail, cfg, subtitles, audioTracks, autoBitrate: () => autoBitrate }));

        status(plan.hls ? 'Starting the stream...' : 'Loading...');
        await engine.load({ url: plan.url, hls: plan.hls, startTime });
        if (closed) return cleanup;
        status('');

        const runtime = () => (ep.runTimeTicks ? ep.runTimeTicks / TICKS : 0) || engine.duration;

        // The next episode, if Jellyfin has it: the Up next card, and its subtitles unpacked ahead
        const nextNumber = lastEp + 1;
        const nextEp = media.format === 'MOVIE' || (media.episodes && lastEp >= media.episodes)
            ? Promise.resolve(null)
            : findEpisode(avail.base, media, nextNumber).catch(() => null);
        nextEp.then(n => {
            if (closed) return;
            if (!n) {
                endInfo = endCard(media, mediaId, lastEp, token);
                return controls.setEnd(endInfo);
            }
            const mins = n.runTimeTicks ? Math.round(n.runTimeTicks / TICKS / 60) : 0;
            controls.setNext({
                title: `Episode ${nextNumber}${n.name && !/^episode \d+$/i.test(n.name) ? ` · ${n.name}` : ''}`,
                image: n.image,
                meta: mins ? `${mins} min` : '',
                // Replaces this episode in the history: Back still leads to where Play was pressed
                go: () => { upNextArrival = `${mediaId}/${nextNumber}`; location.replace(`#/play/${mediaId}/${nextNumber}`); },
            });
        });
        if (media.format !== 'MOVIE' && episode > 1) {
            controls.setPrev({ go: () => location.replace(`#/play/${mediaId}/${episode - 1}`) });
        }

        // The connection broke off mid-episode (Wi-Fi, the stream through Cloudflare): one quiet try from the
        // same second before saying anything. A file the browser cannot play, or a converter that failed
        // (the graphics card full), would only fail again: those are shown at once.
        let quietRetry = 0;
        retryInPlace = () => restart({}, 'Reconnecting...');
        engine.on('error', (err) => {
            if ((err.kind === 'network' || err.kind === 'media') && Date.now() - quietRetry > 2 * 60 * 1000) {
                quietRetry = Date.now();
                return restart({}, 'Reconnecting...');
            }
            status(err.message, { error: true });
        });
        video.addEventListener('timeupdate', () => {
            const total = runtime();
            if (!session.warmed && total && engine.time / total >= WARM_AT) {
                session.warmed = true;
                nextEp.then(n => { if (n && !closed) warmSubtitles(avail.base, cfg, n.itemId); });
            }
            if (!session.done && total && engine.time / total >= WATCHED_AT) {
                session.done = true;
                if (!session.runtime) session.runtime = total;
                saveUserData(session, engine.time);
                if (isLoggedIn()) {
                    saveEpisode(media, mediaId, lastEp, token).then(saved => {
                        // The last episode: ask for a score right on the end card
                        if (closed || !saved || saved.status !== 'COMPLETED' || !endInfo) return;
                        endInfo = { ...endInfo, rate: scorePrompt(media, saved, token) };
                        controls.setEnd(endInfo);
                    });
                }
            }
        });
        // Jellyfin's webhook got there first (our server wrote it): nothing left to write from here
        const onTracked = (e) => {
            const item = e.detail;
            if (item?.status !== 'saved' || item.mediaId !== mediaId || !(item.progress >= lastEp)) return;
            session.done = true;
            media.mediaListEntry = { ...(media.mediaListEntry || {}), progress: item.progress, ...(item.entryStatus ? { status: item.entryStatus } : {}) };
            carry(mediaId, media);
        };
        window.addEventListener(TRACKED_EVENT, onTracked);
        offTracked = () => window.removeEventListener(TRACKED_EVENT, onTracked);
        const report = () => { reportProgress(session, engine); mediaPosition(engine); };
        video.addEventListener('pause', report);
        video.addEventListener('play', report);
        video.addEventListener('seeked', report);

        loadSegments(avail.base, cfg, ep.itemId).then(list => { if (!closed) controls.setSegments(list); });
        if (media.idMal) loadEnding(media.idMal, episode).then(list => { if (!closed && list.length) controls.setEnding(list); });
        loadChapters(avail.base, cfg, ep.itemId).then(list => { if (!closed) controls.setChapters(list); });
        await reportStart(session, engine);
        reportTimer = setInterval(report, REPORT_EVERY);
        // Stopped part-way before: continue there or start over. Not when Up next brought us here
        const cameByUpNext = upNextArrival === `${mediaId}/${episode}`;
        upNextArrival = null;
        if (startTime > 0 && !cameByUpNext) {
            const choice = await controls.askResume(startTime);
            if (closed) return cleanup;
            if (choice === 'restart') engine.seek(0);
        }
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

// Where the ending is, from AniSkip (api.aniskip.com: community-voted times by MyAnimeList id and episode):
// whether story runs on during the ending ("mixed-ed") or after it. Times count from its file's start, so the
// player only uses them for a file of the same length. Kept a week per episode; nothing found: Jellyfin's
// segments alone. [{ type: 'ed' | 'mixed-ed', start, end, length }] in seconds
const ENDING_KEY = 'aniroll_endings';
const ENDING_TTL = 7 * 24 * 60 * 60 * 1000;
async function loadEnding(malId, episode) {
    const key = `${malId}/${episode}`;
    let kept = {};
    try { kept = JSON.parse(localStorage.getItem(ENDING_KEY) || '{}') || {}; } catch { /* none */ }
    if (kept[key] && Date.now() - kept[key].at < ENDING_TTL) return kept[key].list;
    let list = [];
    try {
        const res = await fetch(`https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}`
            + '?types[]=ed&types[]=mixed-ed&episodeLength=0', { signal: AbortSignal.timeout(6000) });
        // 404 means nobody submitted this episode: kept as "nothing", like an answer
        if (!res.ok && res.status !== 404) return [];
        const data = await res.json();
        list = (data?.results || []).map(r => ({ type: r.skipType, start: Number(r.interval?.startTime) || 0,
            end: Number(r.interval?.endTime) || 0, length: Number(r.episodeLength) || 0 }))
            .filter(r => (r.type === 'ed' || r.type === 'mixed-ed') && r.end > r.start);
    } catch { return []; }
    const now = Date.now();
    for (const k of Object.keys(kept)) if (now - kept[k].at >= ENDING_TTL) delete kept[k];
    kept[key] = { at: now, list };
    try { localStorage.setItem(ENDING_KEY, JSON.stringify(kept)); } catch { /* not kept */ }
    return list;
}

// Chapters as the file has them (an MKV's chapter list, read by Jellyfin): [{ name, start }] in seconds.
// Jellyfin can also make up chapters every few minutes for its chapter pictures; evenly spaced ones
// like that say nothing about the episode and are left out. Older and newer servers name the item
// path differently, so both are tried. Nothing there or no answer: no marks.
async function loadChapters(base, cfg, itemId) {
    const id = encodeURIComponent(itemId);
    const user = encodeURIComponent(cfg.userId || '');
    for (const path of [`/Items/${id}?userId=${user}&fields=Chapters`, `/Users/${user}/Items/${id}`]) {
        let item;
        try { item = await jfGet(base, path, cfg.apiKey); } catch { continue; }
        const list = (item?.Chapters || []).map(c => ({
            start: (c.StartPositionTicks || 0) / TICKS,
            // "Chapter 3" only numbers it: the mark stays, the label does not
            name: /^(chapter|kapitel|chapitre)\s*\d+$/i.test(String(c.Name || '').trim()) ? '' : String(c.Name || '').trim().slice(0, 60),
        })).sort((a, b) => a.start - b.start);
        const gaps = list.slice(1).map((c, i) => c.start - list[i].start);
        const madeUp = gaps.length >= 2 && gaps.every(g => Math.abs(g - gaps[0]) < 1) && list.every(c => !c.name);
        return list.length >= 2 && !madeUp ? list : [];
    }
    return [];
}

// ===== Stats for nerds =====
// [{ title, rows: [[label, value]] }], asked for about once a second while the panel shows. What Jellyfin's
// converter does (speed, hardware) comes from its session list, fetched at most every 3 seconds.
let transcodeInfo = { at: 0, value: null, busy: false };
function refreshTranscodeInfo(avail, cfg) {
    if (transcodeInfo.busy || Date.now() - transcodeInfo.at < 3000) return;
    transcodeInfo.busy = true;
    fetch(`${avail.base}/Sessions?deviceId=${encodeURIComponent(deviceId())}`, { headers: jfAuth(cfg.apiKey), signal: AbortSignal.timeout(5000) })
        .then(r => (r.ok ? r.json() : []))
        .then(list => { transcodeInfo.value = (list || []).find(x => x.TranscodingInfo)?.TranscodingInfo || null; })
        .catch(() => { /* shown as unknown */ })
        .finally(() => { transcodeInfo.at = Date.now(); transcodeInfo.busy = false; });
}

function statsFor({ now, session, engine, video, avail, cfg, subtitles, audioTracks, autoBitrate }) {
    const src = now.source || {};
    const streams = src.MediaStreams || [];
    const v = streams.find(x => x.Type === 'Video') || {};
    const a = streams.find(x => x.Type === 'Audio' && x.Index === session.audioIndex) || {};
    const url = new URLSearchParams((now.plan?.url || '').split('?')[1] || '');
    const reasons = (url.get('TranscodeReasons') || '').split(',').filter(Boolean).map(r => r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    const rate = (bps) => (bps ? fmtRate(bps) : '–');
    const res = (w, h) => (w && h ? `${w}×${h}` : '–');

    const t = video.currentTime || 0;
    let ahead = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 0.5) ahead = Math.max(ahead, video.buffered.end(i) - t);
    const q = video.getVideoPlaybackQuality?.();
    const hls = engine.hls;
    const level = hls?.levels?.[hls.currentLevel];
    const sub = subtitles?.list().find(x => x.id === subtitles.current());
    const kind = sub ? (subtitles.kind?.(sub.id) || '') : '';

    if (session.hls) refreshTranscodeInfo(avail, cfg);
    const tc = session.hls ? transcodeInfo.value : null;
    const quality = session.quality === 'auto' ? `Auto${autoBitrate() ? ` · ${fmtRate(autoBitrate())}` : ''}`
        : session.quality === 'max' ? 'Maximum' : fmtRate(session.quality);

    return [
        { title: 'Playback', rows: [
            ['Method', `${now.plan?.label || '–'}${session.hls ? ' (HLS)' : ''}`],
            ...(reasons.length ? [['Why', reasons.join(', ')]] : []),
            ['Quality', quality],
            ['Server', `${avail.local ? 'Local' : 'Public'} · ${avail.base.replace(/^https?:\/\//, '')}`],
        ] },
        { title: 'Source', rows: [
            ['Container', (src.Container || '–').toUpperCase()],
            ['Video', [v.Codec?.toUpperCase(), v.Profile, v.BitDepth ? `${v.BitDepth}-bit` : '', res(v.Width, v.Height),
                v.RealFrameRate ? `${+v.RealFrameRate.toFixed(3)} fps` : ''].filter(Boolean).join(' · ') || '–'],
            ['Audio', [a.Codec?.toUpperCase(), a.ChannelLayout || (a.Channels ? `${a.Channels} ch` : ''), a.Language].filter(Boolean).join(' · ') || '–'],
            ['Bitrate', rate(src.Bitrate)],
        ] },
        { title: 'Stream', rows: [
            ['Video', session.hls ? [url.get('VideoCodec')?.split(',')[0]?.toUpperCase(), tc ? (tc.IsVideoDirect ? 'copied' : 'converted') : ''].filter(Boolean).join(' · ') || '–' : 'as is'],
            ['Audio', session.hls ? [url.get('AudioCodec')?.split(',')[0]?.toUpperCase(), tc ? (tc.IsAudioDirect ? 'copied' : 'converted') : ''].filter(Boolean).join(' · ') || '–' : 'as is'],
            ['Picture', res(video.videoWidth, video.videoHeight)],
            ['Bitrate', rate(level?.bitrate || tc?.Bitrate || Number(url.get('VideoBitrate')) || 0)],
            ...(tc ? [['Converter', [tc.HardwareAccelerationType ? `GPU (${tc.HardwareAccelerationType})` : 'CPU',
                tc.Framerate ? `${Math.round(tc.Framerate)} fps` : '', tc.CompletionPercentage ? `${Math.round(tc.CompletionPercentage)} % done` : ''].filter(Boolean).join(' · ')]] : []),
        ] },
        { title: 'This browser', rows: [
            ['Buffer', `${ahead.toFixed(1)} s ahead`],
            ['Frames', q ? `${q.droppedVideoFrames} dropped of ${q.totalVideoFrames}` : '–'],
            ...(hls ? [['Bandwidth', rate(hls.bandwidthEstimate)]] : []),
            ['Subtitles', sub ? `${sub.label}${kind ? ` · ${kind}` : ''}` : 'Off'],
            ['Audio tracks', String(audioTracks.length)],
        ] },
    ];
}

// ===== Quality: a bitrate cap, as in Jellyfin's own player (it picks the resolution to fit) =====
const QUALITY_KEY = 'aniroll_player_quality';
const BITRATES = [120e6, 80e6, 60e6, 40e6, 20e6, 15e6, 10e6, 8e6, 6e6, 4e6, 3e6, 1.5e6, 720e3, 420e3];
const fmtRate = (bps) => (bps >= 1e6 ? `${+(bps / 1e6).toFixed(1)} Mbps` : `${Math.round(bps / 1e3)} kbps`);

const MAX_BITRATE = BITRATES[0];

// 'auto', 'max' or a bitrate in bits per second, kept for this browser
function savedQuality() {
    try {
        const v = localStorage.getItem(QUALITY_KEY);
        return v === 'max' ? 'max' : v && BITRATES.includes(Number(v)) ? Number(v) : 'auto';
    } catch { return 'auto'; }
}

// Auto: what the way to the server carries right now, measured like Jellyfin's own player does
// (a download from /Playback/BitrateTest), 80 % of it; kept ten minutes per server address.
// Unmeasurable: the fixed guesses, generous at home, careful over the internet.
const BITRATE_TEST_KEY = 'aniroll_bitrate_test';
async function measureBitrate(avail, cfg) {
    const fallback = avail.local ? LOCAL_BITRATE : PUBLIC_BITRATE;
    try {
        const kept = JSON.parse(sessionStorage.getItem(BITRATE_TEST_KEY) || 'null');
        if (kept?.base === avail.base && Date.now() - kept.at < 10 * 60 * 1000) return kept.bps;
    } catch { /* measure again */ }
    const once = async (size) => {
        const t = performance.now();
        const res = await fetch(`${avail.base}/Playback/BitrateTest?Size=${size}`, { headers: jfAuth(cfg.apiKey), cache: 'no-store', signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`bitrate test ${res.status}`);
        const bytes = (await res.arrayBuffer()).byteLength;
        return (bytes * 8) / Math.max(0.05, (performance.now() - t) / 1000);
    };
    try {
        // A small one first; when that was quick, a bigger one tells more
        let bps = await once(500_000);
        if (bps > 10e6) bps = await once(3_000_000);
        const cap = Math.max(BITRATES.at(-1), Math.min(MAX_BITRATE, Math.round(bps * 0.8)));
        try { sessionStorage.setItem(BITRATE_TEST_KEY, JSON.stringify({ base: avail.base, at: Date.now(), bps: cap })); } catch { /* measured each time */ }
        return cap;
    } catch {
        return fallback;
    }
}
function saveQuality(q) {
    try { q === 'auto' ? localStorage.removeItem(QUALITY_KEY) : localStorage.setItem(QUALITY_KEY, String(q)); } catch { /* not kept */ }
}

// ===== Choices kept per show (audio, subtitles, skipping intros) =====
// { 'm<anilistId>': value } — a letter first, so the keys keep their order (newest last); the 200 shows
// chosen for most recently are kept
function showPref(key, mediaId) {
    try { return JSON.parse(localStorage.getItem(key) || '{}')[`m${mediaId}`] ?? null; } catch { return null; }
}
function setShowPref(key, mediaId, value) {
    try {
        const all = JSON.parse(localStorage.getItem(key) || '{}');
        delete all[`m${mediaId}`];
        if (value != null) all[`m${mediaId}`] = value;
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k];
        localStorage.setItem(key, JSON.stringify(all));
    } catch { /* not kept */ }
}

// ===== Audio tracks =====
const AUDIO_PREF_KEY = 'aniroll_audio_pref';

function audioList(source) {
    return (source.MediaStreams || []).filter(s => s.Type === 'Audio').map(s => ({
        id: s.Index,
        label: s.DisplayTitle || s.Title || s.Language || `Track ${s.Index}`,
        lang: s.Language || '',
        title: s.Title || '',
    }));
}

// The track matching what was chosen for this show: same language and name, else same language
function preferredAudio(mediaId, tracks) {
    const pref = showPref(AUDIO_PREF_KEY, mediaId);
    if (!pref || tracks.length < 2) return null;
    const same = tracks.filter(t => t.lang === pref.lang);
    return (same.find(t => t.title === pref.title) || same[0])?.id ?? null;
}

function rememberAudio(mediaId, track) {
    if (track) setShowPref(AUDIO_PREF_KEY, mediaId, { lang: track.lang, title: track.title });
}

// ===== Subtitles =====
// { 'm<anilistId>': { lang, title, label, forced } or { off: true } } — like the audio, per show
const SUBS_PREF_KEY = 'aniroll_subs_pref';

// The track id to show (null: none), or undefined when nothing was chosen for this show or this file
// lacks it: then Jellyfin's pick stays
function preferredSubs(mediaId, tracks) {
    const pref = showPref(SUBS_PREF_KEY, mediaId);
    if (!pref) return undefined;
    if (pref.off) return null;
    // Same language, then the release's name for the track (Full, Signs & Songs), else what Jellyfin calls it
    const same = tracks.filter(t => t.lang === pref.lang);
    return ((pref.title && same.find(t => t.title === pref.title))
        || same.find(t => t.label === pref.label)
        || same.find(t => t.forced === pref.forced) || same[0])?.id;
}

function rememberSubs(mediaId, track) {
    setShowPref(SUBS_PREF_KEY, mediaId, track ? { lang: track.lang, title: track.title, label: track.label, forced: track.forced } : { off: true });
}

// maxBitrate: the quality chosen, else what the way to the server carries
async function playbackInfo(avail, cfg, itemId, startTime, { audioIndex = null, maxBitrate = null } = {}) {
    const bitrate = maxBitrate || (avail.local ? LOCAL_BITRATE : PUBLIC_BITRATE);
    // The track goes in the query: Jellyfin 12 ignores AudioStreamIndex in the body and takes the one it
    // remembered for the user instead — the previous choice, since AniRoll reports it (seen 2026-09-30)
    const q = new URLSearchParams({ userId: cfg.userId, MaxStreamingBitrate: String(bitrate) });
    if (audioIndex != null) q.set('AudioStreamIndex', String(audioIndex));
    const res = await fetch(`${avail.base}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?${q}`, {
        method: 'POST',
        headers: { ...jfAuth(cfg.apiKey), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            UserId: cfg.userId,
            DeviceProfile: deviceProfile(bitrate),
            MaxStreamingBitrate: bitrate,
            StartTimeTicks: Math.round(startTime * TICKS),
            EnableDirectPlay: true,
            EnableDirectStream: true,
            EnableTranscoding: true,
            AutoOpenLiveStream: true,
            // Another track than the file's first: Jellyfin repackages the file with it
            ...(audioIndex != null ? { AudioStreamIndex: audioIndex } : {}),
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Jellyfin refused — connect again in Settings');
    if (!res.ok) throw new Error(`Jellyfin answered ${res.status}`);
    return res.json();
}

// Direct file, or the HLS stream Jellyfin prepared; and a word on what the server does for it.
// `audioIndex`: the track asked for; the stream URL carries it, whatever Jellyfin put there
function playPlan(base, cfg, itemId, source, audioIndex = null) {
    if (source.TranscodingUrl && audioIndex != null) {
        const [path, query = ''] = source.TranscodingUrl.split('?');
        const q = new URLSearchParams(query);
        if (q.get('AudioStreamIndex') !== String(audioIndex)) {
            q.set('AudioStreamIndex', String(audioIndex));
            source = { ...source, TranscodingUrl: `${path}?${q}` };
        }
    }
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
        // Jellyfin keeps the choice for the series ("Remember audio selections")
        ...(session.audioIndex != null ? { AudioStreamIndex: session.audioIndex } : {}),
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

// Connected with an API key, Jellyfin ties the playback to no user ("User null stopped playback", seen
// 2026-10-02) and keeps neither "played" nor where it stopped. AniRoll writes both for the user itself:
// played from 90 %, else the position (not for the first moments). A signed-in user's session does it alone.
function saveUserData(session, time) {
    const cfg = getConfig();
    if (!cfg || cfg.kind === 'user' || !cfg.userId || !session.base || !session.itemId) return;
    const played = session.runtime > 0 && time / session.runtime >= WATCHED_AT;
    if (played ? session.markedPlayed : time < Math.min(60, session.runtime * 0.05 || 60)) return;
    if (played) session.markedPlayed = true;
    fetch(`${session.base}/UserItems/${encodeURIComponent(session.itemId)}/UserData?userId=${encodeURIComponent(cfg.userId)}`, {
        method: 'POST',
        headers: { ...jfAuth(cfg.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(played ? { Played: true, PlaybackPositionTicks: 0 } : { PlaybackPositionTicks: Math.round(time * TICKS) }),
        keepalive: true,
    }).catch(() => { /* best effort, like the reports */ });
}

// On leaving: tell Jellyfin where we stopped and end the conversion, so the graphics card is free again
function stopSession(session, time) {
    if (!session.started || session.stopped) return;
    session.stopped = true;
    post(session, '/Sessions/Playing/Stopped', sessionBody(session, time), true);
    saveUserData(session, time);
    if (session.hls && session.playSessionId) {
        const cfg = getConfig();
        if (cfg) {
            fetch(`${session.base}/Videos/ActiveEncodings?deviceId=${encodeURIComponent(deviceId())}&playSessionId=${encodeURIComponent(session.playSessionId)}`, {
                method: 'DELETE', headers: jfAuth(cfg.apiKey), keepalive: true,
            }).catch(() => {});
        }
    }
}

// ===== The end card =====
// Jellyfin has no next episode: say why and what comes next, from what the page loaded anyway (the next
// airing, the sequel season and whether it is on the list). Adding the sequel is the only request, on a tap.
function endCard(media, mediaId, episode, token) {
    const back = { label: 'Back to the show', href: `#/anime/${mediaId}` };
    const roll = { label: 'Roll something new', href: '#/roll' };
    const airing = media.nextAiringEpisode;
    const total = media.episodes || null;
    if (media.format === 'MOVIE') return { kicker: 'The end', title: titlePref(media.title), actions: [{ ...back, primary: true }, roll] };
    if (airing && airing.episode === episode + 1) {
        return { kicker: 'Up next', title: `Episode ${airing.episode} airs in ${api.timeUntil(api.untilAiring(airing))}`, actions: [{ ...back, primary: true }, roll] };
    }
    if ((total && episode < total) || (airing && airing.episode > episode + 1)) {
        return { kicker: 'Up next', title: `Episode ${episode + 1} is not in your library yet`, actions: [{ ...back, primary: true }, roll] };
    }
    const sequel = neighbours(media).after;
    if (!sequel) return { kicker: 'That was the last episode', title: titlePref(media.title), actions: [{ ...back, primary: true }, roll] };
    const name = titlePref(sequel.title);
    const add = {
        label: 'Add to Planning',
        primary: true,
        run: async (btn) => {
            btn.disabled = true;
            try {
                await api.saveMediaListEntry({ mediaId: sequel.id, status: 'PLANNING' }, token);
                btn.textContent = 'On your Planning list';
                emitListChange({ mediaId: sequel.id, status: 'PLANNING', progress: 0 });
            } catch (err) {
                btn.disabled = false;
                toast(err.queued ? err.message : `AniList: ${err.message}`, 'error');
            }
        },
    };
    const open = { label: `Open ${name}`, href: `#/anime/${sequel.id}`, primary: true };
    return {
        kicker: 'That was the last episode',
        title: sequel.status === 'NOT_YET_RELEASED' ? `${name} is announced` : `${name} is out`,
        actions: [isLoggedIn() && !sequel.mediaListEntry ? add : open, back],
    };
}

// ===== AniList =====
// Once per episode page, forward only. The Jellyfin webhook may report the same episode from the
// server side — whoever comes second finds the progress already there and writes nothing.
// The show travels on to the next episode's page (Up next, the episode list), with the list entry
// as this page left it: one AniList request per episode, the one that saves it
const CARRY_MS = 3 * 60 * 60 * 1000;
// The episode Up next is opening: it starts right away, no Continue / Start over question
let upNextArrival = null;
let carried = null; // { id (as in the address), media, at }
function carry(id, media) { carried = { id, media, at: Date.now() }; }
function carriedMedia(id) {
    return carried && carried.id === id && Date.now() - carried.at < CARRY_MS ? carried.media : null;
}

async function saveEpisode(media, mediaId, episode, token) {
    const user = getState().user;
    if (!user?.id || !token) return;
    const total = media.episodes || null;
    try {
        // The entry came with the show at the start: no second read before writing
        const entry = media.mediaListEntry || null;
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
        // Jellyfin played it, so it knows: no mirroring back (that cost a title lookup on AniList)
        const saved = await api.saveMediaListEntry(vars, token, { mirror: false });
        media.mediaListEntry = { ...(entry || {}), ...saved };
        carry(mediaId, media);
        emitListChange({ mediaId: media.id, status: saved.status, progress: saved.progress });
        emitWatched(media, saved.progress);
        toast(saved.status === 'COMPLETED' ? `${titlePref(media.title)} completed` : `Episode ${saved.progress} saved to AniList`, 'success');
        return saved;
    } catch (err) {
        toast(err.queued ? err.message : `AniList: ${err.message}`, 'error');
        return null;
    }
}

// The end card's score: a slider on the 100 scale, saved with one request when tapped
function scorePrompt(media, saved, token) {
    return {
        value: saved.score || 0,
        save: async (score, btn) => {
            btn.disabled = true;
            try {
                const out = await api.saveMediaListEntry({ id: saved.id, scoreRaw: score }, token, { mirror: false });
                media.mediaListEntry = { ...(media.mediaListEntry || {}), ...out };
                emitListChange({ mediaId: media.id, status: out.status, progress: out.progress, score: out.score });
                btn.textContent = 'Saved';
                btn.classList.add('is-saved');
                toast(`Scored ${titlePref(media.title)} ${score}`, 'success');
            } catch (err) {
                btn.disabled = false;
                toast(err.queued ? err.message : `AniList: ${err.message}`, 'error');
            }
        },
    };
}

// ===== Intros skipped by themselves, per show =====
// Settings → Jellyfin → Player switches it on for every show; a choice made in the player for one show
// (1 on, 0 off) wins over that
const AUTOSKIP_KEY = 'aniroll_autoskip';
const AUTOSKIP_ALL_KEY = 'aniroll_autoskip_all';
const autoSkipAll = () => { try { return localStorage.getItem(AUTOSKIP_ALL_KEY) === 'on'; } catch { return false; } };
const autoSkipFor = (mediaId) => { const v = showPref(AUTOSKIP_KEY, mediaId); return v == null ? autoSkipAll() : !!v; };
const setAutoSkip = (mediaId, on) => setShowPref(AUTOSKIP_KEY, mediaId, on === autoSkipAll() ? null : (on ? 1 : 0));

// ===== Media keys, headset buttons, the lock screen and the browser's media hub =====
// Each part is asked for on its own: some browsers lack the position or some of the actions
function setupMediaSession(media, epLabel, controls, engine) {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
        const cover = media.coverImage?.extraLarge || media.coverImage?.large;
        ms.metadata = new MediaMetadata({
            title: media.format === 'MOVIE' ? titlePref(media.title) : epLabel,
            artist: titlePref(media.title),
            album: 'AniRoll',
            // AniList's cover, never a Jellyfin address with a key in it
            artwork: cover ? [{ src: cover, sizes: '460x650', type: 'image/jpeg' }] : [],
        });
    } catch { /* no metadata */ }
    const handlers = {
        play: () => controls.act('play'),
        pause: () => controls.act('pause'),
        seekbackward: (d) => controls.act('back', d?.seekOffset),
        seekforward: (d) => controls.act('forward', d?.seekOffset),
        seekto: (d) => { if (d?.seekTime != null) controls.act('seek', d.seekTime); },
        nexttrack: () => controls.act('next'),
        previoustrack: () => controls.act('previous'),
        skipad: () => controls.act('skip'),
    };
    for (const [name, fn] of Object.entries(handlers)) {
        try { ms.setActionHandler(name, fn); } catch { /* not supported here */ }
    }
    mediaPosition(engine);
}

function mediaPosition(engine) {
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState) return;
    const duration = engine.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try { ms.setPositionState({ duration, position: Math.min(duration, Math.max(0, engine.time || 0)), playbackRate: engine.video?.playbackRate || 1 }); } catch { /* ignored */ }
}

function clearMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try { ms.metadata = null; } catch { /* nothing set */ }
    for (const name of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack', 'skipad']) {
        try { ms.setActionHandler(name, null); } catch { /* not supported */ }
    }
}
