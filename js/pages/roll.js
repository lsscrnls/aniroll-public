// js/pages/roll.js is not part of the public source: AniRoll's live app ships it (obfuscated).
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// The Roll page (#/roll): picks tonight's show from your Planning list, optionally with recommended
// titles that are not on your list yet, and plays the reel (js/reel.js) to reveal it.
//
// Used by: js/app.js

// Draws the page into `content`, like every page (see js/router.js).
export async function render({ content }) {
    content.innerHTML = '<div class="page-enter"><p class="empty-state">This part of AniRoll is not in the public source. Try it on aniroll.app.</p></div>';
}
