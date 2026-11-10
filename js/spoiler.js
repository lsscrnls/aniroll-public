// AniList spoiler syntax (changelog 4 Nov 2026), parsed into a tree the feed renders:
//   ~! text !~            inline when it shares its line with other text and has no line break,
//                         a block otherwise (alone on its line, or spanning several)
//   ~!{Label} text !~     optional label: no braces, angle brackets or line breaks, trimmed,
//                         an empty one counts as none
// An opening pairs with the closest closing after it (stack order), so spoilers nest. Three levels
// at most; a deeper one stays plain text, markers included. Unpaired markers are plain text too.
//
// Nodes: { type: 'text', text } | { type: 'spoiler', label, block, children }

export const MAX_DEPTH = 3;
const LABEL = /^\{([^{}<>\n]*)\}/;

export function parseSpoilers(text) {
    const src = String(text ?? '');
    // Pair the markers: each closing closes the latest still-open opening
    const open = [];
    const pairs = [];
    for (const m of src.matchAll(/~!|!~/g)) {
        if (m[0] === '~!') open.push(m.index);
        else if (open.length) pairs.push([open.pop(), m.index]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    return build(src, pairs, 0, src.length, 1);
}

// The nodes for src[from, to): pairs inside it at the top level become spoilers (or text past MAX_DEPTH)
function build(src, pairs, from, to, depth) {
    const nodes = [];
    let pos = from;
    const pushText = (t) => {
        if (!t) return;
        const last = nodes[nodes.length - 1];
        if (last?.type === 'text') last.text += t;
        else nodes.push({ type: 'text', text: t });
    };
    for (const [o, c] of pairs) {
        if (o < pos || c + 2 > to) continue; // nested in a pair already handled, or outside this range
        pushText(src.slice(pos, o));
        if (depth > MAX_DEPTH) {
            pushText(src.slice(o, c + 2));
        } else {
            const label = src.slice(o + 2, c).match(LABEL);
            const start = o + 2 + (label ? label[0].length : 0);
            const inner = src.slice(start, c);
            const lineStart = src.lastIndexOf('\n', o - 1) + 1;
            const lineEnd = (i => (i < 0 ? src.length : i))(src.indexOf('\n', c + 2));
            const alone = !src.slice(lineStart, o).trim() && !src.slice(c + 2, lineEnd).trim();
            nodes.push({
                type: 'spoiler',
                label: label?.[1].trim() || null,
                block: alone || inner.includes('\n'),
                children: build(src, pairs, start, c, depth + 1),
            });
        }
        pos = c + 2;
    }
    pushText(src.slice(pos, to));
    return nodes;
}
