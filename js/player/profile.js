// @ts-check
// The DeviceProfile sent with PlaybackInfo: what THIS browser can play, measured, not assumed.
// Jellyfin plays a file as it is when everything fits, copies what fits into HLS (remux) and only
// converts the rest — usually just the audio (E-AC3, TrueHD), sometimes the video (HEVC on Linux).

// Codec strings to test with, one typical profile each
const VIDEO = {
    h264: 'avc1.640029',
    hevc: 'hvc1.2.4.L120.B0',
    av1: 'av01.0.08M.08',
    vp9: 'vp09.00.40.08',
};
const AUDIO = {
    aac: 'mp4a.40.2',
    mp3: 'mp4a.6B',
    opus: 'opus',
    flac: 'flac',
    ac3: 'ac-3',
    eac3: 'ec-3',
};

function mse(type) {
    try { return !!window.MediaSource?.isTypeSupported(type); } catch { return false; }
}

function canPlay(type) {
    try { return document.createElement('video').canPlayType(type) !== ''; } catch { return false; }
}

// What plays in <video src> (direct) and what hls.js can feed through MSE (fMP4 segments)
export function capabilities() {
    const nativeHls = canPlay('application/vnd.apple.mpegurl');
    const video = Object.keys(VIDEO).filter(c => canPlay(`video/mp4; codecs="${VIDEO[c]}"`) || mse(`video/mp4; codecs="${VIDEO[c]}"`));
    const audio = Object.keys(AUDIO).filter(c => canPlay(`audio/mp4; codecs="${AUDIO[c]}"`) || mse(`audio/mp4; codecs="${AUDIO[c]}"`));
    const webmVideo = ['vp9', 'av1'].filter(c => canPlay(`video/webm; codecs="${VIDEO[c]}"`));
    const webmAudio = ['opus', 'vorbis'].filter(c => canPlay(`audio/webm; codecs="${c}"`));
    // MKV only where the browser says so for a real codec, not just for the container
    const mkv = canPlay(`video/x-matroska; codecs="${VIDEO.h264}, ${AUDIO.aac}"`);
    return { video, audio, webmVideo, webmAudio, mkv, nativeHls, mse: !!window.MediaSource };
}

// maxBitrate: bits per second the way to the server carries (the public address sits behind
// a home upload of about 30 Mbit/s, measured 2026-09-29)
export function deviceProfile(maxBitrate) {
    const caps = capabilities();
    const v = caps.video.join(',');
    const a = caps.audio.join(',');

    const direct = [{ Type: 'Video', Container: 'mp4,m4v,mov', VideoCodec: v, AudioCodec: a }];
    if (caps.webmVideo.length) direct.push({ Type: 'Video', Container: 'webm', VideoCodec: caps.webmVideo.join(','), AudioCodec: caps.webmAudio.join(',') });
    if (caps.mkv) direct.push({ Type: 'Video', Container: 'mkv', VideoCodec: v, AudioCodec: a });

    // HLS with fMP4 segments: HEVC and FLAC can be copied into it, TS could not carry them
    // H.264 first: that is what Jellyfin encodes to; the others are only copied
    const hlsVideo = ['h264', ...caps.video.filter(c => c === 'hevc' || c === 'av1')];
    const hlsAudio = caps.audio.filter(c => ['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3'].includes(c));

    return {
        MaxStreamingBitrate: maxBitrate,
        MaxStaticBitrate: maxBitrate,
        MusicStreamingTranscodingBitrate: 384000,
        DirectPlayProfiles: direct,
        TranscodingProfiles: [{
            Type: 'Video',
            Container: 'mp4',
            Protocol: 'hls',
            VideoCodec: hlsVideo.join(','),
            AudioCodec: (hlsAudio.length ? hlsAudio : ['aac']).join(','),
            Context: 'Streaming',
            MaxAudioChannels: '6',
            MinSegments: 1,
            BreakOnNonKeyFrames: true,
        }],
        ContainerProfiles: [],
        CodecProfiles: [
            // canPlayType says "probably" for 10-bit H.264 (Hi10P), then fails to decode it
            { Type: 'Video', Codec: 'h264', Conditions: [{ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false }] },
        ],
        // Phase 1: text subtitles as WebVTT; ASS and PGS get their own renderers in phase 2
        SubtitleProfiles: [
            { Format: 'vtt', Method: 'External' },
            { Format: 'ass', Method: 'External' },
            { Format: 'ssa', Method: 'External' },
            { Format: 'pgssub', Method: 'External' },
            { Format: 'srt', Method: 'External' },
            { Format: 'subrip', Method: 'External' },
            { Format: 'dvdsub', Method: 'Encode' },
        ],
    };
}
