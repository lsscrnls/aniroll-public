// First load: index.html asks for every module app.js and Home import up front (modulepreload). One that is
// missing is only found once the module above it arrived, a round trip later for everything after it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]));

// Every module a file imports statically, and theirs, as index.html names them
function staticImports(file, seen = new Map()) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm)) {
        const spec = m[1] || m[2];
        const [rel, query] = spec.split('?');
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
        if (seen.has(target)) continue;
        seen.set(target, query ? `${target}?${query}` : target);
        staticImports(target, seen);
    }
    return seen;
}

for (const entry of ['js/app.js', 'js/pages/home.js']) {
    test(`index.html preloads every module ${entry} imports`, () => {
        const missing = [...staticImports(entry).values()].filter(url => !preloaded.has(url));
        assert.deepEqual(missing, []);
    });
}

test('index.html preloads Home itself', () => {
    const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
    const home = app.match(/import\('\.\/(pages\/home\.js)'\)/)[1];
    assert.ok(preloaded.has(`js/${home}`), `js/${home}`);
});
