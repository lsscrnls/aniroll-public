// Runs on AniRoll's pages. The page says what you are doing (js/presence.js, window messages tagged
// 'presence'); this passes it to the extension's background, and the background's answer (is the helper
// there, is Discord running) back to the page, for Settings → Discord.
const ext = globalThis.browser ?? globalThis.chrome;
let port = null;
let last = null; // the page's latest activity, sent again when the background comes back

function connect() {
    port = ext.runtime.connect({ name: 'aniroll' });
    port.onMessage.addListener((msg) => window.postMessage({ aniroll: 'presence-ext', ...msg }, location.origin));
    // The background went to sleep or was updated: come back, and say again what is going on
    port.onDisconnect.addListener(() => {
        port = null;
        setTimeout(() => { connect(); if (last) port.postMessage(last); }, 1000);
    });
}
connect();

window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const msg = ev.data;
    if (!msg || msg.aniroll !== 'presence' || (msg.type !== 'hello' && msg.type !== 'activity')) return;
    const clean = msg.type === 'activity' ? { type: 'activity', activity: msg.activity ?? null } : { type: 'hello' };
    if (clean.type === 'activity') last = clean;
    port?.postMessage(clean);
});
