// A stand-in for a Jellyfin 12 server, for the player checks: one series ("Show 1", 12 episodes),
// a 20-second VP9/Opus clip for every episode (the test browser has no H.264), WebVTT subtitles.
// Episode 5 needs converting and the server fails at it — the graphics card being full, as measured
// on the real server. Every playback report is recorded in `calls`.
const fs = require('fs');
const path = require('path');

const JF_URL = 'https://jellyfin.e2e.test';
const JF_USER = 'jf-user-1';
const CLIP = fs.readFileSync(path.join(__dirname, 'media', 'clip.webm'));
// A white bar from 0.5 s to 15 s, drawn as a Blu-ray (PGS) subtitle; made by media/make-sup.py
const SUP = fs.readFileSync(path.join(__dirname, 'media', 'sub.sup'));
// The repository (deploy.sh points this at the obfuscated copy)
const ROOT = path.join(__dirname, '..', '..');
// Any font does for the embedded-font path: JASSUB's own default face
const FONT = fs.readFileSync(path.join(ROOT, 'js', 'vendor', 'jassub-2.5.16', 'default.woff2'));
// Any picture does for the episode thumbnails
const THUMB = fs.readFileSync(path.join(ROOT, 'og-image-v3.jpg'));
const ASS_SCRIPT = `[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Liberation Sans,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:19.00,Default,,0,0,0,,{\\an8\\pos(320,60)}A styled sign\n`;
const RUNTIME = 20 * 10_000_000;
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function episode(n) {
    return { Id: `ep${n}`, Name: `Episode ${n}`, SeriesName: 'Show 1', IndexNumber: n, ParentIndexNumber: 1,
        RunTimeTicks: RUNTIME, ImageTags: { Primary: `t${n}` },
        // Episode 1 watched, episode 3 half-way
        UserData: { Played: n === 1, PlaybackPositionTicks: n === 3 ? RUNTIME / 2 : 0 } };
}

function mediaSource(id) {
    if (id === 'ep5') {
        return { Id: id, Container: 'mkv', SupportsDirectPlay: false, SupportsDirectStream: false,
            TranscodingUrl: `/videos/${id}/master.m3u8?MediaSourceId=${id}&TranscodeReasons=VideoCodecNotSupported&ApiKey=x`,
            MediaStreams: [] };
    }
    return {
        Id: id, Container: 'webm', SupportsDirectPlay: true, SupportsDirectStream: true, RunTimeTicks: RUNTIME,
        MediaStreams: [
            { Type: 'Video', Index: 0, Codec: 'vp9' },
            { Type: 'Audio', Index: 1, Codec: 'opus', Language: 'jpn', DisplayTitle: 'Japanese - Opus - Stereo', Title: 'Japanese' },
            // Episodes 6 and 7: dual audio, Japanese first, an English dub second
            ...(id === 'ep6' || id === 'ep7' ? [{ Type: 'Audio', Index: 5, Codec: 'opus', Language: 'eng', DisplayTitle: 'English - Opus - Stereo', Title: 'English' }] : []),
            { Type: 'Subtitle', Index: 2, Codec: 'subrip', Language: 'eng', DisplayTitle: 'English', IsTextSubtitleStream: true, IsDefault: id !== 'ep3' },
            // Episode 3: styled ASS with an embedded font, as in most fansub and BD releases
            ...(id === 'ep3' ? [{ Type: 'Subtitle', Index: 3, Codec: 'ass', Language: 'eng', DisplayTitle: 'English (Signs & Songs)', IsTextSubtitleStream: true, IsDefault: true }] : []),
            // Episode 4: Blu-ray pictures (PGS), as in BD remuxes
            ...(id === 'ep4' ? [{ Type: 'Subtitle', Index: 3, Codec: 'PGSSUB', Language: 'eng', DisplayTitle: 'English [PGS]', IsTextSubtitleStream: false, IsDefault: true }] : []),
        ],
        MediaAttachments: id === 'ep3' ? [{ Index: 4, FileName: 'LiberationSans.woff2', MimeType: 'font/woff2' }] : [],
        DefaultAudioStreamIndex: 1,
        DefaultSubtitleStreamIndex: id === 'ep3' || id === 'ep4' ? 3 : 2,
    };
}

