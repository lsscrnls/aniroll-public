// Arriving from the old address (old.example.com, see move/move.js): what this browser kept there comes along
// in the fragment. A plain script, so it runs before the modules read the login. Only taken when the old
// address really sent it (a link made up elsewhere can't log anyone in as someone else), and nothing already
// set here is overwritten. The fragment then becomes the page it was meant for.
(() => {
    const m = location.hash.match(/^#carry=([^&]*)&to=(.*)$/);
    if (!m) return;
    const OLD = ['https://old.example.com/', 'https://old2.example.com/'];
    if (OLD.some(o => document.referrer.startsWith(o))) {
        try {
            const data = JSON.parse(decodeURIComponent(m[1]));
            for (const [key, value] of Object.entries(data)) {
                if (/^(aniroll|popularFriends)/.test(key) && typeof value === 'string' && localStorage.getItem(key) === null) {
                    localStorage.setItem(key, value);
                }
            }
        } catch { /* nothing carried */ }
    }
    let route = '';
    try { route = decodeURIComponent(m[2]); } catch { /* the front page */ }
    history.replaceState(null, '', location.pathname + location.search + route);
})();
