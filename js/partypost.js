// @ts-check
// The AniList activity posted by "End & Post". shows: [{ mediaId, title, startEp, endEp, episodes }] where
// startEp is the counter when the show started and endEp when it ended — episodes watched are
// startEp+1 … endEp; episodes (the show's count, 0 when unknown) tells a finished show apart.
// One episode reads "Episode 10", never "episode 10 - 10".
// Each show's AniList URL goes on a line of its own at the end: AniList (and AniRoll's Social
// page) turn exactly that into a media card. A markdown link [title](url) only renders as text.
// best: a line on the best-liked episode (from the party's votes), added after the summary
export function buildPartyPost({ shows, members = [], best = '' }) {
    const post = partySummary({ shows, members });
    if (!best) return post;
    // The AniList URLs stay at the very end, where they become media cards
    const lines = post.split('\n');
    const firstUrl = lines.findIndex(l => /^https:\/\/anilist\.co\//.test(l));
    if (firstUrl < 0) return `${post}\n${best}`;
    lines.splice(firstUrl, 0, best);
    return lines.join('\n');
}

function partySummary({ shows, members = [] }) {
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const episodes = (s) => (s.endEp - s.startEp === 1
        ? `Episode ${s.endEp}`
        : `Episodes ${s.startEp + 1}–${s.endEp}`);
    const url = (s) => `https://anilist.co/anime/${s.mediaId}`;
    const names = members.map(n => `@${n}`);
    const withWhom = !names.length ? ''
        : names.length === 1 ? ` with ${names[0]}`
        : ` with ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

    // Its last episode reached in this party (a film or a one-off has nothing to finish)
    const finished = (s) => s.episodes > 1 && s.endEp >= s.episodes;
    const watched = shows.filter(s => s.endEp > s.startEp);
    if (!watched.length) {
        // Party ended before an episode was ticked off — don't claim one was watched
        const last = shows.at(-1);
        return `Watch Party: ${last.title}${withWhom}\n${url(last)}`;
    }
    if (watched.length === 1) {
        const s = watched[0];
        // The whole show in one party, its end reached in this one, or part of it
        if (finished(s) && s.startEp === 0) return `Completed ${s.title} · all ${s.episodes} episodes in a Watch Party${withWhom}\n${url(s)}`;
        if (finished(s)) return `Finished ${s.title} · ${episodes(s)} in a Watch Party${withWhom}\n${url(s)}`;
        return `Watched ${s.title} · ${episodes(s)} in a Watch Party${withWhom}\n${url(s)}`;
    }
    const total = watched.reduce((sum, s) => sum + (s.endEp - s.startEp), 0);
    const done = watched.filter(finished).length;
    return [
        `Watch Party${withWhom} · ${plural(watched.length, 'show')}, ${plural(total, 'episode')}${done ? `, ${done} completed` : ''}`,
        ...watched.map(s => `• ${s.title} · ${finished(s) && s.startEp === 0 ? `all ${s.episodes} episodes` : episodes(s)}${finished(s) ? ' · completed' : ''}`),
        ...watched.map(url),
    ].join('\n');
}
