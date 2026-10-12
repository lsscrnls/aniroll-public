// js/dna.js is not part of the public source: AniRoll's live app ships it (obfuscated).
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// Anime DNA on the profile: a type, quirks and a picture, read from the anime list alone.
//
// Used by: js/pages/profile.js, js/pages/social.js

// `mine`, `theirs`: { lists, features } of two people. Returns { match: 1-99, shared, both: [loved by both],
// clash: [{ media, mine, theirs }], picks: [shows they loved that are not on your list] }, or null.
export function matchDna(mine, theirs) { return null; }

// `lists`: the anime list, `features`: genres, tags, popularity and studios per show, `own`: whether it is
// the viewer's list. Returns { type, streak, quirks, loves, palette, art }, or null when the list has too little to go on.
export function readDna(lists, features, own = true) { return null; }
