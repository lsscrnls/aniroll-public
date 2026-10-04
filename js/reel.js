// js/reel.js is not part of the public source: AniRoll's live app ships it (obfuscated).
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// The slot-machine reel, shared by the Roll page and the Watch Party's "Roll together".
//
// Used by: js/pages/home.js, js/pages/roll.js, js/pages/watchparty.js

// Spins `covers` (image URLs; the last one wins) in `reelEl` inside `windowEl`. Every client given
// the same `startAt` (epoch ms) shows the same spin at the same moment. Calls `onDone` when it stops.
export function playReel({ windowEl, reelEl, covers, startAt = Date.now(), onDone }) { return null; }

// The roll motif as an inline SVG: tab bar, landing page, reel placeholders.
export const ROLL_ICON = '';
