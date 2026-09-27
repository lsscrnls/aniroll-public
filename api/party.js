// api/party.js is not part of the public source: it runs on AniRoll's own server.
// This stub keeps its exports and their signatures, so the rest of the app loads and runs without it.
// What it is for, and what each export promises, is described below; how it works is the part left out.

// The server side of the Watch Party. api/server.js calls createParty(helpers) with its own helpers
// (JSON answers, body parsing, token checks, moving a list forward) and gets back:
//   route(req, res, pathname)  answers /api/party/* and /api/parties/*; true when it did
//   syncMembers()              moves guests who opted in along with the host, once a minute
// This stub answers nothing, so those paths are a 404 and the server runs without parties.

module.exports = function createParty() {
    return { route: async () => false, syncMembers: async () => {} };
};
