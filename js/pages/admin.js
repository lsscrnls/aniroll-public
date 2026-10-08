// @ts-check
import { getToken, isLoggedIn } from '../auth.js?v=151';
import { getState, esc, toast } from '../store.js?v=151';
import { showConfirm } from '../a11y.js?v=151';
import * as api from '../api.js?v=151';

// #/admin: how busy AniRoll is — seats, the line, requests, Jellyfin playback, errors — for its owner,
// and what they can change: the limit, the VIPs, letting someone in, freeing a seat, maintenance mode,
// the error log. The server decides who may see and do it (api/server.js, "Admin"); the link in the
// avatar menu only shows for that account. One sample a minute for 24 hours, refreshed every 30 seconds.
export const ADMIN_ID = 6649000;
const REFRESH_MS = 30_000;
const RANGES = [
    { key: '1h', label: '1 h', ms: 60 * 60 * 1000 },
    { key: '6h', label: '6 h', ms: 6 * 60 * 60 * 1000 },
    { key: '24h', label: '24 h', ms: 24 * 60 * 60 * 1000 },
];
// A gap this long (server restarted, nothing sampled) breaks the line instead of bridging it
const GAP_MS = 3 * 60 * 1000;

const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtAgo = (t, now) => {
    const s = Math.max(0, Math.round((now - t) / 1000));
    return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const fmtDuration = (ms) => {
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
};
const fmtBytes = (b) => `${Math.round(b / 1024 / 1024)} MB`;

// A round-number ceiling for the y axis, so the ticks read 0, 25, 50 ...
function niceMax(v) {
    if (v <= 4) return 4;
    const step = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
    return 10 * step;
}

// A single-series line (with a soft area under it) over time, drawn in SVG at the container's width.
// A crosshair and a tooltip follow the pointer. `limit` draws a dashed reference line (not a series).
function lineChart(host, points, { from, to, height = 220, limit = null, unit = '', compact = false }) {
    const width = Math.max(280, Math.round(host.clientWidth || 600));
    const pad = { l: 36, r: 12, t: 12, b: 24 };
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const top = niceMax(Math.max(1, limit ?? 0, ...points.map(p => p.v)));
    const x = (t) => pad.l + ((t - from) / (to - from)) * w;
    const y = (v) => pad.t + h - (v / top) * h;

    // Runs without gaps
    const runs = [];
    let run = [];
    for (const p of points) {
        if (run.length && p.t - run[run.length - 1].t > GAP_MS) { runs.push(run); run = []; }
        run.push(p);
    }
    if (run.length) runs.push(run);
    const line = (r) => r.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = (r) => `${line(r)}L${x(r[r.length - 1].t).toFixed(1)},${y(0)}L${x(r[0].t).toFixed(1)},${y(0)}Z`;

    const yTicks = [0, top / 2, top];
    const hours = to - from > 6 * 3600e3 ? 6 : to - from > 3600e3 ? 1 : 0.25;
    const xTicks = [];
    const stepMs = hours * 3600e3;
    for (let t = Math.ceil(from / stepMs) * stepMs; t <= to; t += stepMs) xTicks.push(t);

    host.innerHTML = `<svg class="adm-chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-hidden="true">
        ${yTicks.map(v => `<line class="adm-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
            <text class="adm-axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
        ${compact ? '' : xTicks.map(t => `<text class="adm-axis" x="${x(t)}" y="${height - 6}" text-anchor="middle">${fmtClock(t)}</text>`).join('')}
        ${limit != null ? `<line class="adm-limit" x1="${pad.l}" x2="${width - pad.r}" y1="${y(limit)}" y2="${y(limit)}"/>
            <text class="adm-limit-label" x="${width - pad.r}" y="${y(limit) - 6}" text-anchor="end">Limit ${limit}</text>` : ''}
        ${runs.map(r => `<path class="adm-area" d="${area(r)}"/><path class="adm-line" d="${line(r)}"/>`).join('')}
        <g class="adm-cross" hidden><line class="adm-cross-line" y1="${pad.t}" y2="${pad.t + h}"/><circle class="adm-cross-dot" r="5"/></g>
    </svg><div class="adm-tip" hidden></div>`;

    const svg = host.querySelector('svg');
    const cross = host.querySelector('.adm-cross');
    const tip = host.querySelector('.adm-tip');
    const hide = () => { cross.setAttribute('hidden', ''); tip.hidden = true; };
    svg.addEventListener('pointermove', (ev) => {
        if (!points.length) return;
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * width;
        const t = from + ((px - pad.l) / w) * (to - from);
        let best = points[0];
        for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
        const cx = x(best.t), cy = y(best.v);
        cross.removeAttribute('hidden');
        cross.querySelector('line').setAttribute('x1', cx);
        cross.querySelector('line').setAttribute('x2', cx);
        cross.querySelector('circle').setAttribute('cx', cx);
        cross.querySelector('circle').setAttribute('cy', cy);
        tip.hidden = false;
        tip.innerHTML = `<strong>${esc(String(best.v))}${unit}</strong><span>${fmtClock(best.t)}</span>`;
        const left = (cx / width) * r.width;
        tip.style.left = `${Math.min(r.width - 90, Math.max(0, left - 45))}px`;
        // Above the point, or below it when the point is at the top (the tooltip would hide it)
        const py = (cy / height) * r.height;
        tip.style.top = `${py - 56 >= 0 ? py - 56 : py + 14}px`;
    });
    svg.addEventListener('pointerleave', hide);
}

function tile(label, value, note = '', gauge = null) {
    return `<div class="adm-tile">
        <div class="adm-tile-value">${value}</div>
        <div class="adm-tile-label">${esc(label)}</div>
        ${gauge != null ? `<div class="adm-gauge" role="img" aria-label="${Math.round(gauge * 100)}% full"><span style="width:${Math.min(100, gauge * 100)}%"></span></div>` : ''}
        ${note ? `<div class="adm-tile-note">${note}</div>` : ''}
    </div>`;
}

export async function render({ content }) {
    const me = getState().user;
    if (!isLoggedIn() || me?.id !== ADMIN_ID) {
        content.innerHTML = '<div class="page adm-page"><h1 class="page-title">Admin</h1><p class="adm-note">This page is only for AniRoll’s owner.</p></div>';
        return;
    }
    content.innerHTML = `<div class="page adm-page">
        <div class="adm-head">
            <div><h1 class="page-title">Admin</h1><p class="adm-note" id="adm-updated">Loading…</p></div>
            <div class="adm-ranges" role="group" aria-label="Time range">
                ${RANGES.map(r => `<button class="glass-btn glass-btn-secondary glass-btn-sm" data-range="${r.key}" aria-pressed="false">${r.label}</button>`).join('')}
            </div>
        </div>
        <div class="adm-tiles" id="adm-tiles"></div>
        <div class="adm-grid2">
            <section class="adm-card">
                <h2 class="adm-card-title">Limit</h2>
                <p class="adm-card-sub">How many people may use AniRoll at once. VIPs come on top.</p>
                <form class="adm-form" id="adm-limit-form">
                    <label class="adm-field"><span>Seats</span><input class="glass-input" type="number" min="1" max="10000" id="adm-limit" required></label>
                    <button class="glass-btn glass-btn-primary" type="submit">Save</button>
                </form>
            </section>
            <section class="adm-card">
                <h2 class="adm-card-title">Maintenance mode</h2>
                <p class="adm-card-sub" id="adm-maint-state"></p>
                <form class="adm-form" id="adm-maint-form">
                    <label class="adm-field adm-field-grow"><span>Note for everyone</span><input class="glass-input" type="text" maxlength="200" id="adm-maint-note" placeholder="Back in a few minutes"></label>
                    <button class="glass-btn glass-btn-primary" type="submit" id="adm-maint-btn">Switch on</button>
                </form>
            </section>
        </div>
        <section class="adm-card">
            <h2 class="adm-card-title">People in AniRoll</h2>
            <p class="adm-card-sub">Seats taken, VIPs not counted; one sample a minute</p>
            <div class="adm-chart" id="adm-chart-seats"></div>
            <details class="adm-table-view"><summary>Show as table</summary><div id="adm-seats-table"></div></details>
        </section>
        <div class="adm-grid3">
            <section class="adm-card"><h2 class="adm-card-title">Waiting in line</h2><div class="adm-chart" id="adm-chart-queue"></div></section>
            <section class="adm-card"><h2 class="adm-card-title">API requests / min</h2><div class="adm-chart" id="adm-chart-req"></div></section>
            <section class="adm-card"><h2 class="adm-card-title">Watching on Jellyfin</h2><div class="adm-chart" id="adm-chart-watch"></div></section>
        </div>
        <div class="adm-grid3">
            <section class="adm-card"><h2 class="adm-card-title">Online now</h2><div id="adm-online"></div></section>
            <section class="adm-card">
                <h2 class="adm-card-title">VIPs</h2>
                <p class="adm-card-sub">Always get in, even when AniRoll is full.</p>
                <div id="adm-vips"></div>
                <form class="adm-form" id="adm-vip-form">
                    <label class="adm-field adm-field-grow"><span>AniList name</span><input class="glass-input" type="text" maxlength="40" id="adm-vip-name" required autocomplete="off"></label>
                    <button class="glass-btn glass-btn-primary" type="submit">Add</button>
                </form>
            </section>
            <section class="adm-card"><h2 class="adm-card-title">Waiting</h2><div id="adm-waiting"></div></section>
        </div>
        <div class="adm-grid2">
            <section class="adm-card"><h2 class="adm-card-title">Errors in people’s browsers (24 h)</h2><div id="adm-errors"></div>
                <button class="glass-btn glass-btn-secondary glass-btn-sm" type="button" id="adm-clear-errors">Clear the error log</button></section>
            <section class="adm-card"><h2 class="adm-card-title">Accounts & server</h2><div id="adm-server"></div></section>
        </div>
    </div>`;

    const $ = (id) => content.querySelector(`#${id}`);
    let range = RANGES[1];
    let data = null;
    let timer = 0;
    let closed = false;

    const paintRange = () => content.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === range.key)));
    content.querySelector('.adm-ranges').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-range]');
        if (!b) return;
        range = RANGES.find(r => r.key === b.dataset.range);
        paintRange();
        if (data) paint();
    });
    paintRange();

    function paint() {
        const d = data;
        const now = d.now;
        const from = now - range.ms;
        const samples = d.samples.filter(s => s.t >= from);
        const day = d.samples.filter(s => s.t >= now - 24 * 3600e3);
        const peak = day.reduce((m, s) => (s.seats > m.seats ? s : m), { seats: d.seats, t: now });

        $('adm-updated').textContent = `Updated ${fmtClock(now)} · refreshes every 30 s`;
        $('adm-tiles').innerHTML = [
            tile('Online now', `${d.seats}<small> / ${d.max}</small>`, d.seats >= d.max ? 'Full: newcomers wait in line' : `${d.max - d.seats} seats free`, d.seats / d.max),
            tile('In line', String(d.queue), d.queue ? 'Waiting for a seat' : 'Nobody waiting'),
            tile('VIPs online', String(d.vip), 'On top of the limit'),
            tile('Peak, 24 h', String(peak.seats), peak.t ? `at ${fmtClock(peak.t)}` : ''),
            tile('Watching', String(d.watching), 'On Jellyfin, right now'),
            tile('Watch parties', String(d.parties), 'Running'),
        ].join('');

        const series = (key) => samples.map(s => ({ t: s.t, v: s[key] || 0 }));
        lineChart($('adm-chart-seats'), series('seats'), { from, to: now, limit: d.max, height: 240 });
        lineChart($('adm-chart-queue'), series('queue'), { from, to: now, height: 140, compact: true });
        lineChart($('adm-chart-req'), series('req'), { from, to: now, height: 140, compact: true });
        lineChart($('adm-chart-watch'), series('watching'), { from, to: now, height: 140, compact: true });

        // The table view: one row per hour of the range, its highest count
        const hours = new Map();
        for (const s of samples) {
            const h = new Date(s.t); h.setMinutes(0, 0, 0);
            const k = h.getTime();
            const row = hours.get(k) || { seats: 0, queue: 0, req: 0 };
            row.seats = Math.max(row.seats, s.seats); row.queue = Math.max(row.queue, s.queue); row.req += s.req;
            hours.set(k, row);
        }
        $('adm-seats-table').innerHTML = `<table class="adm-table"><thead><tr><th>Hour</th><th>Most online</th><th>Most in line</th><th>Requests</th></tr></thead><tbody>
            ${[...hours].reverse().map(([t, r]) => `<tr><td>${fmtClock(t)}</td><td>${r.seats}</td><td>${r.queue}</td><td>${r.req}</td></tr>`).join('') || '<tr><td colspan="4">No samples yet</td></tr>'}
        </tbody></table>`;

        $('adm-online').innerHTML = d.online.length ? `<table class="adm-table"><tbody>${d.online.map(u => `<tr>
            <td>${u.name === 'unverified' ? '<em>unverified</em>' : `<a href="#/user/${esc(encodeURIComponent(u.name))}">${esc(u.name)}</a>`}${u.vip ? ' <span class="adm-chip">VIP</span>' : ''}</td>
            <td class="adm-muted">${fmtAgo(u.seen, now)}</td>
            <td class="adm-act">${u.vip ? '' : `<button class="glass-btn glass-btn-secondary glass-btn-sm" data-free="${esc(u.key)}" data-name="${esc(u.name)}">Free seat</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="adm-note">Nobody online.</p>';
        $('adm-waiting').innerHTML = d.waiting.length ? `<table class="adm-table"><tbody>${d.waiting.map((u, i) => `<tr>
            <td class="adm-num">${i + 1}</td><td>${esc(u.name)}</td><td class="adm-muted">since ${fmtClock(u.since)}</td>
            <td class="adm-act"><button class="glass-btn glass-btn-primary glass-btn-sm" data-let-in="${esc(u.key)}">Let in</button></td></tr>`).join('')}</tbody></table>` : '<p class="adm-note">Nobody waiting.</p>';
        $('adm-errors').innerHTML = `<p class="adm-big">${d.errors.count}</p>` + (d.errors.latest.length
            ? `<table class="adm-table"><tbody>${d.errors.latest.map(e => `<tr><td class="adm-muted">${fmtClock(Date.parse(e.at))}</td>
                <td><span class="adm-err">${esc(e.message)}</span><span class="adm-muted"> · ${esc(e.route || '')} · v${esc(e.version || '?')}</span></td></tr>`).join('')}</tbody></table>`
            : '<p class="adm-note">None in the last 24 hours.</p>');
        $('adm-vips').innerHTML = `<table class="adm-table"><tbody>${d.vips.map(v => `<tr>
            <td><a href="#/user/${esc(encodeURIComponent(v.name))}">${esc(v.name)}</a>${v.id === ADMIN_ID ? ' <span class="adm-chip">You</span>' : ''}</td>
            <td class="adm-act">${v.id === ADMIN_ID ? '' : `<button class="glass-btn glass-btn-secondary glass-btn-sm" data-unvip="${v.id}" data-name="${esc(v.name)}">Remove</button>`}</td></tr>`).join('')}</tbody></table>`;
        // Forms only take the server's values while nobody is typing in them
        const limitInput = $('adm-limit');
        if (document.activeElement !== limitInput) limitInput.value = String(d.max);
        const maint = d.maintenance;
        $('adm-maint-state').textContent = maint ? `On since ${fmtClock(Date.parse(maint.since))}${maint.note ? `: “${maint.note}”` : ''}` : 'Off: background sync runs, nobody sees a notice.';
        $('adm-maint-btn').textContent = maint ? 'Switch off' : 'Switch on';
        $('adm-maint-note').closest('.adm-field').hidden = !!maint;
        $('adm-clear-errors').hidden = !d.errors.count;

        const blocked = d.anilist.verifyPausedFor > 0;
        $('adm-server').innerHTML = `<table class="adm-table"><tbody>
            <tr><td>Background sync</td><td class="adm-num">${d.accounts.backgroundSync} accounts</td></tr>
            <tr><td>Jellyfin connected</td><td class="adm-num">${d.accounts.jellyfin} accounts</td></tr>
            <tr><td>Jellyfin webhooks</td><td class="adm-num">${d.accounts.webhooks}</td></tr>
            <tr><td>AniList sign-in checks</td><td class="adm-num">${blocked ? `<span class="adm-status is-warn">Paused, AniList refused (${Math.ceil(d.anilist.verifyPausedFor / 1000)} s)</span>` : '<span class="adm-status is-ok">Working</span>'}</td></tr>
            <tr><td>Server up</td><td class="adm-num">${fmtDuration(d.server.uptime)}</td></tr>
            <tr><td>Memory</td><td class="adm-num">${fmtBytes(d.server.rss)}</td></tr>
            <tr><td>Node</td><td class="adm-num">${esc(d.server.node)}</td></tr>
        </tbody></table>`;
    }

    // One action on the server; the answer is the fresh numbers
    async function act(body, done) {
        try {
            const res = await fetch('/api/admin/action', {
                method: 'POST',
                headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(10000),
            });
            const answer = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(answer.error || `the server answered ${res.status}`);
            if (Array.isArray(answer.samples)) data = answer;
            if (!closed) paint();
            if (done) toast(done, 'success');
        } catch (err) {
            toast(`Admin: ${err.message}`, 'error');
        }
    }

    content.querySelector('.adm-page').addEventListener('click', async (ev) => {
        const letIn = ev.target.closest('[data-let-in]');
        const free = ev.target.closest('[data-free]');
        const unvip = ev.target.closest('[data-unvip]');
        if (letIn) return act({ action: 'letIn', key: letIn.dataset.letIn }, 'Let in');
        if (free && await showConfirm({ title: `Free ${free.dataset.name}’s seat?`, message: 'The seat goes to the first in line. They get it back when a place is free.', confirmText: 'Free seat', danger: true })) {
            return act({ action: 'free', key: free.dataset.free }, 'Seat freed');
        }
        if (unvip && await showConfirm({ title: `Remove ${unvip.dataset.name} from the VIPs?`, message: 'They will need a free seat like everyone else.', confirmText: 'Remove', danger: true })) {
            return act({ action: 'removeVip', id: Number(unvip.dataset.unvip) }, 'VIP removed');
        }
        if (ev.target.closest('#adm-clear-errors') && await showConfirm({ title: 'Clear the error log?', message: 'Every error sent by people’s browsers is deleted.', confirmText: 'Clear', danger: true })) {
            return act({ action: 'clearErrors' }, 'Error log cleared');
        }
    });
    $('adm-limit-form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        act({ action: 'limit', max: Number($('adm-limit').value) }, 'Limit saved');
        $('adm-limit').blur();
    });
    $('adm-maint-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const on = !data?.maintenance;
        if (on && !await showConfirm({ title: 'Switch on maintenance mode?', message: 'Background sync pauses and everyone sees the note until you switch it off.', confirmText: 'Switch on' })) return;
        act({ action: 'maintenance', on, note: $('adm-maint-note').value.trim() }, on ? 'Maintenance mode on' : 'Maintenance mode off');
    });
    $('adm-vip-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const input = $('adm-vip-name');
        const name = input.value.trim();
        if (!name) return;
        // The name becomes an id here: the server keeps VIPs by AniList id
        const user = await api.getUserProfile(name, getToken()).catch(() => null);
        if (!user?.id) return toast(`No AniList user called ${name}`, 'error');
        await act({ action: 'addVip', id: user.id, name: user.name }, `${user.name} is a VIP now`);
        input.value = '';
    });

    async function load() {
        try {
            const res = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${getToken()}` }, signal: AbortSignal.timeout(10000) });
            if (closed) return;
            if (res.status === 403 || res.status === 401) { $('adm-updated').textContent = 'The server says this page is not for this account.'; return; }
            if (!res.ok) throw new Error(`the server answered ${res.status}`);
            const fresh = await res.json();
            if (!Array.isArray(fresh?.samples)) throw new Error('the server sent no numbers');
            data = fresh;
            paint();
        } catch (err) {
            if (!closed) $('adm-updated').textContent = `Could not load the numbers: ${err.message}`;
        }
        if (!closed) timer = setTimeout(load, REFRESH_MS);
    }
    // Charts follow the width of the page
    const resize = new ResizeObserver(() => { if (data) paint(); });
    resize.observe(content.querySelector('.adm-page'));
    load();

    return () => {
        closed = true;
        clearTimeout(timer);
        resize.disconnect();
    };
}
