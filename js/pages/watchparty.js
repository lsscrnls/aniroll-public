// js/pages/watchparty.js is not part of the public source: AniRoll's live app ships it (obfuscated).
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// Watch Party: the host counts episodes on their AniList, guests follow along and their lists move
// with them. The server side is api/party.js, reached through /api/party/*.
//
// Used by: js/app.js, js/pages/detail.js, js/pages/home.js, js/pages/roll.js

// The party this browser hosts, or null.
export function getActiveParty() { return null; }

// The invite link to a host's party; it keeps working when the host switches shows.
export function createPartyLink(mediaId, hostName) { return null; }

// Starts a party as its host. With `handOver`, the members of the previous party follow.
export async function startParty(mediaId, mediaTitle, hostName, startEp, coverImage, { handOver = false } = {}) { return null; }

// Moves the running party to another show; members and the invite link stay.
export async function switchPartyTo(target, fromProgress) { return null; }

// A dialog to pick a show from the host's list; calls `onPick` with the choice.
export function openPartyPicker({ title, sub, excludeId = null, includePlanning = false, onPick }) { return null; }

// Ends the party this browser hosts.
export async function endParty() { return null; }

// Gives a host their running party back on another device.
export async function restoreHostParty() { return null; }

// The party this browser follows as a guest, or null.
export function getJoinedParty() { return null; }

// Stops following it.
export function leaveJoinedParty() { return null; }

// Starts following the host in the background; js/app.js calls it once on start.
export function initGuestSync() { return null; }

// Catches up with the host right away.
export async function syncGuestNow() { return null; }

// The small indicator shown on every page while a party runs.
export function renderPartyPill() { return null; }

// The Watch Party page (#/watchparty), drawn into `content` (see js/router.js).
export async function render({ query: q, content }) {
    content.innerHTML = '<div class="page-enter"><p class="empty-state">This part of AniRoll is not in the public source. Try it on aniroll.hxlx.de.</p></div>';
}

// The text of the AniList post that sums up a party: its shows and who watched.
export function buildPartyPost({ shows, members = [] }) { return null; }
