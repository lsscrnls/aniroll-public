// The player's own controls, Material 3 Expressive in both designs (a video is always dark, so the
// player uses the fixed colour roles of the scheme, which read the same in light and dark mode).
// The seek bar is the same wave as every progress bar in AniRoll: wave up to where you are, a handle,
// flat track after it. The dot on the track marks 90%, where AniList counts the episode.
//   mountControls(root, video, { watchedAt, runtime, autoSkip }) -> { set...(), act(name), destroy() }
// Icons: Material Symbols Rounded 400 (Apache-2.0), inline so both designs show them.
import { esc } from '../store.js?v=145';


const ICON = {
    party: 'M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM360-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm400-160q0 66-47 113t-113 47q-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113Z',
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
    settings: 'M433-80q-27 0-46.5-18T363-142l-9-66q-13-5-24.5-12T307-235l-62 26q-25 11-50 2t-39-32l-47-82q-14-23-8-49t27-43l53-40q-1-7-1-13.5v-27q0-6.5 1-13.5l-53-40q-21-17-27-43t8-49l47-82q14-23 39-32t50 2l62 26q11-8 23-15t24-12l9-66q4-26 23.5-44t46.5-18h94q27 0 46.5 18t23.5 44l9 66q13 5 24.5 12t22.5 15l62-26q25-11 50-2t39 32l47 82q14 23 8 49t-27 43l-53 40q1 7 1 13.5v27q0 6.5-2 13.5l53 40q21 17 27 43t-8 49l-48 82q-14 23-39 32t-50-2l-60-26q-11 8-23 15t-24 12l-9 66q-4 26-23.5 44T527-80h-94Zm49-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z',
    close: 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z',
    check: 'm378-332 363-363q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L399-267q-9 9-21 9t-21-9L175-449q-9-9-8.5-21.5T176-492q9-9 21.5-9t21.5 9l159 160Z',
};

