// Subtitles out of the way of the card at the bottom right (Skip intro, Up next, Episode over): lines that would
// run under it move left, or up above it when there is no room to the left. Text lines are measured; for ASS the
// lines on screen now are read from the script and their size reckoned from its styles (libass draws in a worker,
// its canvas cannot be looked into).

const GAP = 16;

// box: where the lines are without any dodge, card and bounds: DOMRects. Returns the [x, y] shift in px
export function dodgeFor(box, card, bounds) {
    if (!box || !card || box.bottom - box.top < 1) return [0, 0];
    const clear = box.bottom <= card.top - GAP || box.top >= card.bottom + GAP
        || box.right <= card.left - GAP || box.left >= card.right + GAP;
    if (clear) return [0, 0];
    const dx = box.right - (card.left - GAP);
    if (box.left - dx >= bounds.left + GAP) return [-dx, 0];
    return [0, -(box.bottom - (card.top - GAP))];
}

const time = (s) => {
    const m = /(\d+):(\d+):(\d+)[.:](\d+)/.exec(s || '');
    return m ? m[1] * 3600 + m[2] * 60 + Number(m[3]) + Number(m[4]) / 10 ** m[4].length : 0;
};
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);

// The dialogue of an ASS/SSA script: only lines libass sets at the bottom by itself ({\pos}, {\move} and
// drawings are signs placed by hand, they stay where the release put them)
export function parseAss(text) {
    const info = {};
    const styles = new Map();
    const lines = [];
    let section = '';
    let format = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('[')) { section = line.toLowerCase(); format = null; continue; }
        const at = line.indexOf(':');
        if (at < 0) continue;
        const key = line.slice(0, at);
        const value = line.slice(at + 1).trim();
        if (section === '[script info]') { info[key.toLowerCase()] = value; continue; }
        if (key === 'Format') { format = value.split(',').map(f => f.trim().toLowerCase()); continue; }
        if (!format) continue;
        const parts = value.split(',');
        if (key === 'Style' && section.includes('styles')) {
            const s = Object.fromEntries(format.map((f, i) => [f, (parts[i] || '').trim()]));
            styles.set(s.name, s);
        } else if (key === 'Dialogue' && section === '[events]') {
            const e = Object.fromEntries(format.slice(0, -1).map((f, i) => [f, (parts[i] || '').trim()]));
            e.text = parts.slice(format.length - 1).join(',');
            lines.push(e);
        }
    }
    // libass's defaults for a script that leaves the size out
    let resX = num(info.playresx);
    let resY = num(info.playresy);
    if (!resX && !resY) { resX = 384; resY = 288; }
    else if (!resY) resY = resX === 1280 ? 1024 : resX * 3 / 4;
    else if (!resX) resX = resY === 1024 ? 1280 : resY * 4 / 3;

    const out = [];
    for (const e of lines) {
        if (/\\(pos|move)\s*\(|\\p[1-9]/.test(e.text)) continue;
        const s = styles.get(e.style) || styles.get(e.style?.replace(/^\*/, '')) || styles.get('Default') || {};
        const an = /\\an(\d)/.exec(e.text);
        const align = an ? Number(an[1]) : num(s.alignment, 2);
        if (align < 1 || align > 3) continue;
        const rows = e.text.replace(/\{[^}]*\}/g, '').replace(/\\h/g, ' ').split(/\\[Nn]/).map(r => r.trim()).filter(Boolean);
        if (!rows.length) continue;
        const fs = /\\fs(\d+(?:\.\d+)?)/.exec(e.text);
        out.push({
            start: time(e.start), end: time(e.end), align, rows,
            size: fs ? Number(fs[1]) : num(s.fontsize, 20),
            font: s.fontname || 'sans-serif',
            bold: s.bold && s.bold !== '0',
            italic: s.italic && s.italic !== '0',
            scaleX: num(s.scalex, 100) / 100,
            outline: num(s.outline, 2),
            mL: num(e.marginl) || num(s.marginl, 10),
            mR: num(e.marginr) || num(s.marginr, 10),
            mV: num(e.marginv) || num(s.marginv, 10),
        });
    }
    return { resX, resY, lines: out };
}

let measure = null;
const textWidth = (row, font) => {
    measure ||= document.createElement('canvas').getContext('2d');
    measure.font = font;
    return measure.measureText(row).width;
};

// Where the bottom lines on screen at script time t (or starting within `lead` s) are drawn, on a canvas at `rect` (null: none)
export function assBox(script, t, rect, lead = 0) {
    const now = script.lines.filter(l => l.start <= t + lead && t < l.end);
    if (!now.length || !rect.width) return null;
    const sx = rect.width / script.resX;
    const sy = rect.height / script.resY;
    let width = 0;
    let height = 0;
    const first = now[0];
    for (const l of now) {
        const px = l.size * sy;
        const room = (script.resX - l.mL - l.mR) * sx;
        const font = `${l.italic ? 'italic ' : ''}${l.bold ? 700 : 400} ${px}px "${l.font}", sans-serif`;
        for (const row of l.rows) {
            const w = textWidth(row, font) * l.scaleX + 2 * l.outline * sy;
            width = Math.max(width, Math.min(w, room));
            // libass wraps a row wider than the room it has
            height += px * 1.2 * Math.max(1, Math.ceil(w / room));
        }
    }
    const bottom = rect.top + rect.height - first.mV * sy;
    let left;
    if (first.align === 1) left = rect.left + first.mL * sx;
    else if (first.align === 3) left = rect.left + rect.width - first.mR * sx - width;
    else left = rect.left + (first.mL + (script.resX - first.mL - first.mR) / 2) * sx - width / 2;
    return { left, right: left + width, top: bottom - height, bottom };
}
