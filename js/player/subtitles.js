import { jfAuth } from '../jellyfin.js?v=136';

// Every subtitle of a file behind one list, whatever draws it:
//   ASS/SSA  -> JASSUB (libass in WebAssembly) with the fonts embedded in the MKV — typesetting, signs,
//               karaoke as the release intended. Loaded only when such a track is chosen.
//   SRT, mov_text, WebVTT -> a <track> with Jellyfin's WebVTT conversion
//   PGS (Blu-ray pictures) -> libpgs on a canvas; Jellyfin hands the track out as is (Stream.pgssub,
//               Stream.sup answers 400). The first request waits while Jellyfin extracts every track (~25 s).
//   DVD/DVB pictures      -> not offered (one file in the library)
//   manager = { list(), current(), select(id | null), delay(), setDelay(seconds), destroy() }; `pick` chooses the first track
//   delay: seconds the lines come later (negative: earlier), for a release timed off by a bit
const JASSUB_URL = '../vendor/jassub-2.5.16/jassub.js';
const LIBPGS_URL = '../vendor/libpgs-0.9.0/libpgs.js';
const LIBPGS_WORKER = new URL('../vendor/libpgs-0.9.0/libpgs.worker.js', import.meta.url).href;
const ASS = new Set(['ass', 'ssa']);
const PGS = new Set(['pgssub', 'pgs']);
const PICTURE = new Set(['dvdsub', 'dvbsub', 'vobsub']);
const kindOf = (codec) => {
    const c = String(codec).toLowerCase();
    return ASS.has(c) ? 'ass' : PGS.has(c) ? 'pgs' : 'text';
};

