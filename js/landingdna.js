// @ts-check
// The landing page's Anime DNA: three made-up viewers (media/dna-samples.json, built by tools/dna-samples) drawn by
// js/dna.js right here, and a visitor's own list by AniList name without logging in. That list is read by the
// server (POST /api/dna/try), once per visitor every 36 hours, and only while AniList leaves it enough room;
// GET says whether the form is open. Loaded when the section comes near the screen.
import { readDna } from './dna.js';
import { esc } from './store.js';

const features = (lists) => new Map(lists.flatMap(l => l.entries).map(e => [e.media.id, e.media]));
const when = (t) => new Date(t).toLocaleString('en', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

const MESSAGES = {
    'not-found': 'There’s no AniList account with that name.',
    private: 'That list is private on AniList. Log in to see your own DNA.',
    'slow-down': 'Too many tries in a row. Wait a minute and try again.',
    busy: 'Trying it is paused while AniList is busy. Try again in a few minutes, or log in.',
    name: 'AniList names are 2 to 20 letters, digits, - or _.',
    short: 'That list is too short for a DNA yet: it needs five shows watched.',
};

function renderResult(dna, own) {
    return `<div class="dna-visual">${dna.art}</div>
        <div class="dna-body">
            <h3 class="dna-type">${esc(dna.type.name)}</h3>
            ${dna.streak ? `<div class="dna-streak">with a streak of ${esc(dna.streak)}</div>` : ''}
            <p class="dna-line">${esc(dna.type.line)}</p>
            <p class="dna-why">${esc(dna.type.why)}</p>
            ${dna.loves.length ? `<div class="dna-loves">${dna.loves.slice(0, 6).map(l => `<span class="dna-love">${esc(l.name)}</span>`).join('')}</div>` : ''}
            ${own && dna.quirks.length ? `<ul class="dna-quirks">${dna.quirks.slice(0, 2).map(q => `<li>${q}</li>`).join('')}</ul>` : ''}
        </div>`;
}

/** @param {HTMLElement} section the .lp-dna */
export async function initDnaTry(section) {
    const stage = /** @type {HTMLElement} */ (section.querySelector('.lp-dna-stage'));
    const tabs = /** @type {HTMLElement} */ (section.querySelector('.lp-dna-tabs'));
    const form = /** @type {HTMLFormElement} */ (section.querySelector('.lp-dna-form'));
    const note = /** @type {HTMLElement} */ (section.querySelector('.lp-dna-note'));
    const input = /** @type {HTMLInputElement} */ (form.querySelector('input'));
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button'));

    const samples = await fetch('media/dna-samples.json').then(r => r.json()).catch(() => []);
    const shown = samples.map(s => ({ name: s.name, dna: readDna(s.lists, features(s.lists), false) })).filter(s => s.dna);
    // Without the DNA code (the public mirror's stub) there is nothing to show
    if (!shown.length) { section.hidden = true; return; }
    const show = (dna, own) => { stage.innerHTML = renderResult(dna, own); };
    const pick = (i) => {
        tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
        if (shown[i]) show(shown[i].dna, false);
    };
    tabs.innerHTML = shown.map((s, i) => `<button type="button" role="tab" aria-selected="${!i}" data-sample="${i}">${esc(s.name)}</button>`).join('');
    tabs.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement} */ (e.target).closest('[data-sample]');
        if (b) pick(Number(/** @type {HTMLElement} */ (b).dataset.sample));
    });
    pick(0);

    // The form: closed while the server has no room (or there is no server, like on localhost)
    const closed = (text) => { input.disabled = true; button.disabled = true; note.textContent = text; };
    const state = await fetch('/api/dna/try').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!state) { form.hidden = true; return; }
    if (!state.left) closed(`You’ve tried it already. Log in with AniList to see yours any time, or try again ${when(state.again)}.`);
    else if (!state.open) closed(MESSAGES.busy);
    else note.textContent = 'One list per visitor every 36 hours. Only an anonymous hash of your address is kept for that, then deleted.';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!/^[A-Za-z0-9_-]{2,20}$/.test(name)) { note.textContent = MESSAGES.name; return; }
        button.disabled = true;
        note.textContent = 'Reading the list…';
        const res = await fetch('/api/dna/try', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
            .catch(() => null);
        const data = res && await res.json().catch(() => null);
        if (!res?.ok || !data?.lists) {
            const code = data?.error || 'busy';
            if (code === 'used') return closed(`You’ve tried it already. Log in with AniList to see yours any time, or try again ${when(data.again)}.`);
            note.textContent = MESSAGES[code] || MESSAGES.busy;
            button.disabled = code === 'busy';
            return;
        }
        const dna = readDna(data.lists, features(data.lists), true);
        tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', 'false'));
        if (!dna) { closed(MESSAGES.short); return; }
        show(dna, true);
        closed(`That’s the DNA of ${data.name}. Log in with AniList to keep it, see how it changes and match it with friends.`);
    });
}
