// js/taste.js is not part of the public source: AniRoll's live app ships it (obfuscated).
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// Taste match: how well a show fits what you liked, from the genres and tags of your own list.
// It measures "your kind of show", never the global rating.
//
// Used by: js/api.js, js/pages/detail.js

// `entries`: list entries with a score (0-100), a status and the show's genres and tags.
// Returns a profile, or null when the list has too little to go on.
export function buildTasteProfile(entries) { return null; }

// Returns { match: 1-99, fits: [genres and tags that speak for it], misses: [...] },
// or null without a profile.
export function tasteMatch(profile, media) { return null; }
