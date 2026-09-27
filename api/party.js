// api/party.js is not part of the public source. it runs on AniRoll's own server;
// this stub only keeps the same exports, so the rest of the app loads and runs without it.
module.exports = function createParty() {
    return { route: async () => false, syncMembers: async () => {} };
};
