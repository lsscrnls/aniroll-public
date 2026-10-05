import * as api from '../api.js?v=142';
import { getState, renderMediaCard, esc, emptyIcon, loginState, titlePref } from '../store.js?v=142';
import { getToken, isLoggedIn } from '../auth.js?v=142';

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

    content.innerHTML = `<div class="page-enter">
        <div class="profile-header">
            ${user.bannerImage ? `<div class="profile-banner"><img src="${user.bannerImage}" alt=""></div>` : '<div class="profile-banner" style="height:150px;background:var(--bg-secondary)"></div>'}
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
    api.getMediaList(user.id, 'ANIME', token).then(lists => {
        const box = content.querySelector('#hot-takes');
        if (box) box.innerHTML = renderHotTakes(lists, user.name === currentUser?.name);
    }).catch(() => { /* no section */ });
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
