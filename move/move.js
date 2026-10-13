// AniRoll moved from old.example.com to aniroll.app. The old address only answers with this page: it takes what
// this browser kept there (the AniList login, Jellyfin, settings) along in the link's fragment, which never
// reaches a server, and js/carry.js on the new address puts it back. Caches stay behind, they refill by themselves.
(() => {
    const NEW = 'https://aniroll.app/';
    const SKIP = /^aniroll_(cache|jf_match3|req_times)|^aniroll-request-budget/;
    const data = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !/^(aniroll|popularFriends)/.test(key) || SKIP.test(key)) continue;
            const value = localStorage.getItem(key);
            if (value != null && value.length < 50000) data[key] = value;
        }
    } catch { /* storage blocked: nothing to take along */ }
    // Only an app route (or AniList's login answer) goes along: a fragment of any other shape (one carrying
    // data itself) is dropped, or a link to this page could hand the new address someone else's data as if
    // it came from here
    const route = /^#(\/|access_token=)[^#]*$/.test(location.hash) ? location.hash : '';
    const target = Object.keys(data).length
        ? `${NEW}${location.search}#carry=${encodeURIComponent(JSON.stringify(data))}&to=${encodeURIComponent(route)}`
        : NEW + location.search + route;
    location.replace(target);
})();
