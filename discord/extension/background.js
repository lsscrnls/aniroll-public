// Passes what an AniRoll tab is doing to the helper on this computer (native messaging host
// app.aniroll.discord, see discord/helper), which hands it to Discord. With several AniRoll tabs the one
// that changed last wins; a tab that closes takes its status along.
const ext = globalThis.browser ?? globalThis.chrome;
const HOST = 'app.aniroll.discord';
const VERSION = ext.runtime.getManifest().version;

const pages = new Map(); // port -> { activity, at }
let helper = null;       // the native port while the helper runs
let helperUp = false;    // it answered
let discordUp = false;
let triedAt = 0;

function status() {
    return { type: 'status', extension: VERSION, helper: helperUp, discord: discordUp };
}

function tellPages() {
    for (const port of pages.keys()) port.postMessage(status());
}

function startHelper() {
    if (helper) return helper;
    // A missing helper fails right away; not again on every update
    if (Date.now() - triedAt < 10_000) return null;
    triedAt = Date.now();
    try {
        helper = ext.runtime.connectNative(HOST);
    } catch {
        helper = null;
        return null;
    }
    helper.onMessage.addListener((msg) => {
        if (msg?.type !== 'status') return;
        helperUp = true;
        discordUp = !!msg.discord;
        tellPages();
    });
    helper.onDisconnect.addListener(() => {
        helper = null;
        helperUp = false;
        discordUp = false;
        tellPages();
    });
    helper.postMessage({ type: 'hello' });
    // A new helper has not heard anything yet
    queueMicrotask(push);
    return helper;
}

// The newest activity of all open AniRoll tabs; none left clears the status
function push() {
    // No AniRoll tab left: the helper goes, and with it the status in Discord
    if (!pages.size) {
        helper?.disconnect();
        helper = null;
        helperUp = false;
        discordUp = false;
        return;
    }
    let best = null;
    for (const p of pages.values()) if (p.activity && (!best || p.at > best.at)) best = p;
    const port = startHelper();
    port?.postMessage({ type: 'activity', activity: best ? best.activity : null });
}

ext.runtime.onConnect.addListener((port) => {
    if (port.name !== 'aniroll') return;
    pages.set(port, { activity: null, at: 0 });
    port.onMessage.addListener((msg) => {
        if (msg?.type === 'hello') {
            // Asked from Settings: try the helper again at once, it may just have been installed
            triedAt = 0;
            startHelper();
            port.postMessage(status());
        } else if (msg?.type === 'activity') {
            pages.set(port, { activity: msg.activity && typeof msg.activity === 'object' ? msg.activity : null, at: Date.now() });
            push();
        }
    });
    port.onDisconnect.addListener(() => {
        pages.delete(port);
        push();
    });
    port.postMessage(status());
});
