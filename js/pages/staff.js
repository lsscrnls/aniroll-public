// @ts-check
// A voice actor's page (#/staff/<id>): photo, a few facts and every anime they voice, most popular
// first, each with the character they play. Reached from the characters on a detail page.
import * as api from '../api.js?v=145';
import { renderMediaCard, esc, emptyIcon, historyLine } from '../store.js?v=145';
import { getToken, isLoggedIn } from '../auth.js?v=145';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fuzzyDate = d => d?.year ? [d.day, d.month ? MONTHS[d.month - 1] : null, d.year].filter(Boolean).join(' ') : null;

export async function render({ params, content }) {
    const token = getToken();
    const id = parseInt(params.id);
    content.innerHTML = `<div class="page-enter studio-page">
        <div class="staff-head" id="staff-head"><div class="staff-photo skeleton"></div><div><div class="studio-kicker roll-result-kicker">Voice actor</div><h1 class="section-title studio-title">&nbsp;</h1></div></div>
        <p class="studio-history" id="history-line" hidden></p>
        <div id="staff-grid" class="media-grid media-grid-lg">${Array(12).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>
        <div class="studio-more" id="staff-more" hidden><button class="glass-btn glass-btn-secondary" id="staff-more-btn">Show more</button></div>
    </div>`;
    const grid = content.querySelector('#staff-grid');
    const more = content.querySelector('#staff-more');
    let page = 1;
    const loaded = [];

    async function load() {
        try {
            const staff = await api.getStaff(id, page, token);
            if (!staff) throw new Error('Voice actor not found');
            if (page === 1) {
                const facts = [
                    fuzzyDate(staff.dateOfBirth) && `Born ${fuzzyDate(staff.dateOfBirth)}`,
                    fuzzyDate(staff.dateOfDeath) && `Died ${fuzzyDate(staff.dateOfDeath)}`,
                    staff.homeTown,
                ].filter(Boolean);
                content.querySelector('#staff-head').innerHTML = `
                    <img class="staff-photo" src="${esc(staff.image?.large || '')}" alt="">
                    <div>
                        <div class="studio-kicker roll-result-kicker">${esc(staff.primaryOccupations?.[0] || 'Voice actor')}</div>
                        <h1 class="section-title studio-title">${esc(staff.name.full)}</h1>
                        ${staff.name.native ? `<div class="staff-native">${esc(staff.name.native)}</div>` : ''}
                        <div class="staff-facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>
                    </div>`;
                document.title = `${staff.name.full} · AniRoll`;
                grid.innerHTML = '';
            }
            // Anime only: the same list also names the manga a character first appeared in
            const edges = staff.characterMedia.edges.filter(e => e.node?.type === 'ANIME');
            grid.insertAdjacentHTML('beforeend', edges.map(e => {
                const who = (e.characters || []).map(c => c?.name?.full).filter(Boolean).join(', ');
                return renderMediaCard(e.node, true, null, who ? `as ${who}` : null);
            }).join(''));
            if (page === 1 && !edges.length) grid.innerHTML = `<div class="empty-state">${emptyIcon('tv')}<p>No anime roles listed yet.</p></div>`;
            loaded.push(...edges.map(e => e.node));
            const line = isLoggedIn() ? historyLine(loaded) : '';
            const lineEl = content.querySelector('#history-line');
            lineEl.hidden = !line;
            lineEl.textContent = line;
            more.hidden = !staff.characterMedia.pageInfo.hasNextPage;
        } catch (err) {
            grid.innerHTML = `<div class="empty-state">${emptyIcon('alert')}<p>${esc(err.message)}</p></div>`;
            more.hidden = true;
        }
    }
    content.querySelector('#staff-more-btn').addEventListener('click', () => { page++; load(); });
    await load();
}
