// The player's own controls, Material 3 Expressive in both designs (a video is always dark, so the
// player uses the fixed colour roles of the scheme, which read the same in light and dark mode).
// The seek bar is the same wave as every progress bar in AniRoll: wave up to where you are, a handle,
// flat track after it. The dot on the track marks 90%, where AniList counts the episode.
//   mountControls(root, video, { watchedAt }) -> destroy()
// Icons: Material Symbols Rounded 400 (Apache-2.0), inline so both designs show them.

const ICON = {
    play: 'M320-258v-450q0-14 9-22t21-8q4 0 8 1t8 3l354 226q7 5 10.5 11t3.5 14q0 8-3.5 14T720-458L366-232q-4 2-8 3t-8 1q-12 0-21-8t-9-22Z',
    pause: 'M615-200q-24.75 0-42.37-17.63Q555-235.25 555-260v-440q0-24.75 17.63-42.38Q590.25-760 615-760h55q24.75 0 42.38 17.62Q730-724.75 730-700v440q0 24.75-17.62 42.37Q694.75-200 670-200h-55Zm-325 0q-24.75 0-42.37-17.63Q230-235.25 230-260v-440q0-24.75 17.63-42.38Q265.25-760 290-760h55q24.75 0 42.38 17.62Q405-724.75 405-700v440q0 24.75-17.62 42.37Q369.75-200 345-200h-55Z',
    back10: 'M360-522h-30q-10.4 0-17.2-7.12-6.8-7.11-6.8-18 0-10.88 7.08-17.38 7.09-6.5 17.92-6.5h55q11 0 17.5 6.5T410-547v212q0 10.83-7.12 17.92-7.11 7.08-18 7.08-10.88 0-17.88-7.08-7-7.09-7-17.92v-187Zm147 212q-18.7 0-31.35-12.65Q463-335.3 463-354v-173q0-18.7 12.65-31.35Q488.3-571 507-571h83q18.7 0 31.35 12.65Q634-545.7 634-527v173q0 18.7-12.65 31.35Q608.7-310 590-310h-83Zm6-50h71v-162h-71v162ZM339.5-108Q274-136 225-185t-77-114.5Q120-365 120-440q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38 0 125.36 87.5 212.68Q355-140 480-140t212.5-87.32Q780-314.64 780-440q0-125.36-85-212.68Q610-740 485-740h-22l52 52q9 9 9 21t-8.61 21q-9.39 9-21.39 9t-21-9L368-751q-9-9-9-21t9-21l106-106q8-8 20.5-8t20.85 8q7.65 8 7.65 20.5t-8 20.5l-58 58h23q75 0 140.5 28T735-695q49 49 77 114.5T840-440q0 75-28 140.5T735-185q-49 49-114.5 77T480-80q-75 0-140.5-28Z',
    fwd10: 'M339.5-108Q274-136 225-185t-77-114.5Q120-365 120-440t28-140.5Q176-646 225-695t114.5-77Q405-800 480-800h23l-57-57q-8-8-8-20.5t7.65-20.5q8.35-8 20.35-8.5 12-.5 20 7.5l106 106q9 9 9 21t-9 21L487-646q-9 9-21 9t-21.39-9q-8.61-9-8.61-21t9-21l52-52h-22q-125 0-210 87.32T180-440q0 125.36 87.5 212.68Q355-140 480-140t212.5-87.32Q780-314.64 780-440q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38 0 75-28 140.5T735-185q-49 49-114.5 77T480-80q-75 0-140.5-28ZM360-522h-30q-10.4 0-17.2-7.12-6.8-7.11-6.8-18 0-10.88 7.08-17.38 7.09-6.5 17.92-6.5h55q11 0 17.5 6.5T410-547v212q0 10.83-7.12 17.92-7.11 7.08-18 7.08-10.88 0-17.88-7.08-7-7.09-7-17.92v-187Zm147 212q-18.7 0-31.35-12.65Q463-335.3 463-354v-173q0-18.7 12.65-31.35Q488.3-571 507-571h83q18.7 0 31.35 12.65Q634-545.7 634-527v173q0 18.7-12.65 31.35Q608.7-310 590-310h-83Zm6-50h71v-162h-71v162Z',
    volume: 'M780-481q0-94-52.5-169T590-759q-12-5-17-16t0-22q5-12 17.5-16.5t25.5.5q101 41 162.5 131T840-481q0 111-61.5 201T616-149q-13 5-25.5.5T573-165q-5-11 0-22t17-16q85-34 137.5-109T780-481ZM280-360H150q-13 0-21.5-8.5T120-390v-180q0-13 8.5-21.5T150-600h130l149-149q14-14 32.5-6.5T480-728v496q0 20-18.5 27.5T429-211L280-360Zm380-120q0 52-26 94t-73 64q-8 4-14.5-1t-6.5-13v-289q0-8 6.5-13t14.5-1q47 22 73 65t26 94Z',
    muted: 'M681-188q-17 12-35.5 22T607-148q-12 5-24.5 0T565-165q-5-11 .5-22t17.5-16q15-5 28.5-12t26.5-17L473-397v165q0 20-18.5 27.5T422-211L273-360H143q-13 0-21.5-8.5T113-390v-180q0-13 8.5-21.5T143-600h126L70-799q-9-9-8.5-21.5T71-842q9-9 21.5-9t21.5 9l721 721q9 9 9 21.5T835-78q-9 9-22 9t-22-9L681-188Zm92-293q0-93-52.5-168.5T583-759q-12-5-17-16t0-22q5-12 17.5-16.5t25.5.5q101 41 162.5 130.5T833-481q0 38-7.5 75T802-334q-8 17-19.5 20.5T760-315q-11-5-16.5-14.5t.5-20.5q15-30 22-63t7-68ZM576-628q38 23 57.5 63.5T653-480v15q0 7-2 15-2 10-11 13t-17-5l-61-61q-5-5-7-10t-2-11v-91q0-9 7.5-13.5t15.5.5Zm-196-57q-5-5-5-11t5-11l42-42q14-14 32.5-6.5T473-728v100q0 10-9.5 13.5T447-618l-67-67Z',
    subtitles: 'M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-520H140v520Zm0 0v-520 520Zm130-130h300q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm120-120h300q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H390q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm-98.5-8.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Zm420 120q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z',
    pip: 'M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-520H140v520Zm0 0v-520 520Zm336-45h275q12.75 0 21.38-8.63Q781-282.25 781-295v-197q0-12.75-8.62-21.38Q763.75-522 751-522H476q-12.75 0-21.37 8.62Q446-504.75 446-492v197q0 12.75 8.63 21.37Q463.25-265 476-265Zm30-60v-137h215v137H506Z',
    fullscreen: 'M180-180h103q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H150q-12.75 0-21.37-8.63Q120-137.25 120-150v-133q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v103Zm600 0v-103q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v133q0 12.75-8.62 21.37Q822.75-120 810-120H677q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h103ZM180-780v103q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-133q0-12.75 8.63-21.38Q137.25-840 150-840h133q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H180Zm600 0H677q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h133q12.75 0 21.38 8.62Q840-822.75 840-810v133q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-103Z',
    exitFullscreen: 'M253-253H150q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h133q12.75 0 21.38 8.62Q313-295.75 313-283v133q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-103Zm454 0v103q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-133q0-12.75 8.63-21.38Q664.25-313 677-313h133q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H707ZM253-707v-103q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v133q0 12.75-8.62 21.37Q295.75-647 283-647H150q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h103Zm454 0h103q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H677q-12.75 0-21.37-8.63Q647-664.25 647-677v-133q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v103Z',
    back: 'm274-450 227 227q9 9 9 21t-9 21q-9 9-21 9t-21-9L181-459q-5-5-7-10t-2-11q0-6 2-11t7-10l278-278q9-9 21-9t21 9q9 9 9 21t-9 21L274-510h496q13 0 21.5 8.5T800-480q0 13-8.5 21.5T770-450H274Z',
    skipNext: 'M660-280v-400q0-17 11.5-28.5T700-720q17 0 28.5 11.5T740-680v400q0 17-11.5 28.5T700-240q-17 0-28.5-11.5T660-280Zm-440-35v-330q0-18 12-29t28-11q5 0 11 1t11 5l248 166q9 6 13.5 14.5T548-480q0 10-4.5 18.5T530-447L282-281q-5 4-11 5t-11 1q-16 0-28-11t-12-29Z',
    close: 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z',
    check: 'm378-332 363-363q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L399-267q-9 9-21 9t-21-9L175-449q-9-9-8.5-21.5T176-492q9-9 21.5-9t21.5 9l159 160Z',
};

