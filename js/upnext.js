// @ts-check
// What Home says about your list, the same in both designs (Home in js/pages/home.js, M3's hero in js/m3.js):
// the next episode of the show you're on, what is waiting, and the week ahead.

// One entry: the next episode, how many are out and unwatched, a one-line status
export function upNext(entry) {
    const m = entry.media;
    const progress = entry.progress || 0;
    const total = m.episodes || null;
    const airing = m.nextAiringEpisode || null;
    const out = airing ? Math.max(0, airing.episode - 1) : total;    // episodes you could watch right now
    const behind = out != null ? Math.max(0, out - progress) : null;
    const done = !!total && progress >= total;
    const status = done ? 'All caught up'
        : behind > 1 ? `${behind} episodes waiting`
        : behind === 1 ? 'Ready to watch'
        : airing ? `Episode ${airing.episode} airs in ${until(airing.timeUntilAiring)}` : '';
    return { m, progress, next: progress + 1, total, airing, out, behind, done, status, canWatch: !done && (behind == null || behind > 0) };
}

// The show Home's hero is about: the most recent one with an episode out to watch, so a show that is waiting
// for its next airing doesn't take the spot from one you can play right now. Nothing to watch: the most recent
export function heroEntry(entries) {
    return entries.find(e => upNext(e).canWatch) || entries[0];
}

// All of Continue Watching: the soonest airing episode, what's waiting, which weekday each show airs (Monday first).
// Nothing on it airing? Then `next` is the next premiere from Planning (`premiere: true`), so the countdown stays
export function glance(entries, now = Date.now() / 1000, planning = []) {
    const airing = entries.filter(e => e.media.nextAiringEpisode?.airingAt > now)
        .sort((a, b) => a.media.nextAiringEpisode.airingAt - b.media.nextAiringEpisode.airingAt);
    const waiting = entries.map(e => ({ e, n: upNext(e).behind || 0 })).filter(x => x.n > 0);
    const premieres = planning
        .filter(e => e.media.status === 'NOT_YET_RELEASED' && e.media.nextAiringEpisode?.airingAt > now)
        .sort((a, b) => a.media.nextAiringEpisode.airingAt - b.media.nextAiringEpisode.airingAt);
    // The week, Monday to Sunday: what airs weekly (watched, or planned and already running) on the weekday of its
    // next episode, plus Planning premieres before Sunday ends
    const sunday = new Date(now * 1000);
    sunday.setHours(24, 0, 0, 0);
    sunday.setDate(sunday.getDate() + 6 - weekday(now));
    const running = planning.filter(e => e.media.status === 'RELEASING' && e.media.nextAiringEpisode?.airingAt > now);
    const week = [...airing, ...running, ...premieres.filter(e => e.media.nextAiringEpisode.airingAt < sunday.getTime() / 1000)];
    const byDay = Array.from({ length: 7 }, () => []);
    week.forEach(e => byDay[weekday(e.media.nextAiringEpisode.airingAt)].push(e.media));
    const premiere = airing.length ? null : premieres[0];
    const next = airing[0] || (premiere ? { ...premiere, premiere: true } : null);
    return { next, airing, week, waiting, waitingTotal: waiting.reduce((s, x) => s + x.n, 0), byDay, today: weekday(now) };
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekday = (seconds) => (new Date(seconds * 1000).getDay() + 6) % 7;

export function until(seconds) {
    const d = Math.floor(seconds / 86400), h = Math.floor(seconds / 3600);
    return d >= 1 ? `${d}d` : h >= 1 ? `${h}h` : `${Math.max(1, Math.round(seconds / 60))}m`;
}

export function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// "Play episode N" in Home's hero, from the user's own Jellyfin; loaded only when Jellyfin is set up
export function playFromHero(root, entry, size = '') {
    let configured = false;
    try { configured = !!localStorage.getItem('aniroll_jf_url'); } catch { /* storage blocked */ }
    if (!entry || !configured) return;
    const { m, next, canWatch } = upNext(entry);
    if (!canWatch) return;
    // List entries come without `type`: Home's hero is anime only
    import('./player/playbutton.js?v=161').then(p => p.mountHeroPlay(root, { ...m, type: m.type || 'ANIME' }, next, size)).catch(() => {});
}
