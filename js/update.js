// A new AniRoll while this tab is open: scripts/deploy.sh writes version.json with the build's fingerprint,
// and this tab knows its own from the address it loaded app.js from (?h=…). When they differ, a note offers
// a reload. Asked when the tab comes back to the front and every 15 minutes while it is shown; never on
// localhost, where nothing is fingerprinted.
import { toast } from './store.js';

const EVERY = 15 * 60 * 1000;
const AGAIN_AFTER = 5 * 60 * 1000;

export function watchForUpdate(build) {
    if (!build) return;
    let last = Date.now();
    let told = false;
    async function check() {
        if (told || document.hidden) return;
        last = Date.now();
        try {
            const res = await fetch('/version.json', { cache: 'no-store' });
            const live = res.ok ? (await res.json()).build : null;
            if (!live || live === build || told) return;
            told = true;
            toast('A new version of AniRoll is out', 'info', { action: { label: 'Reload', run: () => location.reload() }, stay: true });
        } catch { /* offline: next time */ }
    }
    setInterval(check, EVERY);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > AGAIN_AFTER) check(); });
}