// Installs the mock on a Playwright page. Returns what the app sent, to check against.
// anyTitle: every search finds the series (screenshots with real show names)
async function mockJellyfin(page, { anyTitle = false } = {}) {
    const calls = [];
    let lastAudio = null; // the track Jellyfin "remembers" from the reports
    await page.route(`${JF_URL}/**`, async route => {
        const req = route.request();
        const url = new URL(req.url());
        const p = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

        if (p === '/System/Info/Public') return json({ Id: 'e2e', ServerName: 'E2E Jellyfin', Version: '12.1.0' });
        // Quick Connect: the second question after the code finds it confirmed
        if (p === '/QuickConnect/Initiate') {
            calls.push({ type: 'qcInitiate', auth: req.headers().authorization || '' });
            return json({ Code: '482913', Secret: 'qc-secret', Authenticated: false });
        }
        if (p === '/QuickConnect/Connect') {
            const asked = calls.filter(c => c.type === 'qcConnect').length;
            calls.push({ type: 'qcConnect' });
            return json({ Authenticated: asked >= 1, Secret: url.searchParams.get('secret') });
        }
        if (p === '/Users/AuthenticateWithQuickConnect') {
            calls.push({ type: 'qcAuth', body: req.postDataJSON() });
            return json({ AccessToken: 'qc-token', User: { Id: JF_USER, Name: 'friend', ServerName: 'E2E Jellyfin' } });
        }
        if (p === '/Users/Me') return json({ Id: JF_USER, Name: 'friend' });
        if (p === `/Users/${JF_USER}/Items`) {
            // Like Jellyfin 12: an unknown provider filter is ignored and the whole library comes back
            if (url.searchParams.get('AnyProviderIdEquals')) return json({ Items: [{ Id: 'wrong-series', Name: 'Black Torch', ProviderIds: {} }, { Id: 'series1', Name: 'Show 1', ProviderIds: {} }] });
            const term = (url.searchParams.get('searchTerm') || '').toLowerCase();
            return json({ Items: term === 'show 1' || anyTitle ? [{ Id: 'series1', Name: anyTitle ? url.searchParams.get('searchTerm') : 'Show 1', ProductionYear: anyTitle ? null : 2026 }] : [] });
        }
        if (p === '/Shows/series1/Episodes') return json({ Items: Array.from({ length: 12 }, (_, i) => episode(i + 1)) });
        if (/^\/Items\/ep\d+\/Images\/Primary$/.test(p)) {
            return route.fulfill({ status: 200, headers: CORS, contentType: 'image/jpeg', body: THUMB });
        }
        const item = p.match(new RegExp(`^/Users/${JF_USER}/Items/(ep\\d+)$`));
        if (item) return json({ ...episode(Number(item[1].slice(2))), MediaSources: [mediaSource(item[1])] });
        const info = p.match(/^\/Items\/(ep\d+)\/PlaybackInfo$/);
        if (info) {
            // Like Jellyfin 12: the audio track counts only from the query; without it, the one last reported
            const asked = url.searchParams.get('AudioStreamIndex');
            calls.push({ type: 'PlaybackInfo', item: info[1], body: req.postDataJSON(), audio: asked == null ? null : Number(asked) });
            const source = mediaSource(info[1]);
            const audio = asked != null ? Number(asked) : lastAudio;
            if (audio != null && source.MediaStreams.some(s => s.Type === 'Audio' && s.Index === audio)) source.DefaultAudioStreamIndex = audio;
            return json({ MediaSources: [source], PlaySessionId: `ps-${info[1]}` });
        }
        if (/^\/Videos\/ep\d+\/stream$/.test(p)) {
            calls.push({ type: 'stream', item: p.split('/')[2], query: Object.fromEntries(url.searchParams) });
            // Range requests, like the real server: without them the browser cannot seek
            const range = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
            if (!range) return route.fulfill({ status: 200, headers: { ...CORS, 'Accept-Ranges': 'bytes' }, contentType: 'video/webm', body: CLIP });
            const from = Number(range[1]);
            const to = range[2] ? Math.min(Number(range[2]), CLIP.length - 1) : CLIP.length - 1;
            return route.fulfill({ status: 206, contentType: 'video/webm', body: CLIP.subarray(from, to + 1),
                headers: { ...CORS, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${from}-${to}/${CLIP.length}` } });
        }
        if (/\/Subtitles\/\d+\/0\/Stream\.ass$/.test(p)) {
            calls.push({ type: 'ass' });
            return route.fulfill({ status: 200, headers: CORS, contentType: 'text/x-ssa', body: ASS_SCRIPT });
        }
        if (/\/Subtitles\/\d+\/0\/Stream\.pgssub$/.test(p)) {
            calls.push({ type: 'pgs' });
            return route.fulfill({ status: 200, headers: CORS, contentType: 'application/octet-stream', body: SUP });
        }
        if (/\/Attachments\/\d+$/.test(p)) {
            calls.push({ type: 'font', auth: req.headers().authorization || '' });
            return route.fulfill({ status: 200, headers: CORS, contentType: 'font/woff2', body: FONT });
        }
        if (/\/Subtitles\/\d+\/0\/Stream\.vtt$/.test(p)) {
            calls.push({ type: 'vtt', item: p.split('/')[2] });
            return route.fulfill({ status: 200, headers: CORS, contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:00:19.000\nHello from Jellyfin\n' });
        }
        // The playlists come back fine, the first segment fails with 500 — as when ffmpeg finds no GPU memory
        if (/\/master\.m3u8$/.test(p)) {
            calls.push({ type: 'master', item: p.split('/')[2] });
            return route.fulfill({ status: 200, headers: CORS, contentType: 'application/vnd.apple.mpegurl',
                body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1920x1080\nmain.m3u8\n' });
        }
        if (/\/main\.m3u8$/.test(p)) {
            return route.fulfill({ status: 200, headers: CORS, contentType: 'application/vnd.apple.mpegurl',
                body: '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="hls1/main/-1.mp4"\n#EXTINF:3,\nhls1/main/0.mp4\n#EXTINF:3,\nhls1/main/1.mp4\n#EXT-X-ENDLIST\n' });
        }
        if (/\/hls1\/main\/-?\d+\.mp4$/.test(p)) {
            calls.push({ type: 'segment', path: p });
            return route.fulfill({ status: 500, headers: CORS, body: '' });
        }
        // The Intro Skipper plugin's intro: 2 s to 7 s
        if (/^\/MediaSegments\/ep\d+$/.test(p)) {
            return json({ Items: [{ Id: 's1', ItemId: p.split('/')[2], Type: 'Intro', StartTicks: 2 * 10_000_000, EndTicks: 7 * 10_000_000 }], TotalRecordCount: 1 });
        }
        if (p.startsWith('/Sessions/Playing')) {
            calls.push({ type: p.replace('/Sessions/', ''), body: req.postDataJSON(), auth: req.headers().authorization || '' });
            if (req.postDataJSON()?.AudioStreamIndex != null) lastAudio = req.postDataJSON().AudioStreamIndex;
            return route.fulfill({ status: 204, headers: CORS });
        }
        if (p === '/Videos/ActiveEncodings' && req.method() === 'DELETE') {
            calls.push({ type: 'stopEncoding', query: Object.fromEntries(url.searchParams) });
            return route.fulfill({ status: 204, headers: CORS });
        }
        return json({ error: `mock: ${req.method()} ${p}` }, 404);
    });
    return calls;
}

// localStorage for a signed-in Jellyfin user (a friend's account, not an API key)
const JF_STORAGE = {
    aniroll_jf_url: JF_URL,
    aniroll_jf_apikey: 'e2e-jf-token',
    aniroll_jf_userid: JF_USER,
    aniroll_jf_username: 'friend',
    aniroll_jf_servername: 'E2E Jellyfin',
    aniroll_jf_kind: 'user',
    aniroll_jf_scope: 'device',
};

module.exports = { mockJellyfin, JF_URL, JF_STORAGE };
