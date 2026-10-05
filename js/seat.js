import { getToken, isLoggedIn } from './auth.js?v=144';
import { esc } from './store.js?v=144';

// A seat in AniRoll: at most 100 people use the app at once (api/server.js, "Seats"). Only a logged-in
// app takes one; the landing page stays open to everyone. The seat is kept with a heartbeat while the
// tab is visible (and for a while after it goes to the background), and given back on logout (auth.js).
// When the house is full, a waiting page shows the place in line and lets the person in by itself.
// Anything but a clear "no seat" lets people in: without the backend, AniRoll works as it always did.
const HEARTBEAT_MS = 30_000;
const WAIT_POLL_MS = 15_000;
// A tab in the background holds its seat this long, then lets it go for someone else
const HIDDEN_HOLD_MS = 10 * 60_000;

let hiddenSince = document.hidden ? Date.now() : 0;
let waiting = null; // the waiting page's promise, while it shows
let started = false;

async function ask() {
    const token = getToken();
    if (!token) return null;
    try {
        const res = await fetch('/api/seat', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
        });
        const answer = res.ok ? await res.json() : null;
        announce(answer);
        return answer;
    } catch {
        return null;
    }
}

const refused = (answer) => answer?.seat === false;
// Each answer carries the maintenance state too (js/app.js listens instead of asking on its own)
export const SEAT_EVENT = 'aniroll:seat';
const announce = (answer) => { if (answer && typeof answer.maintenance === 'boolean') window.dispatchEvent(new CustomEvent(SEAT_EVENT, { detail: answer })); };

function waitPage(answer) {
    let box = document.getElementById('seat-wait');
    if (!box) {
        box = document.createElement('div');
        box.id = 'seat-wait';
        box.className = 'seat-wait';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'seat-wait-title');
        box.innerHTML = `<div class="seat-wait-card">
            <div class="seat-wait-spinner" aria-hidden="true"></div>
            <h1 class="seat-wait-title" id="seat-wait-title">AniRoll is full right now</h1>
            <p class="seat-wait-text">Up to <span data-max>100</span> people can use AniRoll at the same time.
                <span class="seat-wait-line" aria-live="polite"></span></p>
            <p class="seat-wait-note">Keep this page open: it lets you in by itself as soon as a place is free.</p>
            <button class="glass-btn glass-btn-secondary" type="button" data-seat-logout>Log out</button>
        </div>`;
        box.querySelector('[data-seat-logout]').addEventListener('click', async () => {
            const { logout } = await import('./auth.js?v=144');
            logout();
        });
        document.body.appendChild(box);
        document.documentElement.classList.add('seat-waiting');
        // Nothing plays on behind the waiting page (the player, a trailer)
        for (const v of document.querySelectorAll('video')) v.pause();
        box.querySelector('[data-seat-logout]').focus();
    }
    if (answer.max) box.querySelector('[data-max]').textContent = String(answer.max);
    const n = Number(answer.position) || 1;
    box.querySelector('.seat-wait-line').innerHTML = n === 1
        ? '<strong>You’re next in line.</strong>'
        : `You’re number <strong>${esc(String(n))}</strong> in line.`;
}

function closeWaitPage() {
    document.getElementById('seat-wait')?.remove();
    document.documentElement.classList.remove('seat-waiting');
}

// Shows the waiting page until a seat is free; resolves then
function waitForSeat(answer) {
    waiting ||= new Promise(resolve => {
        waitPage(answer);
        const poll = async () => {
            const next = await ask();
            if (refused(next)) {
                waitPage(next);
                setTimeout(poll, WAIT_POLL_MS);
                return;
            }
            closeWaitPage();
            waiting = null;
            resolve();
        };
        setTimeout(poll, WAIT_POLL_MS);
    });
    return waiting;
}

function heartbeat() {
    setInterval(async () => {
        if (!isLoggedIn() || waiting) return;
        if (document.hidden && Date.now() - hiddenSince > HIDDEN_HOLD_MS) return;
        const answer = await ask();
        if (refused(answer)) waitForSeat(answer);
    }, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) { hiddenSince = Date.now(); return; }
        // Back after a long while: the seat may have gone to someone else
        const away = hiddenSince && Date.now() - hiddenSince > HIDDEN_HOLD_MS;
        hiddenSince = 0;
        if (!away || waiting || !isLoggedIn()) return;
        const answer = await ask();
        if (refused(answer)) waitForSeat(answer);
    });
}

// At start-up, before the app draws: a seat, or the waiting page until there is one. A slow backend
// does not hold the app up: after `patience` ms it opens, and the heartbeat sorts it out.
export async function takeSeat({ patience = 3000 } = {}) {
    if (!isLoggedIn()) return;
    if (!started) { started = true; heartbeat(); }
    const answer = await Promise.race([ask(), new Promise(r => setTimeout(() => r(null), patience))]);
    if (refused(answer)) await waitForSeat(answer);
}
