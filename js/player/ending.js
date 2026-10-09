// @ts-check
// Where an episode's ending is, and where Up next may come in. Two sources, both optional:
//   segments  Jellyfin's media segments [{ type: 'Outro' | 'Preview' | ..., start, end }] (the Intro Skipper plugin)
//   ending    AniSkip's endings [{ type: 'ed' | 'mixed-ed', start, end, length }] (js/pages/play.js loadEnding)
// All in seconds. Story comes first: credits with scenes in them (AniSkip's "mixed" ending) keep playing until
// they are over, and a scene after the credits (more than a few seconds left that are no next-episode preview)
// keeps Up next away until the very end. Without either source: the last 30 s.

const TAIL_S = 12;      // more than this after the credits is a scene, not a logo
const LENGTH_FIT_S = 20; // AniSkip's times count from its file's start: only used for a file this close in length

/**
 * @param {number} d the video's length
 * @param {{ type: string, start: number, end: number }[]} segments
 * @param {{ type: string, start: number, end: number, length: number }[]} ending
 */
export function endingInfo(d, segments = [], ending = []) {
    if (!(d > 0)) return { story: false, storyUntil: 0, sceneAfter: false, creditsAt: null };
    const fit = ending.filter(r => !r.length || Math.abs(r.length - d) <= LENGTH_FIT_S);
    // A "mixed" ending in the first half is a misfiled opening: ignored
    const mixed = fit.find(r => r.type === 'mixed-ed' && r.start > d * 0.5);
    const ed = fit.find(r => r.type === 'ed');
    const outro = segments.find(g => g.type === 'Outro' && g.end >= d - 120);
    const preview = outro && segments.find(g => g.type === 'Preview' && g.start >= outro.end - 2);
    // Seconds of story after the ending: AniSkip's ending measured from the end of its file, else Jellyfin's
    // credits when nothing but a preview follows them
    const after = ed ? (ed.length || d) - ed.end : outro && !preview ? d - outro.end : 0;
    return {
        story: !!mixed,
        storyUntil: mixed ? d - ((mixed.length || d) - mixed.end) : 0,
        sceneAfter: after > TAIL_S,
        creditsAt: ed ? d - ((ed.length || d) - ed.start) : outro ? outro.start : null,
    };
}

/** Where Up next comes in (seconds), see above */
export function upNextAt(d, segments = [], ending = []) {
    if (!(d > 0)) return Infinity;
    const e = endingInfo(d, segments, ending);
    const last = d - Math.min(8, d * 0.05);
    if (e.sceneAfter) return last;
    if (e.story) return Math.min(last, Math.max(e.storyUntil, e.creditsAt ?? 0));
    return e.creditsAt ?? d - Math.min(30, d * 0.1);
}