export const icon = (name) => `<svg class="pl-icon" viewBox="0 -960 960 960" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;

const IDLE_MS = 3000;
const SKIP_SHOW_S = 8; // Skip intro/credits shows this long, then goes (seeking back before that brings it again)
const STEP = 10;
const VOLUME_KEY = 'aniroll_player_volume';
// Up next: seconds of playing time before the next episode starts by itself
const COUNTDOWN = 10;
// After this many episodes in a row that started by themselves, Up next asks instead of counting down
const AUTOPLAY_RUN = 3;
const AUTOPLAY_KEY = 'aniroll_autoplay_run';
const STOP_AFTER_KEY = 'aniroll_stop_after';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SUB_SIZE_KEY = 'aniroll_sub_size';
const SUB_SIZES = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' };
const SEGMENT_NAMES = { Intro: 'Intro', Recap: 'Recap', Outro: 'Credits', Preview: 'Preview', Commercial: 'Ad' };
const sessionNumber = (key) => { try { return Number(sessionStorage.getItem(key)) || 0; } catch { return 0; } };
const setSession = (key, value) => { try { value ? sessionStorage.setItem(key, String(value)) : sessionStorage.removeItem(key); } catch { /* not kept */ } };

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
        <div class="pl-stats" role="region" aria-label="Stats for nerds" hidden>
            <div class="pl-stats-head"><span>Stats for nerds</span><button class="pl-btn pl-stats-close" data-act="stats" aria-label="Close the stats" title="Close (I)">${icon('close')}</button></div>
            <div class="pl-stats-body"></div>
        </div>
        <div class="pl-osd" role="status" aria-live="polite" hidden></div>
        <div class="pl-center">
            <button class="pl-btn pl-btn-tonal pl-skip" data-act="back10" aria-label="Back 10 seconds" title="Back 10 s (←)">${icon('back10')}</button>
            <button class="pl-btn pl-play" data-act="play" aria-label="Play" title="Play (Space)">${icon('play')}</button>
            <button class="pl-btn pl-btn-tonal pl-skip" data-act="fwd10" aria-label="Forward 10 seconds" title="Forward 10 s (→)">${icon('fwd10')}</button>
        </div>
        <div class="pl-bottom">
            <div class="pl-seek" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00">
                <div class="pl-seek-track"></div>
                <div class="pl-seek-segments" aria-hidden="true"></div>
                <div class="pl-seek-buffer"></div>
                <div class="pl-seek-wave"></div>
                <div class="pl-seek-chapters" aria-hidden="true"></div>
                <div class="pl-seek-mark" title="From here the episode counts as watched"></div>
                <div class="pl-seek-handle"></div>
                <div class="pl-seek-hover" aria-hidden="true">
                    <div class="pl-seek-thumb" hidden></div>
                    <div class="pl-seek-hover-row"><span class="pl-seek-hover-seg" hidden></span><span class="pl-seek-hover-time">0:00</span></div>
                </div>
            </div>
            <button class="pl-skip-segment" data-act="skipSegment" hidden></button>
            <div class="pl-next" role="group" aria-label="Up next" hidden>
                <div class="pl-next-thumb" hidden><img alt="" loading="lazy" decoding="async"></div>
                <div class="pl-next-text"><span class="pl-next-kicker">Up next</span><span class="pl-next-title"></span><span class="pl-next-meta" hidden></span></div>
                <button class="pl-next-play" data-act="playNext">${icon('skipNext')}<span class="pl-next-label">Play now</span></button>
                <button class="pl-next-stay" data-act="cancelNext">Watch credits</button>
            </div>
            <div class="pl-end" role="group" aria-label="Episode over" hidden>
                <div class="pl-next-text"><span class="pl-next-kicker"></span><span class="pl-end-title"></span></div>
                <div class="pl-end-actions"></div>
            </div>
            <div class="pl-subs-note" role="status" hidden><span class="pl-subs-note-dot" aria-hidden="true"></span>Loading subtitles…</div>
            <div class="pl-row">
                <button class="pl-btn" data-act="nextEp" aria-label="Next episode" title="Next episode (N)" hidden>${icon('skipNext')}</button>
                <span class="pl-time"><span class="pl-now">0:00</span> <span class="pl-total">/ 0:00</span></span>
                <span class="pl-spacer"></span>
                <div class="pl-volume">
                    <button class="pl-btn" data-act="mute" aria-label="Mute" title="Mute (M)">${icon('volume')}</button>
                    <input class="pl-volume-slider" type="range" min="0" max="1" step="0.05" aria-label="Volume">
                </div>
                <div class="pl-menu-wrap">
                    <button class="pl-btn" data-act="subs" aria-label="Audio and subtitles" aria-haspopup="menu" aria-expanded="false" title="Audio & subtitles (C: subtitles on/off)">${icon('subtitles')}</button>
                    <button class="pl-btn" data-act="settings" aria-label="Quality and stats" aria-haspopup="menu" aria-expanded="false" title="Quality & stats for nerds (I)">${icon('settings')}</button>
                    <div class="pl-menu" role="menu" hidden></div>
                </div>
                <button class="pl-btn" data-act="pip" aria-label="Picture in picture" title="Picture in picture">${icon('pip')}</button>
                <button class="pl-btn" data-act="fullscreen" aria-label="Full screen" title="Full screen (F)">${icon('fullscreen')}</button>
            </div>
        </div>`;
}

