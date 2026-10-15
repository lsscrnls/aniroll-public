// api/sources.js is not part of the public source: it runs on AniRoll's own server.
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// The server side of js/sources.js, for the owner of this instance only. api/server.js calls
// createSources(helpers) and gets back handle(req, res, pathname) for /api/sources/*.
// This stub answers nothing, so those paths are a 404.

module.exports = function createSources({ json }) {
    return { handle: async (req, res) => json(res, 404, { error: 'Not found' }) };
};