export function createSubtitles({ video, base, cfg, itemId, source, pick = () => undefined, onChange = () => {}, onLoading = () => {} }) {
    const streams = (source.MediaStreams || []).filter(s => s.Type === 'Subtitle');
    const url = (s, ext) => `${base}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(source.Id)}/Subtitles/${s.Index}/0/Stream.${ext}?ApiKey=${encodeURIComponent(cfg.apiKey)}`;

    const tracks = streams
        .filter(s => !PICTURE.has(String(s.Codec).toLowerCase()))
        .map(s => ({
            id: s.Index,
            label: s.DisplayTitle || s.Title || s.Language || `Track ${s.Index}`,
            kind: kindOf(s.Codec),
            stream: s,
        }));

    let active = null;
    let jassub = null;
    let fontsPromise = null;
    let pgs = null;
    let pgsFrame = 0;
    let closed = false;
    let pending = 0;
    let offset = 0;

    // WebVTT: every cue moved by the delay, from the times the file gave it
    function shiftCues(t) {
        const cues = t?.el?.track?.cues;
        if (!cues) return;
        for (const cue of cues) {
            if (cue.aniStart === undefined) { cue.aniStart = cue.startTime; cue.aniEnd = cue.endTime; }
            cue.startTime = Math.max(0, cue.aniStart + offset);
            cue.endTime = Math.max(0, cue.aniEnd + offset);
        }
    }

    // One chosen track at a time: loading ends when it is there, fails, or another is chosen
    let loadingFor = null;
    const loading = (t) => { loadingFor = t; onLoading(!!t); };
    const loaded = (t) => { if (loadingFor === t) loading(null); };

    // <track> elements for the text subtitles, all switched off until chosen
    for (const t of tracks.filter(t => t.kind === 'text')) {
        const el = document.createElement('track');
        el.kind = 'subtitles';
        el.label = t.label;
        if (t.stream.Language) el.srclang = t.stream.Language;
        el.src = url(t.stream, 'vtt');
        video.append(el);
        t.el = el;
        el.track.mode = 'disabled';
        el.addEventListener('load', () => { shiftCues(t); loaded(t); });
        el.addEventListener('error', () => loaded(t));
    }

    // The MKV's fonts: without them signs and styled lines fall back to a plain face
    function fonts() {
        fontsPromise ||= Promise.all((source.MediaAttachments || [])
            .filter(a => /font|ttf|otf|woff/i.test(`${a.MimeType} ${a.FileName}`))
            .map(async (a) => {
                try {
                    const res = await fetch(`${base}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(source.Id)}/Attachments/${a.Index}`,
                        { headers: jfAuth(cfg.apiKey), signal: AbortSignal.timeout(20000) });
                    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
                } catch {
                    return null;
                }
            })).then(list => list.filter(Boolean));
        return fontsPromise;
    }

    async function showAss(t) {
        const ticket = ++pending;
        const [{ default: JASSUB }, subContent, fontData] = await Promise.all([
            import(JASSUB_URL),
            fetch(url(t.stream, 'ass'), { signal: AbortSignal.timeout(20000) }).then(r => {
                if (!r.ok) throw new Error(`subtitle ${r.status}`);
                return r.text();
            }),
            fonts(),
        ]);
        if (closed || ticket !== pending || active !== t) return;
        if (jassub) {
            await jassub.ready;
            await jassub.renderer.setTrack(subContent);
            return;
        }
        jassub = new JASSUB({
            video,
            subContent,
            fonts: fontData,
            timeOffset: -offset,
            // No "allow fonts" prompt: embedded fonts and the default face are enough
            queryFonts: false,
        });
        jassub._canvas.classList.add('pl-subs-canvas');
    }

    function hideAss() {
        if (jassub?._canvas) jassub._canvas.hidden = true;
    }

    // libpgs only redraws on timeupdate (4 times a second); every video frame keeps a sign's
    // appearance and removal on the frame the release timed it to
    function followFrames() {
        if (!video.requestVideoFrameCallback || pgsFrame) return;
        const tick = (_, meta) => {
            pgsFrame = 0;
            if (closed || active?.kind !== 'pgs' || !pgs) return;
            pgs.renderAtTimestamp(meta.mediaTime - offset);
            pgsFrame = video.requestVideoFrameCallback(tick);
        };
        pgsFrame = video.requestVideoFrameCallback(tick);
    }

    async function showPgs(t) {
        const ticket = ++pending;
        const { PgsRenderer } = await import(LIBPGS_URL);
        if (closed || ticket !== pending || active !== t) return;
        const subUrl = url(t.stream, 'pgssub');
        if (pgs) {
            pgs.renderAtTimestamp(-1);
            pgs.loadFromUrl(subUrl);
        } else {
            pgs = new PgsRenderer({ video, subUrl, workerUrl: LIBPGS_WORKER, aspectRatio: 'contain', timeOffset: -offset });
            pgs.canvas.classList.add('pl-subs-canvas');
        }
        pgs.canvas.hidden = false;
        followFrames();
        await pgs.ready;
        if (!closed && active === t) pgs.renderAtTimestamp(video.currentTime - offset);
    }

    function hidePgs() {
        if (pgs?.canvas) pgs.canvas.hidden = true;
        if (pgsFrame) video.cancelVideoFrameCallback?.(pgsFrame);
        pgsFrame = 0;
    }

    function select(id) {
        const t = tracks.find(x => x.id === id) || null;
        active = t;
        for (const x of tracks) if (x.el) x.el.track.mode = x === t ? 'showing' : 'disabled';
        pending++;
        // A <track> already loaded does not fire again
        loading(t && !(t.el && t.el.readyState === 2) ? t : null);
        if (t?.kind !== 'ass') hideAss();
        if (t?.kind !== 'pgs') hidePgs();
        if (t?.kind === 'text') shiftCues(t);
        if (t?.kind === 'ass') {
            if (jassub?._canvas) jassub._canvas.hidden = false;
            showAss(t).catch(err => console.warn('ASS subtitles failed:', err.message)).finally(() => loaded(t));
        } else if (t?.kind === 'pgs') {
            showPgs(t).catch(err => console.warn('PGS subtitles failed:', err.message)).finally(() => loaded(t));
        }
        onChange(t ? t.id : null);
    }

    // Jellyfin's pick (the user's language settings), else forced, default, English, first
    const def = source.DefaultSubtitleStreamIndex;
    const first = (def != null && def >= 0 && tracks.find(t => t.id === def))
        || tracks.find(t => t.stream.IsForced) || tracks.find(t => t.stream.IsDefault)
        || tracks.find(t => /^(eng|en)$/i.test(t.stream.Language || '')) || tracks[0] || null;
    // pick: the track chosen for this show before (null: none), undefined leaves it to Jellyfin
    const list = () => tracks.map(t => ({ id: t.id, label: t.label, lang: t.stream.Language || '', title: t.stream.Title || '', forced: !!t.stream.IsForced }));
    const picked = pick(list());
    if (picked !== undefined) { if (picked != null) select(picked); }
    else if (first && def !== -1) select(first.id);

    return {
        list,
        current: () => active?.id ?? null,
        // What draws the track, for the stats
        kind: (id) => ({ ass: 'libass', pgs: 'libpgs', text: 'WebVTT' })[tracks.find(t => t.id === id)?.kind] || '',
        select,
        delay: () => offset,
        setDelay(seconds) {
            offset = Math.round(Math.max(-30, Math.min(30, Number(seconds) || 0)) * 10) / 10;
            for (const t of tracks) if (t.kind === 'text') shiftCues(t);
            if (jassub) jassub.timeOffset = -offset;
            if (pgs) {
                pgs.timeOffset = -offset;
                if (active?.kind === 'pgs') pgs.renderAtTimestamp(video.currentTime - offset);
            }
            return offset;
        },
        destroy() {
            closed = true;
            loading(null);
            try { jassub?.destroy(); } catch { /* already gone */ }
            jassub = null;
            hidePgs();
            try { pgs?.dispose(); } catch { /* already gone */ }
            pgs = null;
        },
    };
}
