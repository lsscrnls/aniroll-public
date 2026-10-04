import * as api from '../api.js?v=141';
import { cachedQuery } from '../api.js?v=141';
import { getState, esc, titlePref, renderPageSwitch, toast } from '../store.js?v=141';
import { getToken, isLoggedIn } from '../auth.js?v=141';

const VIEW_KEY = 'aniroll_cal_view';
const ANCHOR_KEY = 'aniroll_cal_anchor';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Weeks start on Monday (European convention); getDay() counts from Sunday
function startOfWeek(d) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    day.setDate(day.getDate() - (day.getDay() + 6) % 7);
    return day;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sameDay = (a, b) => dayKey(a) === dayKey(b);

export async function render({ content, query: q }) {
    const token = getToken();
    const now = new Date();

    // Week by default: anime air weekly, so one week shows the whole schedule exactly once, with times.
    // The month stays one click away. `anchor` is the first day shown (a Monday, or the 1st).
    let view = localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week';
    const savedAnchor = Number(sessionStorage.getItem(ANCHOR_KEY));
    let anchor = savedAnchor ? new Date(savedAnchor) : now;
    anchor = view === 'week' ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), 1);

    // The range on screen: [start, end] as Dates
    const range = () => (view === 'week'
        ? { start: anchor, end: new Date(addDays(anchor, 7).getTime() - 1000) }
        : { start: anchor, end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59) });

    const defaultFilter = isLoggedIn() ? 'mylist' : 'all';
    let filter = defaultFilter;
    let showImages = localStorage.getItem('aniroll_cal_images') !== 'off';

    content.innerHTML = `<div class="page-enter discover-page">
        ${renderPageSwitch('calendar')}
        <div class="calendar-controls">
            <button class="season-nav-btn" id="cal-prev">
                <svg data-icon="chevron_left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h1 class="calendar-month" id="cal-month"></h1>
            <button class="season-nav-btn" id="cal-next">
                <svg data-icon="chevron_right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="cal-today" hidden>Today</button>
            <div class="calendar-views" role="group" aria-label="Calendar view">
                <button class="list-tab${view === 'week' ? ' active' : ''}" data-view="week" aria-pressed="${view === 'week'}">Week</button>
                <button class="list-tab${view === 'month' ? ' active' : ''}" data-view="month" aria-pressed="${view === 'month'}">Month</button>
            </div>
            <div class="calendar-filters">
                <button class="list-tab${filter === 'all' ? ' active' : ''}" data-filter="all">All Airing</button>
                ${isLoggedIn() ? `
                    <button class="list-tab${filter === 'mylist' ? ' active' : ''}" data-filter="mylist">My List</button>
                ` : ''}
            </div>
            <button class="glass-btn glass-btn-secondary glass-btn-sm" id="cal-ics" title="Download what is shown as a calendar file: your phone's calendar reminds you at air time">Add to my calendar</button>
            <div class="calendar-toggle">
                <span class="dot-label">Images</span>
                <button class="calendar-toggle-switch ${showImages ? 'on' : ''}" id="cal-img-toggle"></button>
            </div>
        </div>
        <div id="cal-grid"></div>
    </div>`;

    let airingData = [];
    // What the grid shows right now, for the calendar file
    let shownEpisodes = [];
    let userOnList = new Set();
    let userMediaMap = new Map();
    // Your status and progress per show, for "Next up" / "2 behind" in the week view
    const userEntries = new Map();

    async function loadUserLists() {
        if (!isLoggedIn()) return;
        const user = getState().user;
        if (!user) return;

        try {
            const lists = await api.getMediaList(user.id, 'ANIME', token);
            const watching = lists.find(l => l.status === 'CURRENT');
            const planning = lists.find(l => l.status === 'PLANNING');
            for (const list of [watching, planning]) {
                (list?.entries || []).forEach(e => {
                    userOnList.add(e.media.id);
                    userMediaMap.set(e.media.id, e.media);
                    userEntries.set(e.media.id, { status: list.status, progress: e.progress || 0 });
                });
            }
        } catch (e) {
            console.error('Failed to load user lists:', e);
        }
    }

    let kitsuData = new Map();

    async function loadKitsuFallbacks() {
        const scheduledIds = new Set(airingData.map(a => a.media?.id));
        const needsKitsu = [];

        for (const [id, media] of userMediaMap) {
            if (scheduledIds.has(id)) continue;
            if (media.nextAiringEpisode?.airingAt) continue;
            if (media.idMal && !kitsuData.has(id)) needsKitsu.push({ id, malId: media.idMal });
        }

        const batch = needsKitsu.slice(0, 10);
        const results = await Promise.allSettled(
            batch.map(({ id, malId }) => api.getKitsuEpisodes(malId).then(d => ({ id, data: d })))
        );
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value.data) {
                kitsuData.set(r.value.id, r.value.data);
            }
        }
    }

    function generateForecastEntries() {
        const scheduledIds = new Set(airingData.map(a => a.media?.id));
        const forecasted = [];
        const { start: monthStart, end: monthEnd } = range();

        for (const [id, media] of userMediaMap) {
            if (scheduledIds.has(id)) continue;
            if (media.nextAiringEpisode?.airingAt) continue;

            const kitsu = kitsuData.get(id);
            if (kitsu?.episodes?.length) {
                for (const ep of kitsu.episodes) {
                    const d = new Date(ep.airdate + 'T00:00:00');
                    if (d < monthStart || d > monthEnd) continue;
                    forecasted.push({
                        airingAt: Math.floor(d.getTime() / 1000),
                        episode: ep.number,
                        media,
                        _forecast: true,
                        _source: 'kitsu'
                    });
                }
                continue;
            }

            if (!media.startDate?.year || !media.startDate?.month || !media.startDate?.day) continue;

            const skipFormats = ['MOVIE', 'TV_SHORT', 'SPECIAL', 'MUSIC'];
            let totalEpisodes = media.episodes || kitsu?.episodeCount;
            if (!totalEpisodes) {
                if (skipFormats.includes(media.format)) continue;
                totalEpisodes = 12;
            }

            const startDate = new Date(media.startDate.year, media.startDate.month - 1, media.startDate.day);

            if (media.endDate?.year && media.endDate?.month && media.endDate?.day) {
                const endDate = new Date(media.endDate.year, media.endDate.month - 1, media.endDate.day);
                if (endDate < monthStart) continue;
            }

            for (let ep = 1; ep <= totalEpisodes; ep++) {
                const epDate = new Date(startDate);
                epDate.setDate(epDate.getDate() + (ep - 1) * 7);

                if (epDate > monthEnd) break;
                if (epDate < monthStart) continue;

                forecasted.push({
                    airingAt: Math.floor(epDate.getTime() / 1000),
                    episode: ep,
                    media,
                    _forecast: true
                });
            }
        }

        return forecasted;
    }

    // AniList only schedules episodes with a confirmed date. A show can have more episodes than
    // dated ones — Sparks of Tomorrow: 13 episodes, 12 dated, so the calendar ended a week early.
    // Continue the weekly rhythm from the last dated episode up to the episode count, marked as an
    // estimate. The show's end date caps it: remaining episodes past it land on the end date.
    const WEEK = 7 * 24 * 60 * 60;

    function projectMissingEpisodes(monthStartTs, monthEndTs) {
        if (!airingComplete) return [];
        const lastDated = new Map();
        for (const a of airingData) {
            const id = a.media?.id;
            if (!id) continue;
            const prev = lastDated.get(id);
            if (!prev || a.episode > prev.episode) lastDated.set(id, a);
        }

        const projected = [];
        for (const last of lastDated.values()) {
            const m = last.media;
            if (!m.episodes || last.episode >= m.episodes || m.status !== 'RELEASING') continue;

            // Same time of day as the last dated episode, on the show's end date
            const lastTime = new Date(last.airingAt * 1000);
            const endAt = m.endDate?.year && m.endDate?.month && m.endDate?.day
                ? Math.floor(new Date(m.endDate.year, m.endDate.month - 1, m.endDate.day,
                    lastTime.getHours(), lastTime.getMinutes()).getTime() / 1000)
                : Infinity;

            for (let ep = last.episode + 1; ep <= m.episodes; ep++) {
                const at = Math.min(last.airingAt + (ep - last.episode) * WEEK, endAt);
                if (at <= last.airingAt || at > monthEndTs) break;
                if (at < monthStartTs) continue;
                projected.push({ airingAt: at, episode: ep, media: m, _forecast: true, _projected: true });
            }
        }
        return projected;
    }

    // mine: only the shows on the user's list (mediaId_in) — usually a single page
    const scheduleQuery = (mine) => `query ($page: Int, $airingAtGreater: Int, $airingAtLesser: Int${mine ? ', $mediaIds: [Int]' : ''}) {
        Page(page: $page, perPage: 50) {
            pageInfo { hasNextPage }
            airingSchedules(airingAt_greater: $airingAtGreater, airingAt_lesser: $airingAtLesser${mine ? ', mediaId_in: $mediaIds' : ''}, sort: TIME) {
                airingAt episode
                media { id title { userPreferred english romaji native } coverImage { large } format episodes status endDate { year month day } mediaListEntry { status } }
            }
        }
    }`;
    // A busy month is ~600 rows (12 pages). The old fixed limit of 5 pages silently dropped
    // everything after mid-month; this cap only guards against a runaway loop.
    const MAX_SCHEDULE_PAGES = 20;
    let airingComplete = false;

    async function loadAiring() {
        const { start, end } = range();
        // One week before the range too: an episode dated in the week before is what an estimate
        // in the first days of this range continues from
        const startTs = Math.floor(start.getTime() / 1000) - WEEK;
        const endTs = Math.floor(end.getTime() / 1000);

        // "My List" asks AniList only for the listed shows; "All Airing" walks every page
        const mine = filter === 'mylist' && userOnList.size > 0;
        const query = scheduleQuery(mine);
        const vars = { airingAtGreater: startTs, airingAtLesser: endTs, ...(mine ? { mediaIds: [...userOnList] } : {}) };

        let rows = [];
        let page = 1;
        let more = true;
        try {
            while (more && page <= MAX_SCHEDULE_PAGES) {
                const data = await cachedQuery(query, { ...vars, page }, token, 30 * 60 * 1000);
                rows = rows.concat(data.Page.airingSchedules);
                more = data.Page.pageInfo.hasNextPage;
                page++;
            }
        } catch (e) {
            console.error('Failed to load airing schedule:', e);
        }
        airingData = rows;
        // Estimates only on a complete schedule: a missing page looks exactly like a show
        // without dates and would fill the rest of the month with guesses
        airingComplete = !more;
    }

    function renderCalendar() {
        const grid = document.getElementById('cal-grid');
        const label = document.getElementById('cal-month');
        if (!grid || !label) return;

        const { start, end } = range();
        const today = new Date();
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        if (view === 'month') {
            label.textContent = `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
        } else {
            const last = addDays(start, 6);
            const short = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            label.textContent = start.getMonth() === last.getMonth()
                ? `${start.getDate()} – ${short(last)} ${last.getFullYear()}`
                : `${short(start)} – ${short(last)} ${last.getFullYear()}`;
        }
        const todayBtn = document.getElementById('cal-today');
        if (todayBtn) todayBtn.hidden = today >= start && today <= end;

        const startTs = Math.floor(start.getTime() / 1000);
        const endTs = Math.floor(end.getTime() / 1000);
        // The schedule is loaded with a week of lead-in — only the days in range are drawn
        const allData = [
            ...airingData.filter(a => a.airingAt >= startTs && a.airingAt <= endTs),
            ...generateForecastEntries(),
            ...projectMissingEpisodes(startTs, endTs),
        ];
        const filtered = filter === 'mylist' ? allData.filter(a => userOnList.has(a.media?.id)) : allData;
        shownEpisodes = filtered;

        const byDay = {};
        for (const item of filtered) {
            const key = dayKey(new Date(item.airingAt * 1000));
            (byDay[key] ||= []).push(item);
        }
        // Real schedule and estimates are merged — keep each day in airing order
        Object.values(byDay).forEach(list => list.sort((a, b) => a.airingAt - b.airingAt));

        const days = [];
        for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
        const isMobile = window.innerWidth < 769;

        if (isMobile) grid.innerHTML = renderAgenda(days, byDay, today);
        else if (view === 'week') grid.innerHTML = renderWeek(days, byDay, today);
        else grid.innerHTML = renderMonth(days, byDay, today);
    }

    // The last episode is worth pointing out: a show "ending early" is usually just its finale
    const isFinale = (item) => !!item.media?.episodes && item.episode === item.media.episodes;
    const epLabel = (item) => `Ep ${item.episode}${isFinale(item) ? ' · Final' : ''}${item._forecast ? ' (est.)' : ''}`;
    // Projected episodes keep the show's usual time slot; other estimates have none
    const timeOf = (item) => {
        const clock = new Date(item.airingAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return item._projected ? `~${clock}` : item._forecast ? 'Est.' : clock;
    };
    const cover = (item, cls) => (showImages ? `<img class="${cls}" src="${esc(item.media?.coverImage?.large || '')}" alt="" loading="lazy">` : '');

    // Phones, both views: one block per day that has episodes
    function renderAgenda(days, byDay, today) {
        const html = days.map(day => {
            const entries = byDay[dayKey(day)];
            if (!entries?.length) return '';
            const isToday = sameDay(day, today);
            const dateStr = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            return `<div class="schedule-day">
                <h3 class="schedule-day-title ${isToday ? 'today' : ''}">
                    ${isToday ? '<span style="color:var(--user-accent)">●</span> ' : ''}${dateStr}
                </h3>
                <div class="box" style="padding:var(--space-xs)">
                    ${entries.map(item => `<div class="schedule-item ${item._forecast ? 'forecast' : ''}" data-open="${item.media?.id}" role="button" tabindex="0">
                        ${cover(item, 'schedule-cover')}
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(titlePref(item.media?.title))}</div>
                            <div class="schedule-ep${isFinale(item) ? ' finale' : ''}">${epLabel(item)}</div>
                        </div>
                        <span class="schedule-time">${timeOf(item)}</span>
                        ${standing(item) || (userOnList.has(item.media?.id) ? '<span class="schedule-onlist">On List</span>' : '')}
                    </div>`).join('')}
                </div>
            </div>`;
        }).join('');
        return html || `<div class="empty-state"><div class="empty-state-sub">No airing anime this ${view}</div></div>`;
    }

    // Where you stand with a show on your list, next to one of its episodes
    function standing(item) {
        const entry = userEntries.get(item.media?.id);
        if (!entry) return '';
        if (entry.status === 'PLANNING') return '<span class="calendar-week-you">Planning</span>';
        const behind = item.episode - 1 - entry.progress;
        if (entry.progress >= item.episode) return '<span class="calendar-week-you done">Watched</span>';
        if (behind <= 0) return '<span class="calendar-week-you next">Next up</span>';
        return `<span class="calendar-week-you behind">${behind} behind</span>`;
    }

    // Desktop week: seven equal columns across the width, each a small agenda with time, full
    // title, episode and where you stand
    function renderWeek(days, byDay, today) {
        return `<div class="calendar-week">${days.map((day, i) => {
            const entries = byDay[dayKey(day)] || [];
            const isToday = sameDay(day, today);
            const weekday = day.toLocaleDateString('en-GB', { weekday: 'long' });
            return `<section class="calendar-week-day${isToday ? ' today' : ''}${day < today && !isToday ? ' past' : ''}" aria-label="${weekday}, ${day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}">
                <div class="calendar-week-head">
                    <div><span class="calendar-week-name">${WEEKDAYS[i]}</span><span class="calendar-week-count">${entries.length ? `${entries.length} ep${entries.length > 1 ? 's' : ''}` : ''}</span></div>
                    <strong>${day.getDate()}</strong>
                </div>
                ${entries.length ? entries.map(item => {
                    const classes = `${userOnList.has(item.media?.id) ? ' on-list' : ''}${item._forecast ? ' forecast' : ''}${isFinale(item) ? ' finale' : ''}`;
                    return `<div class="calendar-week-item${classes}" data-open="${item.media?.id}" role="button" tabindex="0">
                        ${cover(item, 'calendar-week-cover')}
                        <div class="calendar-week-info">
                            <div class="calendar-week-time">${timeOf(item)}</div>
                            <div class="calendar-week-title">${esc(titlePref(item.media?.title))}</div>
                            <div class="calendar-week-meta"><span class="calendar-week-ep">${epLabel(item)}</span>${standing(item)}</div>
                        </div>
                    </div>`;
                }).join('') : '<div class="calendar-week-empty">No episodes</div>'}
            </section>`;
        }).join('')}</div>`;
    }

    // Desktop month: the overview grid; a full day links to its week
    function renderMonth(days, byDay, today) {
        const first = days[0];
        const leading = (first.getDay() + 6) % 7;
        let html = '<div class="calendar-grid">';
        WEEKDAYS.forEach(d => { html += `<div class="calendar-header-cell">${d}</div>`; });
        for (let i = 0; i < leading; i++) html += '<div class="calendar-cell other-month"></div>';

        for (const day of days) {
            const isToday = sameDay(day, today);
            const entries = byDay[dayKey(day)] || [];
            html += `<div class="calendar-cell ${isToday ? 'today' : ''}">
                <div class="calendar-date ${isToday ? 'today' : ''}">${day.getDate()}</div>
                ${entries.slice(0, 8).map(item => {
                    const title = esc(titlePref(item.media?.title));
                    const classes = `${userOnList.has(item.media?.id) ? 'on-list' : ''} ${item._forecast ? 'forecast' : ''} ${isFinale(item) ? 'finale' : ''}`;
                    // Episode number stays visible next to the (truncated) title
                    const ep = `<em class="calendar-ep">${isFinale(item) ? `${item.episode} Final` : item.episode}</em>`;
                    if (showImages) {
                        return `<div class="calendar-entry-img ${classes}" data-open="${item.media?.id}" role="button" tabindex="0" title="${title} — ${epLabel(item)}" style="cursor:pointer">
                            <img src="${esc(item.media?.coverImage?.large || '')}" alt="" loading="lazy">
                            <span>${title}</span>${ep}
                        </div>`;
                    }
                    return `<div class="calendar-entry ${classes}" data-open="${item.media?.id}" role="button" tabindex="0" title="${title} — ${epLabel(item)}">
                        <span class="calendar-entry-title">${title}</span>${ep}
                    </div>`;
                }).join('')}
                ${entries.length > 8 ? `<button type="button" class="calendar-more" data-week="${day.getTime()}">+${entries.length - 8} more</button>` : ''}
            </div>`;
        }

        const remaining = (7 - ((leading + days.length) % 7)) % 7;
        for (let i = 0; i < remaining; i++) html += '<div class="calendar-cell other-month"></div>';
        return html + '</div>';
    }

    async function reload() {
        try { sessionStorage.setItem(ANCHOR_KEY, String(anchor.getTime())); } catch { /* storage blocked */ }
        const grid = document.getElementById('cal-grid');
        if (grid) grid.style.opacity = '0.5';
        await loadAiring();
        if (grid) grid.style.opacity = '';
        renderCalendar();
    }

    // ‹ › move by a week or a month, whatever is on screen
    const shift = (dir) => {
        anchor = view === 'week' ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
        reload();
    };
    document.getElementById('cal-prev')?.addEventListener('click', () => shift(-1));
    document.getElementById('cal-next')?.addEventListener('click', () => shift(1));
    document.getElementById('cal-today')?.addEventListener('click', () => {
        anchor = view === 'week' ? startOfWeek(new Date()) : new Date(now.getFullYear(), now.getMonth(), 1);
        reload();
    });

    // Switching keeps you where you were: a week opens its month, a month opens today's week
    // if today is in it, otherwise its first week
    function setView(next, around = null) {
        if (next === view && !around) return;
        const { start, end } = range();
        const today = new Date();
        if (next === 'month') {
            const mid = addDays(start, 3);
            anchor = new Date(mid.getFullYear(), mid.getMonth(), 1);
        } else {
            anchor = startOfWeek(around || (today >= start && today <= end ? today : start));
        }
        view = next;
        try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage blocked */ }
        content.querySelectorAll('[data-view]').forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
            b.setAttribute('aria-pressed', String(b.dataset.view === view));
        });
        reload();
    }
    content.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    document.getElementById('cal-grid')?.addEventListener('click', (e) => {
        const more = e.target.closest('.calendar-more');
        if (more) setView('week', new Date(Number(more.dataset.week)));
    });

    content.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.dataset.filter === filter) return;
            content.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filter = btn.dataset.filter;
            // The two filters load different schedules ("My List" is only the listed shows)
            const grid = document.getElementById('cal-grid');
            if (grid) grid.style.opacity = '0.5';
            await loadAiring();
            if (grid) grid.style.opacity = '';
            renderCalendar();
        });
    });

    document.getElementById('cal-ics')?.addEventListener('click', () => downloadIcs(shownEpisodes));

    document.getElementById('cal-img-toggle')?.addEventListener('click', (e) => {
        showImages = !showImages;
        localStorage.setItem('aniroll_cal_images', showImages ? 'on' : 'off');
        e.currentTarget.classList.toggle('on', showImages);
        renderCalendar();
    });

    const gridEl = document.getElementById('cal-grid');
    if (gridEl) gridEl.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div></div>';

    // Lists first: "My List" needs their ids to ask AniList for just those shows
    await loadUserLists();
    await loadAiring();
    renderCalendar();

    if (isLoggedIn() && userMediaMap.size) {
        await loadKitsuFallbacks();
        renderCalendar();
    }
}

// The episodes on screen as an .ics file (no request; a live feed is not possible, the server may not ask
// AniList). Each event links back to the show in AniRoll; estimated dates say so.
function downloadIcs(items) {
    const list = items.filter(a => a.media && a.airingAt);
    if (!list.length) return toast('Nothing in this view to add', 'error');
    const stamp = (sec) => new Date(sec * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const text = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    // Lines longer than 75 octets are folded, as the format asks
    const fold = (line) => line.length <= 74 ? line : line.match(/.{1,74}/g).join('\r\n ');
    const now = stamp(Math.floor(Date.now() / 1000));
    const events = list.map(a => {
        const minutes = a.media.duration || 24;
        const title = `${titlePref(a.media.title)} · Episode ${a.episode}${a._forecast ? ' (estimated)' : ''}`;
        return ['BEGIN:VEVENT',
            `UID:aniroll-${a.media.id}-${a.episode}@aniroll.app`,
            `DTSTAMP:${now}`,
            `DTSTART:${stamp(a.airingAt)}`,
            `DTEND:${stamp(a.airingAt + minutes * 60)}`,
            fold(`SUMMARY:${text(title)}`),
            fold(`URL:${location.origin}/#/anime/${a.media.id}`),
            fold(`DESCRIPTION:${text(`Open in AniRoll: ${location.origin}/#/anime/${a.media.id}`)}`),
            'BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${text(title)}`), 'TRIGGER:PT0M', 'END:VALARM',
            'END:VEVENT'].join('\r\n');
    });
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AniRoll//Airing//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:AniRoll', ...events, 'END:VCALENDAR', ''].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aniroll-airing.ics';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`${list.length} episode${list.length > 1 ? 's' : ''} in the calendar file`, 'success');
}