// root: the .player element (holds controlsHtml()), video: its <video>
// autoSkip: { get() -> bool, set(bool) } — skip intros and recaps by themselves, kept per show by the page
export function mountControls(root, video, { watchedAt = 0.9, runtime = () => 0, autoSkip = null } = {}) {
    const $ = (sel) => root.querySelector(sel);
    const seek = $('.pl-seek');
    const playBtn = $('.pl-play');
    const menu = $('.pl-menu');
    const subsBtn = $('[data-act="subs"]');
    const settingsBtn = $('[data-act="settings"]');
    let menuKind = null; // 'subs' | 'settings' while the menu is open
    const muteBtn = $('[data-act="mute"]');
    const volume = $('.pl-volume-slider');
    const offs = [];
    const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); offs.push(() => el.removeEventListener(ev, fn, opts)); };
    let idleTimer = null;
    let dragging = false;
    let lastSubs = null;
    // The subtitle manager (js/player/subtitles.js), set once the file is known
    let subs = { list: () => [], current: () => null, select: () => {} };
    // The audio tracks (js/pages/play.js switches them with the server), set once the file is known
    let audio = { list: () => [], current: () => null, select: () => {} };
    // The quality steps (js/pages/play.js asks the server again) and the stats rows
    let quality = { list: () => [], current: () => null, select: () => {} };
    let stats = () => [];
    let statsTimer = 0;
    // Worth a button: some subtitles, or more than one audio track
    const paintMenuButton = () => { subsBtn.hidden = !subs.list().length && audio.list().length < 2; };

    const duration = () => (Number.isFinite(video.duration) && video.duration) || runtime() || 0;
    $('.pl-seek-mark').style.left = `${watchedAt * 100}%`;
    let subSize = 'm';
    try { subSize = SUB_SIZES[localStorage.getItem(SUB_SIZE_KEY)] ? localStorage.getItem(SUB_SIZE_KEY) : 'm'; } catch { /* default */ }
    root.dataset.subSize = subSize;

    // ----- A short word in the middle when a key changed something the controls may not show -----
    const osdBox = $('.pl-osd');
    let osdTimer = 0;
    function osd(text, action = null) {
        clearTimeout(osdTimer);
        osdBox.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="pl-osd-act">${esc(action.label)}</button>` : ''}`;
        osdBox.hidden = false;
        osdBox.classList.remove('is-in');
        void osdBox.offsetWidth;
        osdBox.classList.add('is-in');
        if (action) osdBox.querySelector('.pl-osd-act').onclick = (ev) => { ev.stopPropagation(); action.run(); hideOsd(); };
        osdTimer = setTimeout(hideOsd, action ? 5000 : 1200);
    }
    function hideOsd() {
        osdBox.classList.remove('is-in');
        osdTimer = setTimeout(() => { osdBox.hidden = true; }, 200);
    }

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
    const setSpeed = (rate) => {
        video.playbackRate = rate;
        osd(rate === 1 ? 'Normal speed' : `Speed ${rate}×`);
    };
    const stepSpeed = (dir) => {
        const i = SPEEDS.indexOf(video.playbackRate);
        const at = i === -1 ? SPEEDS.indexOf(1) : i;
        setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + dir))]);
    };
    const shiftSubs = (by) => {
        if (!subs.setDelay || subs.current() == null) return osd('No subtitles on');
        const d = subs.setDelay(by === 0 ? 0 : (subs.delay() || 0) + by);
        osd(d === 0 ? 'Subtitle timing reset' : `Subtitles ${d > 0 ? 'later' : 'earlier'} by ${Math.abs(d).toFixed(1)} s`);
    };
    let stopAfter = sessionNumber(STOP_AFTER_KEY) === 1;
    const toggleStopAfter = () => {
        stopAfter = !stopAfter;
        setSession(STOP_AFTER_KEY, stopAfter ? 1 : 0);
        osd(stopAfter ? 'Stops after this episode' : 'Keeps playing the next episode');
        paintNext();
    };
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
    const menuItem = (label, attr, id, selected, role = 'menuitemradio') => `<button class="pl-menu-item" role="${role}" aria-checked="${selected}" ${attr}="${id}">
            <span class="pl-menu-check">${selected ? icon('check') : ''}</span>${label}</button>`;
    const openSettings = () => {
        const nowQ = quality.current();
        menu.innerHTML = `<div class="pl-menu-title">Quality</div>`
            + quality.list().map(q => menuItem(esc(q.label), 'data-quality', q.id, q.id === nowQ)).join('')
            + '<div class="pl-menu-divider" role="separator"></div>'
            + `<div class="pl-menu-title">Speed</div><div class="pl-menu-chips" role="group" aria-label="Speed">`
            + SPEEDS.map(r => `<button class="pl-menu-chip${r === video.playbackRate ? ' is-on' : ''}" data-speed="${r}" aria-pressed="${r === video.playbackRate}">${r === 1 ? 'Normal' : `${r}×`}</button>`).join('')
            + '</div><div class="pl-menu-divider" role="separator"></div>'
            + (autoSkip ? menuItem('Skip intros automatically', 'data-autoskip', '1', !!autoSkip.get(), 'menuitemcheckbox') : '')
            + menuItem('Stop after this episode', 'data-stopafter', '1', stopAfter, 'menuitemcheckbox')
            + menuItem('Stats for nerds', 'data-stats', '1', !statsBox.hidden, 'menuitemcheckbox');
        menuKind = 'settings';
        menu.hidden = false;
        settingsBtn.setAttribute('aria-expanded', 'true');
        wake();
        (menu.querySelector('[data-quality][aria-checked="true"]') || menu.querySelector('.pl-menu-item'))?.focus();
    };
    const openMenu = () => {
        const list = subs.list();
        const current = subs.current();
        const item = (label, attr, id, selected) => `<button class="pl-menu-item" role="menuitemradio" aria-checked="${selected}" ${attr}="${id}">
            <span class="pl-menu-check">${selected ? icon('check') : ''}</span>${label}</button>`;
        const tracks = audio.list();
        const nowAudio = audio.current();
        menu.innerHTML = (tracks.length > 1
            ? `<div class="pl-menu-title">Audio</div>`
                + tracks.map(t => item(esc(t.label), 'data-audio', t.id, t.id === nowAudio)).join('')
                + (list.length ? '<div class="pl-menu-divider" role="separator"></div>' : '')
            : '')
            + (list.length
                ? `<div class="pl-menu-title">Subtitles</div>`
                    + item('Off', 'data-track', 'off', current == null)
                    + list.map(t => item(esc(t.label), 'data-track', t.id, t.id === current)).join('')
                    + (subs.setDelay ? '<div class="pl-menu-divider" role="separator"></div>'
                        + `<div class="pl-menu-title">Timing${subs.delay?.() ? ` · ${subs.delay() > 0 ? '+' : ''}${subs.delay().toFixed(1)} s` : ''}</div><div class="pl-menu-chips" role="group" aria-label="Subtitle timing">`
                        + `<button class="pl-menu-chip" data-subdelay="-0.5" title="Earlier (Z: 0.1 s)">−0.5 s</button>`
                        + `<button class="pl-menu-chip" data-subdelay="0">Reset</button>`
                        + `<button class="pl-menu-chip" data-subdelay="0.5" title="Later (X: 0.1 s)">+0.5 s</button></div>` : '')
                    + `<div class="pl-menu-title">Size</div><div class="pl-menu-chips" role="group" aria-label="Subtitle size">`
                    + Object.entries(SUB_SIZES).map(([k, label]) => `<button class="pl-menu-chip${k === subSize ? ' is-on' : ''}" data-subsize="${k}" aria-pressed="${k === subSize}" title="${label}">${k.toUpperCase()}</button>`).join('')
                    + '</div>'
                : '');
        menuKind = 'subs';
        menu.hidden = false;
        subsBtn.setAttribute('aria-expanded', 'true');
        wake();
        (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.pl-menu-item'))?.focus();
    };
    const closeMenu = () => {
        menu.hidden = true;
        menuKind = null;
        subsBtn.setAttribute('aria-expanded', 'false');
        settingsBtn.setAttribute('aria-expanded', 'false');
        wake();
    };

    // ----- Stats for nerds: a panel at the top left, redrawn every second while it shows -----
    const statsBox = $('.pl-stats');
    const paintStats = () => {
        let sections = [];
        try { sections = stats() || []; } catch { /* a moment without numbers */ }
        $('.pl-stats-body').innerHTML = sections.map(sec => `<div class="pl-stats-sec"><div class="pl-stats-title">${esc(sec.title)}</div>`
            + sec.rows.map(([k, v]) => `<div class="pl-stats-row"><span>${esc(k)}</span><span>${esc(String(v))}</span></div>`).join('') + '</div>').join('');
    };
    const toggleStats = (show = statsBox.hidden) => {
        statsBox.hidden = !show;
        root.classList.toggle('has-stats', show);
        clearInterval(statsTimer);
        if (show) { paintStats(); statsTimer = setInterval(paintStats, 1000); }
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
            else if (act === 'subs') (menuKind === 'subs' ? closeMenu() : openMenu());
            else if (act === 'settings') (menuKind === 'settings' ? closeMenu() : openSettings());
            else if (act === 'stats') toggleStats();
            else if (act === 'pip') togglePip();
            else if (act === 'fullscreen') toggleFullscreen();
            else if (act === 'skipSegment') skipSegment();
            else if (act === 'playNext' || act === 'nextEp') playNext();
            else if (act === 'cancelNext') cancelNext();
            return;
        }
        const chip = ev.target.closest('.pl-menu-chip');
        if (chip) {
            if (chip.dataset.speed) setSpeed(Number(chip.dataset.speed));
            else if (chip.dataset.subdelay != null) shiftSubs(Number(chip.dataset.subdelay));
            else if (chip.dataset.subsize) {
                subSize = chip.dataset.subsize;
                root.dataset.subSize = subSize;
                try { localStorage.setItem(SUB_SIZE_KEY, subSize); } catch { /* not kept */ }
            }
            // The menu stays open for another step; redraw it with the new choice
            const reopen = menuKind === 'settings' ? openSettings : openMenu;
            reopen();
            menu.querySelector(`.pl-menu-chip[data-${Object.keys(chip.dataset)[0]}="${Object.values(chip.dataset)[0]}"]`)?.focus();
            return;
        }
        const item = ev.target.closest('.pl-menu-item');
        if (item) {
            if (item.dataset.audio != null) {
                const id = Number(item.dataset.audio);
                if (id !== audio.current()) audio.select(id);
            } else if (item.dataset.quality != null) {
                const q = /^\d+(\.\d+)?$/.test(item.dataset.quality) ? Number(item.dataset.quality) : item.dataset.quality;
                if (q !== quality.current()) quality.select(q);
            } else if (item.dataset.stats != null) {
                toggleStats();
            } else if (item.dataset.autoskip != null) {
                autoSkip.set(!autoSkip.get());
                osd(autoSkip.get() ? 'Intros are skipped for this show' : 'Intros play again');
            } else if (item.dataset.stopafter != null) {
                toggleStopAfter();
            } else {
                setSubs(item.dataset.track === 'off' ? null : Number(item.dataset.track));
            }
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
    let skipSeg = null;
    let skipFrom = 0; // where in the video the button came up for this segment
    const skipBtn = $('.pl-skip-segment');
    const SKIP_LABEL = { Intro: 'Skip intro', Recap: 'Skip recap', Outro: 'Skip credits', Preview: 'Skip preview', Commercial: 'Skip ad' };
    // Intro and recap skip themselves when the show asks for it — only when playback ran into them, not after
    // a jump into the middle (someone who seeks back into the opening wants to see it), and once per segment
    const autoSkipped = new Set();
    let segLastT = 0;
    function autoSkipCheck(seg, t) {
        const ranInto = segLastT < seg.start + 0.5 && t - segLastT < 2;
        if (!autoSkip?.get() || !ranInto || autoSkipped.has(seg) || !['Intro', 'Recap'].includes(seg.type)) return false;
        autoSkipped.add(seg);
        const back = seg.start;
        video.currentTime = Math.min(seg.end, (duration() || seg.end) - 0.5);
        osd(`Skipped ${SEGMENT_NAMES[seg.type].toLowerCase()}`, { label: 'Undo', run: () => { video.currentTime = back; } });
        return true;
    }
    // ----- Chapters (from the file, e.g. an MKV's chapter list) -----
    let chapters = [];
    const chapterAt = (t) => chapters.findLast(c => c.start <= t) || null;
    function paintChapterBar() {
        const d = duration();
        // The first chapter starts the episode: no mark at 0
        $('.pl-seek-chapters').innerHTML = d ? chapters.filter(c => c.start > 1 && c.start < d - 1)
            .map(c => `<span class="pl-seek-chapter" style="left:${(c.start / d) * 100}%"></span>`).join('') : '';
    }
    function paintSegmentBar() {
        const d = duration();
        $('.pl-seek-segments').innerHTML = d ? segments.map(g => `<span class="pl-seek-seg" data-type="${esc(g.type)}"
            style="left:${(g.start / d) * 100}%;width:${((g.end - g.start) / d) * 100}%"></span>`).join('') : '';
    }
    function paintSegment() {
        const t = video.currentTime;
        const inSeg = segments.find(g => t >= g.start && t < g.end - 1);
        if (inSeg && autoSkipCheck(inSeg, t)) { segLastT = video.currentTime; return; }
        segLastT = t;
        // Shown from the segment's start until a second before it ends. Not for the credits while Up next
        // shows, nor once "Watch credits" said they are wanted
        const seg = segments.find(g => t >= g.start && t < g.end - 1 && !(g.type === 'Outro' && nextState !== 'off'));
        // After a few seconds it goes, so the intro or the credits play on their own, controls or not.
        // Seeking back before where it came up shows it again.
        if (seg !== skipSeg || t < skipFrom) { skipSeg = seg; skipFrom = t; }
        const gone = !!seg && t - skipFrom >= SKIP_SHOW_S;
        skipTarget = seg && !gone ? seg.end : null;
        skipBtn.hidden = !seg || gone;
        root.classList.toggle('skip-faded', gone);
        if (seg && skipBtn.dataset.type !== seg.type) {
            skipBtn.dataset.type = seg.type;
            skipBtn.textContent = SKIP_LABEL[seg.type] || 'Skip';
        }
        root.classList.toggle('has-skip', !!seg && !gone);
    }
    function skipSegment() {
        if (skipTarget == null) return;
        video.currentTime = Math.min(skipTarget, (duration() || skipTarget) - 0.5);
        paintSegment();
    }

    // ----- Up next: from the credits (or the last 30 s) a card counts down to the next episode -----
    let next = null;
    let prev = null;
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
    // Up next waits for a tap instead of counting down: asked to stop after this episode, or several
    // episodes in a row started by themselves (someone may have fallen asleep)
    const holdNext = () => stopAfter || sessionNumber(AUTOPLAY_KEY) >= AUTOPLAY_RUN;
    function paintNext() {
        if (!next) return;
        const before = video.currentTime < nextFrom() - 1;
        // Going back before the credits starts over, a cancel included
        if (before) nextState = 'off';
        else if (nextState === 'off') { nextState = 'shown'; nextLeft = COUNTDOWN; paintNextCount(); }
        const show = nextState === 'shown';
        const hold = holdNext();
        nextBox.classList.toggle('is-held', hold);
        $('.pl-next-kicker').textContent = hold ? (stopAfter ? 'Stopping here' : 'Still watching?') : 'Up next';
        if (hold) $('.pl-next-label').textContent = stopAfter ? 'Play it anyway' : 'Keep watching';
        else if (show) paintNextCount();
        if (nextBox.hidden === show) {
            nextBox.hidden = !show;
            root.classList.toggle('has-next', show);
            clearInterval(nextTimer);
            // Counts only while the video plays (or has ended): pausing on the credits holds it
            if (show && !hold) {
                root.dispatchEvent(new CustomEvent('aniroll:player-upnext', { bubbles: true, detail: { box: nextBox } }));
                nextTimer = setInterval(() => {
                if (video.paused && !video.ended) return;
                nextLeft -= 0.25;
                paintNextCount();
                if (nextLeft <= 0) playNext(true);
                }, 250);
            }
        }
    }
    // auto: the countdown ran out, nobody chose it
    function playNext(auto = false) {
        if (!next || nextState === 'gone') return;
        nextState = 'gone';
        clearInterval(nextTimer);
        setSession(AUTOPLAY_KEY, auto ? sessionNumber(AUTOPLAY_KEY) + 1 : 0);
        if (stopAfter) { stopAfter = false; setSession(STOP_AFTER_KEY, 0); }
        next.go();
    }
    function cancelNext() {
        nextState = 'cancelled';
        paintNext();
        paintSegment();
    }
    // How much of the stretch from the credits to the end really played (not skipped or jumped over), for
    // whoever listens for 'aniroll:player-ended' on the player
    let tailPlayed = 0;
    let lastT = 0;
    on(video, 'timeupdate', () => {
        const t = video.currentTime;
        const from = nextFrom();
        const dt = t - lastT;
        if (t < from - 1) tailPlayed = 0;
        else if (dt > 0 && dt < 1.5 && !video.paused) tailPlayed += dt;
        lastT = t;
        if (!endBox.hidden && t < duration() - 1) paintEnd(false);
    });

    // ----- No next episode: a card instead of a black frame (what is next for the show, set by the page) -----
    let endInfo = null;
    const endBox = $('.pl-end');
    function paintEnd(show) {
        show = show && !!endInfo;
        endBox.hidden = !show;
        root.classList.toggle('has-end', show);
        if (!show) return;
        $('.pl-end .pl-next-kicker').textContent = endInfo.kicker;
        $('.pl-end-title').textContent = endInfo.title;
        const actions = $('.pl-end-actions');
        const rate = endInfo.rate;
        actions.innerHTML = (rate ? `<div class="pl-rate">
                <label class="pl-rate-label" for="pl-rate-input">Your score <output class="pl-rate-value">${rate.value || '–'}</output></label>
                <input id="pl-rate-input" class="pl-rate-input" type="range" min="0" max="100" step="5" value="${rate.value || 0}" aria-label="Your score out of 100">
                <button type="button" class="pl-next-play pl-rate-save" data-rate>${rate.value ? 'Update score' : 'Save score'}</button>
            </div>` : '') + (endInfo.actions || []).map((a, i) => a.href
            ? `<a class="${a.primary ? 'pl-next-play' : 'pl-next-stay'}" href="${esc(a.href)}">${esc(a.label)}</a>`
            : `<button type="button" class="${a.primary ? 'pl-next-play' : 'pl-next-stay'}" data-end="${i}">${esc(a.label)}</button>`).join('');
    }
    on(endBox, 'click', (ev) => {
        const btn = ev.target.closest('[data-end]');
        if (btn) endInfo?.actions?.[Number(btn.dataset.end)]?.run?.(btn);
        const save = ev.target.closest('[data-rate]');
        if (save && endInfo?.rate) {
            const value = Number(endBox.querySelector('.pl-rate-input').value);
            endInfo.rate.save(value, save);
        }
    });
    on(endBox, 'input', (ev) => {
        if (ev.target.classList.contains('pl-rate-input')) endBox.querySelector('.pl-rate-value').textContent = ev.target.value;
    });

    // The end: straight on, unless the credits were watched — then the card asks once more, with its countdown
    on(video, 'ended', () => {
        const span = duration() - nextFrom();
        root.dispatchEvent(new CustomEvent('aniroll:player-ended', { bubbles: true,
            detail: { credits: nextState === 'cancelled' || (span >= 10 && tailPlayed >= span * 0.8) } }));
        if (!next) return paintEnd(true);
        if (holdNext()) return;
        if (nextState !== 'cancelled') return playNext(true);
        nextState = 'off';
        paintNext();
    });

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
        paintHover(ev.clientX);
        paintTime(timeAt(ev.clientX));
        wake();
    });
    // The label over the wave: the time and, inside an intro or the credits, which one. It is a column with
    // room for a picture above, so preview thumbnails can go in without moving anything
    const hoverBox = $('.pl-seek-hover');
    const paintHover = (clientX) => {
        const t = timeAt(clientX);
        const r = seek.getBoundingClientRect();
        $('.pl-seek-hover-time').textContent = fmtTime(t);
        const seg = segments.find(g => t >= g.start && t < g.end);
        // An intro or the credits say so; elsewhere the chapter's name, when the file has named chapters
        const label = seg ? (SEGMENT_NAMES[seg.type] || seg.type) : chapterAt(t)?.name || '';
        const segEl = $('.pl-seek-hover-seg');
        segEl.hidden = !label;
        segEl.textContent = label;
        root.dispatchEvent(new CustomEvent('aniroll:player-hover', { detail: { time: t, thumb: $('.pl-seek-thumb') } }));
        const half = Math.max(24, hoverBox.offsetWidth / 2);
        hoverBox.style.left = `${Math.max(half, Math.min(r.width - half, clientX - r.left))}px`;
    };
    on(seek, 'pointermove', (ev) => {
        paintHover(ev.clientX);
        if (dragging) paintTime(timeAt(ev.clientX));
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
            if (ev.key === 'Escape') { ev.preventDefault(); const back = menuKind === 'settings' ? settingsBtn : subsBtn; closeMenu(); back.focus(); }
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
        // Any key counts as someone being there: the next Up next counts down again
        setSession(AUTOPLAY_KEY, 0);
        // 0-9: to 0 % … 90 % of the episode, as on YouTube
        if (/^[0-9]$/.test(ev.key) && duration()) {
            ev.preventDefault();
            video.currentTime = (Number(ev.key) / 10) * duration();
            paintTime();
            wake();
            return;
        }
        const handled = {
            ' ': () => { if (!onButton) togglePlay(); else return false; },
            k: togglePlay,
            ArrowLeft: () => { jump(-STEP); osd(`−${STEP} s`); },
            ArrowRight: () => { jump(STEP); osd(`+${STEP} s`); },
            j: () => { jump(-STEP); osd(`−${STEP} s`); },
            l: () => { jump(STEP); osd(`+${STEP} s`); },
            ArrowUp: () => { video.muted = false; video.volume = Math.min(1, video.volume + 0.1); osd(`Volume ${Math.round(video.volume * 100)} %`); },
            ArrowDown: () => { video.volume = Math.max(0, video.volume - 0.1); osd(`Volume ${Math.round(video.volume * 100)} %`); },
            f: toggleFullscreen,
            m: () => { video.muted = !video.muted; osd(video.muted ? 'Muted' : `Volume ${Math.round(video.volume * 100)} %`); },
            c: () => { toggleSubs(); osd(subs.current() == null ? 'Subtitles off' : 'Subtitles on'); },
            s: skipSegment,
            // Shift+N: the episode before
            n: () => {
                if (ev.shiftKey) { if (prev) prev.go(); else return false; } else if (next) playNext(); else return false;
            },
            i: () => toggleStats(),
            '[': () => stepSpeed(-1),
            ']': () => stepSpeed(1),
            z: () => shiftSubs(-0.1),
            x: () => shiftSubs(0.1),
        }[key];
        if (handled && handled() !== false) {
            ev.preventDefault();
            wake();
        }
    });

    on(root, 'pointermove', wake);
    on(root, 'pointerdown', () => setSession(AUTOPLAY_KEY, 0));
    on(root, 'focusin', wake);
    on(video, 'timeupdate', () => { if (!dragging) paintTime(); paintNext(); if (segments.length) paintSegment(); });
    on(video, 'progress', () => paintTime());
    on(video, 'durationchange', () => { paintTime(); paintSegmentBar(); paintChapterBar(); });
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
            paintMenuButton();
            const current = manager.current();
            if (current != null) lastSubs = current;
            subsBtn.classList.toggle('is-on', current != null);
        },
        // Continue where it stopped or start over: resolves 'continue' | 'restart'. Enter continues
        askResume(seconds) {
            return new Promise(resolve => {
                const box = document.createElement('div');
                box.className = 'pl-resume';
                box.setAttribute('role', 'dialog');
                box.setAttribute('aria-label', 'Continue watching');
                box.innerHTML = `<div class="pl-resume-card">
                    <div class="pl-resume-title">You stopped at ${fmtTime(seconds)}</div>
                    <div class="pl-resume-actions">
                        <button class="pl-resume-btn is-primary" data-resume="continue">${icon('play')}Continue at ${fmtTime(seconds)}</button>
                        <button class="pl-resume-btn" data-resume="restart">${icon('back10')}Start over</button>
                    </div>
                </div>`;
                const done = (choice) => {
                    offKey();
                    box.remove();
                    root.classList.remove('has-resume');
                    wake();
                    resolve(choice);
                };
                box.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-resume]');
                    ev.stopPropagation();
                    if (b) done(b.dataset.resume);
                });
                const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done('continue'); } };
                document.addEventListener('keydown', onKey, true);
                const offKey = () => document.removeEventListener('keydown', onKey, true);
                offs.push(offKey);
                root.appendChild(box);
                root.classList.add('has-resume');
                box.querySelector('[data-resume="continue"]').focus();
            });
        },
        // { list() -> [{ id: 'auto' | 'max' | bps, label }], current(), select(id) }
        setQuality(manager) {
            quality = manager;
        },
        // () -> [{ title, rows: [[label, value]] }]
        setStats(provider) {
            stats = provider;
        },
        // { list() -> [{ id, label }], current() -> id, select(id) }
        setAudio(manager) {
            audio = manager;
            paintMenuButton();
        },
        // While Jellyfin extracts the file's subtitles (the first time only: 4–40 s, it reads the whole file)
        setSubtitlesLoading(on) {
            $('.pl-subs-note').hidden = !on;
        },
        // The next episode, once it is known to be there: { title, go(), image?, meta? }
        setNext(info) {
            next = info;
            $('[data-act="nextEp"]').hidden = false;
            $('.pl-next-title').textContent = info.title;
            const thumb = $('.pl-next-thumb');
            thumb.hidden = !info.image;
            if (info.image) thumb.querySelector('img').src = info.image;
            $('.pl-next-meta').hidden = !info.meta;
            $('.pl-next-meta').textContent = info.meta || '';
            paintNext();
        },
        // The episode before, for Shift+N: { go() }
        setPrev(info) {
            prev = info;
        },
        // For the media keys and the lock screen (Media Session): the same actions as the buttons
        act(name, arg) {
            ({
                play: () => video.play().catch(() => {}),
                pause: () => video.pause(),
                toggle: togglePlay,
                back: () => jump(-(arg || STEP)),
                forward: () => jump(arg || STEP),
                seek: () => { video.currentTime = Math.max(0, Math.min(duration() || Infinity, arg)); paintTime(); },
                next: () => playNext(),
                previous: () => prev?.go(),
                skip: skipSegment,
            })[name]?.();
        },
        // What the end card says when there is no next episode: { kicker, title, actions: [{ label, href | run, primary }] }
        setEnd(info) {
            endInfo = info;
            if (!endBox.hidden || video.ended) paintEnd(true);
        },
        // [{ type: 'Intro' | 'Recap' | 'Outro' | ..., start, end }] in seconds
        setSegments(list) {
            segments = (list || []).filter(g => g.end - g.start >= 3);
            paintSegmentBar();
            paintSegment();
        },
        // [{ name, start }] in seconds, in order; name '' when the file only numbers them
        setChapters(list) {
            chapters = (list || []).slice().sort((a, b) => a.start - b.start);
            paintChapterBar();
        },
        destroy() {
            clearTimeout(idleTimer);
            offs.forEach(off => off());
            clearInterval(nextTimer);
            clearInterval(statsTimer);
            clearTimeout(osdTimer);
            // Leaving for another episode keeps full screen; leaving the player ends it
            if (document.fullscreenElement && !location.hash.startsWith('#/play/')) document.exitFullscreen().catch(() => {});
        },
    };
}

