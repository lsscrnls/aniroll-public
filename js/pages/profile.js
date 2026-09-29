import * as api from '../api.js?v=117';
import { getState, renderMediaCard, esc, emptyIcon } from '../store.js?v=117';
import { getToken, isLoggedIn } from '../auth.js?v=117';

export async function render({ params, content }) {
    const token = getToken();
    const currentUser = getState().user;
    const username = params.username;

    if (!username && (!isLoggedIn() || !currentUser)) {
        content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon('lock')}</div><div class="empty-state-text">Log in to see your profile</div></div>`;
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
