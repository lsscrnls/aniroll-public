// @ts-check
import { esc } from '../store.js?v=161';
import { getConfig } from '../jellyfin.js?v=161';
import { availability } from './availability.js?v=161';
import { findEpisode } from './library.js?v=161';

const ICON_EPISODES = '<svg data-icon="list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg data-icon="play_arrow" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:18px;height:18px;vertical-align:-4px;margin-right:6px"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

// "Play episode N" from the user's own Jellyfin, and "Episodes" for any other one (a rewatch, one
// skipped). Fills `slot` only when the server answers and has that episode: nothing waits for it and
// nothing shows when Jellyfin is off. `prefix` names the classes (detail-play, wp-play, …);
// `isCurrent` says no once a newer call wants another episode; `episodes: false` leaves out the list
// button, `size` adds a class to both. Resolves true when the button is shown.
export async function mountPlayButton(slot, media, episode, { prefix = 'detail', isCurrent = () => true, episodes = true, size = '' } = {}) {
    if (!slot || media.type !== 'ANIME' || !(episode > 0) || !getConfig()) return false;
    try {
        const avail = await availability();
        if (!avail) return false;
        const found = await findEpisode(avail.base, media, episode);
        if (!found || !slot.isConnected || !isCurrent()) return false;
        const resume = found.positionTicks > 0 && !found.played;
        const movie = media.format === 'MOVIE';
        const label = movie ? (resume ? 'Resume' : 'Play') : `${resume ? 'Resume' : 'Play'} episode ${episode}`;
        slot.innerHTML = `<a class="glass-btn glass-btn-primary ${size} ${prefix}-play" href="#/play/${media.id}/${episode}">${ICON_PLAY}${esc(label)}</a>`
            + (movie || !episodes ? '' : `<button class="glass-btn glass-btn-secondary ${size} ${prefix}-episodes" type="button">${ICON_EPISODES}Episodes</button>`);
        slot.querySelector(`.${prefix}-episodes`)?.addEventListener('click', async () => {
            const { openEpisodes } = await import('./episodes.js?v=161');
            openEpisodes(media, avail.base);
        });
        slot.hidden = false;
        return true;
    } catch (err) {
        console.warn('Jellyfin player unavailable:', err.message);
        return false;
    }
}

// Home's "Up next" hero: Play next to "Watched episode N", which then steps back to a secondary button
export async function mountHeroPlay(root, media, episode, size = '') {
    const slot = root?.querySelector('[data-hero-play]');
    if (!slot) return;
    const shown = await mountPlayButton(slot, media, episode, { prefix: 'hero', episodes: false, size });
    if (!shown) return;
    const watched = slot.parentElement?.querySelector('[data-hero-inc], [data-ar-inc]');
    watched?.classList.replace('glass-btn-primary', 'glass-btn-secondary');
}
