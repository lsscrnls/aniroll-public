#!/usr/bin/env node
// Gives every module, stylesheet and script a fingerprint of its content (?h=…), in the copy that goes up
// (scripts/deploy.sh runs it on its stage, before obfuscating). The repo keeps plain imports; nobody bumps versions.
//
// A module's fingerprint covers itself and everything it imports, all the way down: when store.js changes,
// every module that reaches it gets a new address too, so no browser keeps an old app.js that still asks for
// the old store.js. Unchanged parts keep their address and stay in the browser's cache (nginx: immutable).
// index.html itself is never cached, so a reload always finds the new addresses.
//
// Writes version.json { build }: the fingerprint of js/app.js, which reaches the whole app. Open tabs compare
// it with their own and offer a reload (js/app.js).
//
//   node scripts/fingerprint.js <dir>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.argv[2] || '.');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
const fail = (msg) => { console.error(`fingerprint: ${msg}`); process.exit(1); };

function walk(dir, ext, out = []) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'vendor') walk(rel, ext, out); } else if (rel.endsWith(ext)) out.push(rel);
    }
    return out;
}

// Stylesheets first: js/design.js names them, so its own fingerprint has to include theirs
const cssHash = new Map(walk('css', '.css').map(f => [f, hash(read(f))]));
const CSS_REF = /(["'])(css\/[\w.-]+\.css)\1/g;
const withCss = (text) => text.replace(CSS_REF, (m, q, f) => cssHash.has(f) ? `${q}${f}?h=${cssHash.get(f)}${q}` : m);

const files = walk('js', '.js');
const source = new Map(files.map(f => [f, withCss(read(f))]));
// import … from './x.js', export … from, import './x.js', import('./x.js')
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])(\.{1,2}\/[^'"`?]+\.js)\2/g;
// Vendor files carry their version in their name and stay as they are
const resolve = (f, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
const isVendor = (target) => target.startsWith('js/vendor/');
const deps = new Map(files.map(f => [f, [...source.get(f).matchAll(SPEC)].map(m => resolve(f, m[3])).filter(target => {
    if (!isVendor(target) && !source.has(target)) fail(`${f} imports ${target}, which is not there`);
    return !isVendor(target);
})]));

// Everything a module reaches (itself included), cycles and all
function reach(f, seen = new Set()) {
    if (seen.has(f)) return seen;
    seen.add(f);
    for (const d of deps.get(f)) reach(d, seen);
    return seen;
}
const jsHash = new Map(files.map(f => [f, hash([...reach(f)].sort().map(g => `${g}\n${source.get(g)}`).join('\n'))]));

for (const f of files) {
    const out = source.get(f).replace(SPEC, (m, pre, q, spec) => {
        const target = resolve(f, spec);
        return isVendor(target) ? m : `${pre}${q}${spec}?h=${jsHash.get(target)}${q}`;
    });
    fs.writeFileSync(path.join(root, f), out);
}

// index.html: the entry, its modulepreloads, the classic scripts and the stylesheets
const html = withCss(read('index.html')).replace(/((?:src|href)=")(js\/[^"?]+\.js)"/g, (m, pre, f) => {
    if (f.startsWith('js/vendor/')) return m;
    if (!jsHash.has(f)) fail(`index.html loads ${f}, which is not there`);
    return `${pre}${f}?h=${jsHash.get(f)}"`;
});
fs.writeFileSync(path.join(root, 'index.html'), html);

const build = jsHash.get('js/app.js');
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ build }) + '\n');
console.log(`fingerprinted ${files.length} modules, ${cssHash.size} stylesheets; build ${build}`);