export const icon = (name) => `<svg class="pl-icon" viewBox="0 -960 960 960" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;

const IDLE_MS = 3000;
const STEP = 10;
const VOLUME_KEY = 'aniroll_player_volume';
// Up next: seconds of playing time before the next episode starts by itself
const COUNTDOWN = 10;

export function fmtTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function controlsHtml() {
    return `
        <div class="pl-scrim" aria-hidden="true"></div>
        <div class="pl-center">
            <button class="pl-btn pl-btn-tonal pl-skip" data-act="back10" aria-label="Back 10 seconds" title="Back 10 s (←)">${icon('back10')}</button>
            <button class="pl-btn pl-play" data-act="play" aria-label="Play" title="Play (Space)">${icon('play')}</button>
            <button class="pl-btn pl-btn-tonal pl-skip" data-act="fwd10" aria-label="Forward 10 seconds" title="Forward 10 s (→)">${icon('fwd10')}</button>
        </div>
        <div class="pl-bottom">
            <div class="pl-seek" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00">
                <div class="pl-seek-track"></div>
                <div class="pl-seek-buffer"></div>
                <div class="pl-seek-wave"></div>
                <div class="pl-seek-mark" title="From here the episode counts as watched"></div>
                <div class="pl-seek-handle"></div>
                <div class="pl-seek-hover" aria-hidden="true"></div>
            </div>
            <button class="pl-skip-segment" data-act="skipSegment" hidden></button>
            <div class="pl-next" role="group" aria-label="Up next" hidden>
                <div class="pl-next-text"><span class="pl-next-kicker">Up next</span><span class="pl-next-title"></span></div>
                <button class="pl-next-play" data-act="playNext">${icon('skipNext')}<span class="pl-next-label">Play now</span></button>
                <button class="pl-btn pl-next-cancel" data-act="cancelNext" aria-label="Stay on this episode" title="Stay on this episode">${icon('close')}</button>
            </div>
            <div class="pl-subs-note" role="status" hidden><span class="pl-subs-note-dot" aria-hidden="true"></span>Loading subtitles…</div>
            <div class="pl-row">
                <span class="pl-time"><span class="pl-now">0:00</span> <span class="pl-total">/ 0:00</span></span>
                <span class="pl-spacer"></span>
                <div class="pl-volume">
                    <button class="pl-btn" data-act="mute" aria-label="Mute" title="Mute (M)">${icon('volume')}</button>
                    <input class="pl-volume-slider" type="range" min="0" max="1" step="0.05" aria-label="Volume">
                </div>
                <div class="pl-menu-wrap">
                    <button class="pl-btn" data-act="subs" aria-label="Subtitles" aria-haspopup="menu" aria-expanded="false" title="Subtitles (C)">${icon('subtitles')}</button>
                    <div class="pl-menu" role="menu" hidden></div>
                </div>
                <button class="pl-btn" data-act="pip" aria-label="Picture in picture" title="Picture in picture">${icon('pip')}</button>
                <button class="pl-btn" data-act="fullscreen" aria-label="Full screen" title="Full screen (F)">${icon('fullscreen')}</button>
            </div>
        </div>`;
}

// root: the .player element (holds controlsHtml()), video: its <video>
export function mountControls(root, video, { watchedAt = 0.9, runtime = () => 0 } = {}) {
    const $ = (sel) => root.querySelector(sel);
    const seek = $('.pl-seek');
    const playBtn = $('.pl-play');
    const menu = $('.pl-menu');
    const subsBtn = $('[data-act="subs"]');
    const muteBtn = $('[data-act="mute"]');
    const volume = $('.pl-volume-slider');
    const offs = [];
    const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); offs.push(() => el.removeEventListener(ev, fn, opts)); };
    let idleTimer = null;
    let dragging = false;
    let lastSubs = null;
    // The subtitle manager (js/player/subtitles.js), set once the file is known
    let subs = { list: () => [], current: () => null, select: () => {} };

    const duration = () => (Number.isFinite(video.duration) && video.duration) || runtime() || 0;
    $('.pl-seek-mark').style.left = `${watchedAt * 100}%`;

    try {
        const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) || 'null');
        if (saved) { video.volume = saved.volume ?? 1; video.muted = !!saved.muted; }
    } catch { /* defaults */ }

    // ----- Paint -----
    const paintTime = (t = video.currentTime) => {
        const d = duration();
        const pct = d ? Math.min(100, Math.max(0, (t / d) * 100)) : 0;
        root.style.setProperty('--pl-pos', `${pct}%`);
        $('.pl-now').textContent = fmtTime(t);
        $('.pl-total').textContent = `/ ${fmtTime(d)}`;
        seek.setAttribute('aria-valuemax', String(Math.round(d)));
        seek.setAttribute('aria-valuenow', String(Math.round(t)));
        seek.setAttribute('aria-valuetext', `${fmtTime(t)} of ${fmtTime(d)}`);
        const b = video.buffered;
        let end = 0;
        for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 1) end = Math.max(end, b.end(i));
        root.style.setProperty('--pl-buf', `${d ? Math.min(100, (end / d) * 100) : 0}%`);
    };
    const paintPlay = () => {
        const paused = video.paused;
        root.classList.toggle('is-paused', paused);
        playBtn.innerHTML = icon(paused ? 'play' : 'pause');
        playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
        playBtn.title = paused ? 'Play (Space)' : 'Pause (Space)';
        wake();
    };
    const paintVolume = () => {
        const silent = video.muted || video.volume === 0;
        muteBtn.innerHTML = icon(silent ? 'muted' : 'volume');
        muteBtn.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
        volume.value = String(video.muted ? 0 : video.volume);
        root.style.setProperty('--pl-vol', `${(video.muted ? 0 : video.volume) * 100}%`);
        try { localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: video.volume, muted: video.muted })); } catch { /* not kept */ }
    };
    const paintFullscreen = () => {
        const full = !!document.fullscreenElement;
        const btn = $('[data-act="fullscreen"]');
        btn.innerHTML = icon(full ? 'exitFullscreen' : 'fullscreen');
        btn.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
    };
    const paintWaiting = (waiting) => root.classList.toggle('is-waiting', waiting);

    // ----- Showing and hiding the controls -----
    function wake() {
        root.classList.remove('is-idle');
        clearTimeout(idleTimer);
        if (!video.paused && menu.hidden && !dragging) idleTimer = setTimeout(() => root.classList.add('is-idle'), IDLE_MS);
    }

    // ----- Actions -----
    const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    const jump = (s) => { video.currentTime = Math.max(0, Math.min(duration() || Infinity, video.currentTime + s)); paintTime(); wake(); };
    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        // The whole document, not the player: the next episode is a new page and keeps full screen
        else document.documentElement.requestFullscreen?.().catch(() => {});
    };
    const togglePip = () => {
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        else video.requestPictureInPicture?.().catch(() => {});
    };

    const setSubs = (id) => {
        subs.select(id);
        if (id != null) lastSubs = id;
        subsBtn.classList.toggle('is-on', id != null);
    };
    const toggleSubs = () => {
        setSubs(subs.current() != null ? null : (lastSubs ?? subs.list()[0]?.id ?? null));
    };
    const openMenu = () => {
        const list = subs.list();
        const current = subs.current();
        const item = (label, id, selected) => `<button class="pl-menu-item" role="menuitemradio" aria-checked="${selected}" data-track="${id}">
            <span class="pl-menu-check">${selected ? icon('check') : ''}</span>${label}</button>`;
        menu.innerHTML = `<div class="pl-menu-title">Subtitles</div>`
            + item('Off', 'off', current == null)
            + list.map(t => item(escapeHtml(t.label), t.id, t.id === current)).join('');
        menu.hidden = false;
        subsBtn.setAttribute('aria-expanded', 'true');
        wake();
        (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.pl-menu-item'))?.focus();
    };
    const closeMenu = () => {
        menu.hidden = true;
        subsBtn.setAttribute('aria-expanded', 'false');
        wake();
    };

    on(root, 'click', (ev) => {
        const btn = ev.target.closest('[data-act]');
        if (btn) {
            ev.stopPropagation();
            const act = btn.dataset.act;
            if (act === 'play') togglePlay();
            else if (act === 'back10') jump(-STEP);
            else if (act === 'fwd10') jump(STEP);
            else if (act === 'mute') { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; }
            else if (act === 'subs') (menu.hidden ? openMenu() : closeMenu());
            else if (act === 'pip') togglePip();
            else if (act === 'fullscreen') toggleFullscreen();
            else if (act === 'skipSegment') skipSegment();
            else if (act === 'playNext') playNext();
            else if (act === 'cancelNext') cancelNext();
            return;
        }
        const item = ev.target.closest('.pl-menu-item');
        if (item) {
            setSubs(item.dataset.track === 'off' ? null : Number(item.dataset.track));
            closeMenu();
            return;
        }
        if (!menu.hidden && !ev.target.closest('.pl-menu')) return closeMenu();
        // A click on the picture: play/pause with a mouse, show the controls with a finger
        if (ev.target === video || ev.target.classList.contains('pl-scrim') || ev.target.classList.contains('pl-center')) {
            if (matchMedia('(hover: none)').matches && root.classList.contains('is-idle')) wake();
            else togglePlay();
        }
    });
    on(video, 'dblclick', toggleFullscreen);

    // ----- Skip intro / recap / credits (Jellyfin media segments, e.g. from the Intro Skipper plugin) -----
    let segments = [];
    let skipTarget = null;
    const skipBtn = $('.pl-skip-segment');
    const SKIP_LABEL = { Intro: 'Skip intro', Recap: 'Skip recap', Outro: 'Skip credits', Preview: 'Skip preview', Commercial: 'Skip ad' };
    function paintSegment() {
        const t = video.currentTime;
        // Shown from the segment's start until a second before it ends
        const seg = segments.find(g => t >= g.start && t < g.end - 1 && !(g.type === 'Outro' && nextState === 'shown'));
        skipTarget = seg ? seg.end : null;
        skipBtn.hidden = !seg;
        if (seg && skipBtn.dataset.type !== seg.type) {
            skipBtn.dataset.type = seg.type;
            skipBtn.textContent = SKIP_LABEL[seg.type] || 'Skip';
        }
        root.classList.toggle('has-skip', !!seg);
    }
    function skipSegment() {
        if (skipTarget == null) return;
        video.currentTime = Math.min(skipTarget, (duration() || skipTarget) - 0.5);
        paintSegment();
    }

    // ----- Up next: from the credits (or the last 30 s) a card counts down to the next episode -----
    let next = null;
    let nextState = 'off'; // 'off' | 'shown' | 'cancelled'
    let nextLeft = COUNTDOWN;
    let nextTimer = 0;
    const nextBox = $('.pl-next');
    // Credits that end near the end of the file; a preview after them may follow
    const nextFrom = () => {
        const d = duration();
        if (!d) return Infinity;
        const outro = segments.find(g => g.type === 'Outro' && g.end >= d - 120);
        return outro ? outro.start : d - Math.min(30, d * 0.1);
    };
    function paintNextCount() {
        const left = Math.max(0, Math.ceil(nextLeft));
        $('.pl-next-label').textContent = `Play now · ${left}`;
        nextBox.style.setProperty('--pl-next-done', `${(1 - Math.max(0, nextLeft) / COUNTDOWN) * 100}%`);
    }
    function paintNext() {
        if (!next) return;
        const before = video.currentTime < nextFrom() - 1;
        // Going back before the credits starts over, a cancel included
        if (before) nextState = 'off';
        else if (nextState === 'off') { nextState = 'shown'; nextLeft = COUNTDOWN; paintNextCount(); }
        const show = nextState === 'shown';
        if (nextBox.hidden === show) {
            nextBox.hidden = !show;
            root.classList.toggle('has-next', show);
            clearInterval(nextTimer);
            // Counts only while the video plays: pausing on the credits holds it
            if (show) nextTimer = setInterval(() => {
                if (video.paused) return;
                nextLeft -= 0.25;
                paintNextCount();
                if (nextLeft <= 0) playNext();
            }, 250);
        }
    }
    function playNext() {
        if (!next || nextState === 'gone') return;
        nextState = 'gone';
        clearInterval(nextTimer);
        next.go();
    }
    function cancelNext() {
        nextState = 'cancelled';
        paintNext();
        paintSegment();
    }
    on(video, 'ended', () => { if (next && nextState !== 'cancelled') playNext(); });

    // ----- Seeking on the wave -----
    const timeAt = (clientX) => {
        const r = seek.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration();
    };
    on(seek, 'pointerdown', (ev) => {
        if (!duration()) return;
        dragging = true;
        seek.setPointerCapture(ev.pointerId);
        root.classList.add('is-seeking');
        paintTime(timeAt(ev.clientX));
        wake();
    });
    on(seek, 'pointermove', (ev) => {
        const t = timeAt(ev.clientX);
        const r = seek.getBoundingClientRect();
        const hover = $('.pl-seek-hover');
        hover.textContent = fmtTime(t);
        hover.style.left = `${Math.max(24, Math.min(r.width - 24, ev.clientX - r.left))}px`;
        if (dragging) paintTime(t);
    });
    const endDrag = (ev) => {
        if (!dragging) return;
        dragging = false;
        root.classList.remove('is-seeking');
        video.currentTime = timeAt(ev.clientX);
        wake();
    };
    on(seek, 'pointerup', endDrag);
    on(seek, 'pointercancel', () => { dragging = false; root.classList.remove('is-seeking'); paintTime(); });
    on(seek, 'keydown', (ev) => {
        const keys = { ArrowLeft: -5, ArrowRight: 5, PageDown: -60, PageUp: 60 };
        if (ev.key in keys) { ev.preventDefault(); ev.stopPropagation(); jump(keys[ev.key]); }
        else if (ev.key === 'Home') { ev.preventDefault(); video.currentTime = 0; }
        else if (ev.key === 'End') { ev.preventDefault(); video.currentTime = Math.max(0, duration() - 1); }
    });

    on(volume, 'input', () => {
        video.volume = Number(volume.value);
        video.muted = video.volume === 0;
    });

    // ----- Keyboard, like the usual players -----
    on(document, 'keydown', (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (ev.target.closest?.('input, textarea, select, [contenteditable]') && ev.target !== volume) return;
        if (!menu.hidden) {
            if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); subsBtn.focus(); }
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                const items = [...menu.querySelectorAll('.pl-menu-item')];
                const i = items.indexOf(document.activeElement);
                items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }
            return;
        }
        const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
        const onButton = ev.target.closest?.('button');
        const handled = {
            ' ': () => { if (!onButton) togglePlay(); else return false; },
            k: togglePlay,
            ArrowLeft: () => jump(-STEP),
            ArrowRight: () => jump(STEP),
            j: () => jump(-STEP),
            l: () => jump(STEP),
            ArrowUp: () => { video.muted = false; video.volume = Math.min(1, video.volume + 0.1); },
            ArrowDown: () => { video.volume = Math.max(0, video.volume - 0.1); },
            f: toggleFullscreen,
            m: () => { video.muted = !video.muted; },
            c: toggleSubs,
            s: skipSegment,
        }[key];
        if (handled && handled() !== false) {
            ev.preventDefault();
            wake();
        }
    });

    on(root, 'pointermove', wake);
    on(root, 'focusin', wake);
    on(video, 'timeupdate', () => { if (!dragging) paintTime(); paintNext(); if (segments.length) paintSegment(); });
    on(video, 'progress', () => paintTime());
    on(video, 'durationchange', () => paintTime());
    on(video, 'play', paintPlay);
    on(video, 'pause', paintPlay);
    on(video, 'volumechange', paintVolume);
    on(video, 'waiting', () => paintWaiting(true));
    on(video, 'playing', () => paintWaiting(false));
    on(video, 'canplay', () => paintWaiting(false));
    on(document, 'fullscreenchange', paintFullscreen);

    if (!document.pictureInPictureEnabled || video.disablePictureInPicture) $('[data-act="pip"]').hidden = true;
    if (!document.documentElement.requestFullscreen) $('[data-act="fullscreen"]').hidden = true;

    paintTime();
    paintPlay();
    paintVolume();
    paintFullscreen();

    return {
        setSubtitles(manager) {
            subs = manager;
            $('.pl-menu-wrap').hidden = !manager.list().length;
            const current = manager.current();
            if (current != null) lastSubs = current;
            subsBtn.classList.toggle('is-on', current != null);
        },
        // While Jellyfin extracts the file's subtitles (the first time only: 4–40 s, it reads the whole file)
        setSubtitlesLoading(on) {
            $('.pl-subs-note').hidden = !on;
        },
        // The next episode, once it is known to be there: { title, go() }
        setNext(info) {
            next = info;
            $('.pl-next-title').textContent = info.title;
            paintNext();
        },
        // [{ type: 'Intro' | 'Recap' | 'Outro' | ..., start, end }] in seconds
        setSegments(list) {
            segments = (list || []).filter(g => g.end - g.start >= 3);
            paintSegment();
        },
                destroy() {
            clearTimeout(idleTimer);
            offs.forEach(off => off());
            clearInterval(nextTimer);
            // Leaving for another episode keeps full screen; leaving the player ends it
            if (document.fullscreenElement && !location.hash.startsWith('#/play/')) document.exitFullscreen().catch(() => {});
        },
    };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
