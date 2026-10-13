// @ts-check
import * as api from '../api.js?v=176';
import { getState, renderMediaCard, esc, emptyIcon, loginState, titlePref } from '../store.js?v=176';
import { getToken, isLoggedIn } from '../auth.js?v=176';
import { readDna, matchDna } from '../dna.js?v=176';
import { shareDna } from '../dnashare.js?v=176';
import { knownMatches, keepMatch, matchVerdict } from '../dnamatches.js?v=176';
import { accountState, saveAccountState } from '../accountstate.js?v=176';

export async function render({ params, content }) {
    const token = getToken();
    const currentUser = getState().user;
    const username = params.username;

    if (!username && (!isLoggedIn() || !currentUser)) {
        content.innerHTML = loginState(emptyIcon('lock'), 'Log in to see your profile', 'Your stats, favourite genres and studios, from your AniList.');
        return;
    }

    const name = username || currentUser?.name;
    const user = username ? await api.getUserProfile(name, token) : currentUser;

    if (!user) {
        content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('user')}</div><div class="empty-state-text">User not found</div></div>`;
        return;
    }

    const animeStats = user.statistics?.anime;
    const mangaStats = user.statistics?.manga;
    const watchDays = animeStats ? Math.floor(animeStats.minutesWatched / 60 / 24) : 0;
    const watchHours = animeStats ? Math.floor((animeStats.minutesWatched / 60) % 24) : 0;

    const favourites = user.favourites;
    const own = currentUser?.name === user.name;

    content.innerHTML = `<div class="page-enter">
        <div class="profile-header">
            ${user.bannerImage ? `<div class="profile-banner"><img src="${user.bannerImage}" alt=""></div>`
                // No banner on AniList: the avatar, blurred wide, instead of an empty grey block
                : `<div class="profile-banner is-avatar">${user.avatar?.large ? `<img src="${esc(user.avatar.large)}" alt="">` : ''}</div>`}
            <div class="profile-info">
                <img class="profile-avatar" src="${user.avatar?.large || user.avatar?.medium || ''}" alt="${esc(user.name)}">
                <div>
                    <h1 class="profile-name">${esc(user.name)}</h1>
                    <div class="profile-stats-row">
                        ${animeStats ? `
                            <div class="profile-stat"><div class="profile-stat-num">${animeStats.count}</div><div class="profile-stat-label">Anime</div></div>
                            <div class="profile-stat"><div class="profile-stat-num">${animeStats.episodesWatched}</div><div class="profile-stat-label">Episodes</div></div>
                            <div class="profile-stat"><div class="profile-stat-num">${watchDays}d ${watchHours}h</div><div class="profile-stat-label">Watch Time</div></div>
                            <div class="profile-stat"><div class="profile-stat-num">${animeStats.meanScore}</div><div class="profile-stat-label">Avg Score</div></div>
                        ` : ''}
                        ${mangaStats ? `
                            <div class="profile-stat"><div class="profile-stat-num">${mangaStats.count}</div><div class="profile-stat-label">Manga</div></div>
                            <div class="profile-stat"><div class="profile-stat-num">${mangaStats.chaptersRead}</div><div class="profile-stat-label">Chapters</div></div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>

        <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-xl);flex-wrap:wrap">
            <a href="#/list/${esc(user.name)}" class="glass-btn glass-btn-secondary">View List</a>
            <a href="${esc(user.siteUrl || `https://anilist.co/user/${user.name}`)}" target="_blank" rel="noopener" class="glass-btn glass-btn-secondary">AniList Profile</a>
        </div>

        <div id="dna"></div>

        ${!animeStats?.count && !mangaStats?.count ? `<div class="empty-state">
            <div class="empty-state-text">${own ? 'Your list is empty' : `${esc(user.name)}'s list is empty`}</div>
            <div class="empty-state-sub">${own ? 'Stats, favourite genres and studios show up here once you add shows.' : 'Stats show up here once there is something on it.'}</div>
            ${own ? '<a href="#/roll" class="glass-btn glass-btn-primary" style="margin-top:var(--space-md)">Roll something</a>' : ''}
        </div>` : ''}
        ${animeStats ? renderAnimeStats(animeStats) : ''}
        <div id="hot-takes"></div>
        ${mangaStats ? renderMangaStats(mangaStats) : ''}

        ${favourites?.anime?.nodes?.length ? `
            <div style="margin-top:var(--space-xl)">
                <h3 class="section-title" style="margin-bottom:var(--space-md)">Favorite Anime</h3>
                <div class="scroll-row">${favourites.anime.nodes.map(m => `<div style="flex:0 0 120px">${renderMediaCard(m)}</div>`).join('')}</div>
            </div>` : ''}

        ${favourites?.manga?.nodes?.length ? `
            <div style="margin-top:var(--space-xl)">
                <h3 class="section-title" style="margin-bottom:var(--space-md)">Favorite Manga</h3>
                <div class="scroll-row">${favourites.manga.nodes.map(m => `<div style="flex:0 0 120px">${renderMediaCard(m)}</div>`).join('')}</div>
            </div>` : ''}

        ${favourites?.characters?.nodes?.length ? `
            <div style="margin-top:var(--space-xl)">
                <h3 class="section-title" style="margin-bottom:var(--space-md)">Favorite Characters</h3>
                <div class="char-grid">
                    ${favourites.characters.nodes.map(c => `
                        <div class="char-card">
                            <img class="char-img" src="${c.image?.medium || ''}" alt="${esc(c.name?.full)}" loading="lazy">
                            <div class="char-info"><div class="char-name">${esc(c.name?.full)}</div></div>
                        </div>`).join('')}
                </div>
            </div>` : ''}
    </div>`;

    // Where this person and everyone else disagree most, from the list (usually read already)
    const lists = api.getMediaList(user.id, 'ANIME', token);
    lists.then(lists => {
        const box = content.querySelector('#hot-takes');
        if (box) box.innerHTML = renderHotTakes(lists, own);
    }).catch(() => { /* no section */ });

    // Anime DNA (js/dna.js): from the same list, plus the genres and tags the taste match reads anyway
    Promise.all([lists, api.getListFeatures(user.id, token)]).then(async ([lists, features]) => {
        const box = content.querySelector('#dna');
        const dna = box && readDna(lists, features, own);
        if (!dna) return;
        if (own) {
            const kept = await noteDna(dna);
            box.innerHTML = renderDna(dna, own, kept.before) + renderTimeline(kept.months) + renderTwins(user.id);
            const share = box.querySelector('#dna-share');
            share?.addEventListener('click', async () => {
                share.disabled = true;
                try { await shareDna({ name: user.name, dna }); } finally { share.disabled = false; }
            });
            return;
        }
        box.innerHTML = renderDna(dna, own, null);
        if (!currentUser || !isLoggedIn()) {
            // Someone who came from a shared card: their own DNA and the match are one login away
            box.insertAdjacentHTML('beforeend', `<section class="dna-match dna-match-login">
                <div class="dna-match-body"><div class="dna-kicker">Taste match</div>
                <h3 class="dna-match-title">How well do you match ${esc(user.name)}?</h3>
                <p class="dna-why">Log in with AniList to see your own Anime DNA and what you share.</p>
                <button class="glass-btn glass-btn-primary" data-login>Log in with AniList</button></div>
            </section>`);
            return;
        }
        const [myLists, myFeatures] = await Promise.all([api.getMediaList(currentUser.id, 'ANIME', token), api.getListFeatures(currentUser.id, token)]);
        const match = matchDna({ lists: myLists, features: myFeatures }, { lists, features });
        if (!match || !box.isConnected) return;
        keepMatch(user.id, user.name, match.match);
        box.insertAdjacentHTML('beforeend', renderMatch(match, user));
    }).catch(() => { /* no section */ });
}

// The own type, kept with the account: a change is pointed out once, and one snapshot a month is kept
// for the timeline (type and the five strongest loves; the newest 24 months)
async function noteDna(dna) {
    const kept = (await accountState()).dna;
    const month = new Date().toISOString().slice(0, 7);
    const months = Array.isArray(kept?.months) ? kept.months.filter(x => x.m !== month) : [];
    months.push({ m: month, type: dna.type.name, loves: dna.loves.slice(0, 5).map(l => l.name) });
    const next = { type: dna.type.name, since: kept?.type === dna.type.name ? kept.since : Date.now(), months: months.slice(-24) };
    if (JSON.stringify(next) !== JSON.stringify(kept)) saveAccountState('dna', next);
    // Changed since the last visit (a first visit has nothing to compare with)
    return { before: kept?.type && kept.type !== dna.type.name ? kept.type : null, months: next.months };
}

function renderDna(dna, own, before) {
    return `<section class="dna">
        <div class="dna-visual">${dna.art}</div>
        <div class="dna-body">
            <div class="dna-kicker">Anime DNA</div>
            ${before ? `<div class="dna-changed">New since last time · before: ${esc(before)}</div>` : ''}
            <h2 class="dna-type">${esc(dna.type.name)}</h2>
            ${dna.streak ? `<div class="dna-streak">with a streak of ${esc(dna.streak)}</div>` : ''}
            <p class="dna-line">${esc(dna.type.line)}</p>
            <p class="dna-why">${esc(dna.type.why)}</p>
            ${dna.loves.length ? `<div class="dna-loves">${dna.loves.slice(0, 6).map(l => `<span class="dna-love">${esc(l.name)}</span>`).join('')}</div>` : ''}
            ${dna.quirks.length ? `<ul class="dna-quirks">${dna.quirks.map(q => `<li>${q}</li>`).join('')}</ul>` : ''}
            ${own ? '<button class="glass-btn glass-btn-secondary dna-share" id="dna-share">Share your DNA</button>' : ''}
        </div>
    </section>`;
}

const monthName = (m) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric' });

// How the type moved, month by month (from the snapshots noteDna keeps); nothing until there are two
function renderTimeline(months) {
    if (!months || months.length < 2) return '';
    return `<section class="dna-timeline">
        <h3 class="section-title">Your DNA over time</h3>
        <ol>${[...months].reverse().map((x, i, all) => `<li class="${all[i + 1] && all[i + 1].type !== x.type ? 'is-change' : ''}">
            <span class="dna-tl-month">${esc(monthName(x.m))}</span>
            <span class="dna-tl-type">${esc(x.type)}</span>
            <span class="dna-tl-loves">${esc((x.loves || []).slice(0, 3).join(' · '))}</span>
        </li>`).join('')}</ol>
    </section>`;
}

// The people whose taste is closest, from matches already worked out on their profiles or in Social
function renderTwins(ownId) {
    const known = Object.entries(knownMatches()).filter(([id]) => id !== String(ownId))
        .sort((a, b) => b[1].match - a[1].match).slice(0, 5);
    if (!known.length) return '';
    return `<section class="dna-twins">
        <h3 class="section-title">Closest tastes</h3>
        <div class="dna-twin-row">${known.map(([, m]) => `<a class="dna-twin" href="#/user/${encodeURIComponent(m.name)}">
            <span class="dna-twin-num">${m.match}%</span><span class="dna-twin-name">${esc(m.name)}</span></a>`).join('')}</div>
    </section>`;
}

function renderMatch(m, user) {
    const name = esc(user.name);
    return `<section class="dna-match">
        <div class="dna-match-num" style="--p:${m.match}"><span>${m.match}%</span></div>
        <div class="dna-match-body">
            <div class="dna-kicker">Taste match</div>
            <h3 class="dna-match-title">You and ${name}: ${esc(matchVerdict(m.match))}</h3>
            <p class="dna-why">${m.shared ? `${m.shared} show${m.shared === 1 ? '' : 's'} you have both seen.` : 'No show you have both seen yet.'}</p>
            ${m.both.length ? `<div class="dna-loves"><span class="dna-match-label">You both love</span>${m.both.map(b => `<span class="dna-love">${esc(b)}</span>`).join('')}</div>` : ''}
            ${m.clash.length ? `<div class="dna-match-label">Where you part ways</div>${m.clash.map(c => `<div class="hot-take" data-open="${c.media.id}" role="button" tabindex="0">
                <img src="${esc(c.media.coverImage?.large || '')}" alt="" loading="lazy">
                <div class="hot-take-text"><div class="hot-take-title">${esc(titlePref(c.media.title))}</div>
                <div class="hot-take-meta">You ${Math.round(c.mine)} · ${name} ${Math.round(c.theirs)}</div></div>
            </div>`).join('')}` : ''}
            ${m.picks.length ? `<div class="dna-match-label">${name} loved, not on your list</div>
                <div class="dna-picks">${m.picks.map(p => `<img src="${esc(p.coverImage?.large || '')}" alt="${esc(titlePref(p.title))}" title="${esc(titlePref(p.title))}" data-open="${p.id}" role="button" tabindex="0" loading="lazy">`).join('')}</div>` : ''}
        </div>
    </section>`;
}

// The biggest gaps between a score and AniList's average: loved what most found fine, and the other way
function renderHotTakes(lists, own) {
    const seen = new Set();
    const rated = lists.flatMap(l => l.entries)
        .filter(e => e.score > 0 && e.media.meanScore && !seen.has(e.id) && seen.add(e.id))
        .map(e => ({ e, diff: Math.round(e.score - e.media.meanScore) }));
    const loved = rated.filter(x => x.diff >= 10).sort((a, b) => b.diff - a.diff).slice(0, 4);
    const cooler = rated.filter(x => x.diff <= -10).sort((a, b) => a.diff - b.diff).slice(0, 4);
    if (!loved.length && !cooler.length) return '';
    const row = ({ e, diff }) => `<div class="hot-take" data-open="${e.media.id}" role="button" tabindex="0">
        <img src="${esc(e.media.coverImage?.large || '')}" alt="" loading="lazy">
        <div class="hot-take-text">
            <div class="hot-take-title">${esc(titlePref(e.media.title))}</div>
            <div class="hot-take-meta">${own ? 'You' : 'Them'} ${Math.round(e.score)} · AniList ${e.media.meanScore}</div>
        </div>
        <span class="hot-take-diff ${diff > 0 ? 'pos' : 'neg'}">${diff > 0 ? '+' : '−'}${Math.abs(diff)}</span>
    </div>`;
    return `<div style="margin-top:var(--space-xl)">
        <h3 class="section-title" style="margin-bottom:var(--space-md)">Hot takes</h3>
        <div class="stats-grid">
            ${loved.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)"><div class="stat-chart-title">Liked more than most</div>${loved.map(row).join('')}</div>` : ''}
            ${cooler.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)"><div class="stat-chart-title">Liked less than most</div>${cooler.map(row).join('')}</div>` : ''}
        </div>
    </div>`;
}

// One bar chart box; rows: [{ label, value, count, note }] (note: the line under the bar's number)
function barChart(title, rows) {
    if (!rows.length) return '';
    const max = Math.max(...rows.map(r => r.count), 1);
    return `<div class="box stat-chart" style="background:var(--bg-secondary)">
        <div class="stat-chart-title">${esc(title)}</div>
        <div class="stat-bar-chart">
            ${rows.map(r => `<div class="stat-bar-row"${r.note ? ` title="${esc(r.note)}"` : ''}>
                <span class="stat-bar-label">${esc(r.label)}</span>
                <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(r.count / max * 100)}%"></div></div>
                <span class="stat-bar-value">${esc(String(r.value ?? r.count))}</span>
            </div>`).join('')}
        </div>
    </div>`;
}

function renderAnimeStats(stats) {
    const genreMax = Math.max(...(stats.genres || []).map(g => g.count), 1);
    const scoreMax = Math.max(...(stats.scores || []).map(s => s.count), 1);
    const formatMax = Math.max(...(stats.formats || []).map(f => f.count), 1);

    return `<div style="margin-top:var(--space-xl)">
        <h3 class="section-title" style="margin-bottom:var(--space-md)">Anime Stats</h3>
        <div class="stats-grid">
            ${stats.genres?.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)">
                <div class="stat-chart-title">Top Genres</div>
                <div class="stat-bar-chart">
                    ${stats.genres.slice(0, 8).map(g => `<div class="stat-bar-row">
                        <span class="stat-bar-label">${esc(g.genre)}</span>
                        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(g.count / genreMax * 100)}%"></div></div>
                        <span class="stat-bar-value">${g.count}</span>
                    </div>`).join('')}
                </div>
            </div>` : ''}
            ${stats.scores?.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)">
                <div class="stat-chart-title">Score Distribution</div>
                <div class="stat-bar-chart">
                    ${stats.scores.filter(s => s.count > 0).map(s => `<div class="stat-bar-row">
                        <span class="stat-bar-label">${s.score}</span>
                        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.count / scoreMax * 100)}%"></div></div>
                        <span class="stat-bar-value">${s.count}</span>
                    </div>`).join('')}
                </div>
            </div>` : ''}
            ${stats.formats?.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)">
                <div class="stat-chart-title">Formats</div>
                <div class="stat-bar-chart">
                    ${stats.formats.map(f => `<div class="stat-bar-row">
                        <span class="stat-bar-label">${esc(api.formatFormat(f.format))}</span>
                        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(f.count / formatMax * 100)}%"></div></div>
                        <span class="stat-bar-value">${f.count}</span>
                    </div>`).join('')}
                </div>
            </div>` : ''}
            ${barChart('Top tags', (stats.tags || []).slice(0, 8).map(t => ({ label: t.tag?.name || '', count: t.count, note: t.meanScore ? `Your average ${Math.round(t.meanScore)}` : '' })))}
            ${barChart('Your average per genre', (stats.genres || []).filter(g => g.meanScore).slice(0, 8)
                .sort((a, b) => b.meanScore - a.meanScore).map(g => ({ label: g.genre, count: g.meanScore, value: Math.round(g.meanScore), note: `${g.count} shows` })))}
            ${barChart('Your era (release year)', (stats.releaseYears || []).slice().sort((a, b) => b.releaseYear - a.releaseYear).slice(0, 10)
                .map(y => ({ label: String(y.releaseYear), count: y.count })))}
            ${barChart('Started watching', (stats.startYears || []).slice().sort((a, b) => b.startYear - a.startYear).slice(0, 10)
                .map(y => ({ label: String(y.startYear), count: y.count })))}
            ${stats.studios?.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)">
                <div class="stat-chart-title">Top Studios</div>
                <div class="stat-bar-chart">
                    ${stats.studios.slice(0, 8).map(s => `<div class="stat-bar-row">
                        <span class="stat-bar-label" style="width:100px">${esc(s.studio?.name)}</span>
                        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.count / stats.studios[0].count * 100)}%"></div></div>
                        <span class="stat-bar-value">${s.count}</span>
                    </div>`).join('')}
                </div>
            </div>` : ''}
        </div>
    </div>`;
}

function renderMangaStats(stats) {
    if (!stats.count) return '';
    const genreMax = Math.max(...(stats.genres || []).map(g => g.count), 1);

    return `<div style="margin-top:var(--space-xl)">
        <h3 class="section-title" style="margin-bottom:var(--space-md)">Manga Stats</h3>
        <div class="stats-grid">
            <div class="box stat-chart" style="background:var(--bg-secondary)">
                <div class="stat-chart-title">Overview</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md)">
                    <div style="text-align:center"><div style="font-size:1.5rem;font-weight:700">${stats.count}</div><div style="font-size:0.75rem;color:var(--text-secondary)">Manga</div></div>
                    <div style="text-align:center"><div style="font-size:1.5rem;font-weight:700">${stats.chaptersRead}</div><div style="font-size:0.75rem;color:var(--text-secondary)">Chapters</div></div>
                    <div style="text-align:center"><div style="font-size:1.5rem;font-weight:700">${stats.volumesRead}</div><div style="font-size:0.75rem;color:var(--text-secondary)">Volumes</div></div>
                    <div style="text-align:center"><div style="font-size:1.5rem;font-weight:700">${stats.meanScore}</div><div style="font-size:0.75rem;color:var(--text-secondary)">Avg Score</div></div>
                </div>
            </div>
            ${stats.genres?.length ? `<div class="box stat-chart" style="background:var(--bg-secondary)">
                <div class="stat-chart-title">Top Genres</div>
                <div class="stat-bar-chart">
                    ${stats.genres.slice(0, 8).map(g => `<div class="stat-bar-row">
                        <span class="stat-bar-label">${esc(g.genre)}</span>
                        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(g.count / genreMax * 100)}%"></div></div>
                        <span class="stat-bar-value">${g.count}</span>
                    </div>`).join('')}
                </div>
            </div>` : ''}
        </div>
    </div>`;
}
