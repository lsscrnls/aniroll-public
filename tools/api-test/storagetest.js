// The server's data files: writes are atomic, and a file that cannot be parsed is moved aside
// instead of being treated as empty (and then overwritten with nearly nothing).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadFunctions } = require('./source');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniroll-storage-'));
let failed = 0;
const check = (name, ok, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
};
const quiet = { error: () => {}, warn: () => {}, log: () => {} };

function load(fsImpl = fs) {
    // Each load gets its own in-memory store, like a fresh server process
    return loadFunctions('api/server.js', ['ensureDataDir', 'writeFileAtomic', 'writeJson', 'readJson'],
        { fs: fsImpl, path, crypto, process, console: quiet, DATA_DIR: dir, stores: new Map() });
}

const s = load();
const tokens = path.join(dir, 'tokens.json');

s.writeJson(tokens, { 1: { tokenEnc: 'abc' } }, { mode: 0o600 });
check('round trip', s.readJson(tokens)[1].tokenEnc === 'abc', s.readJson(tokens));
check('secret files are 0600', (fs.statSync(tokens).mode & 0o777) === 0o600, (fs.statSync(tokens).mode & 0o777).toString(8));
check('missing file reads as empty', Object.keys(s.readJson(path.join(dir, 'nothing.json'))).length === 0);

// A write that dies halfway: the old file must survive, no temp file left behind
const crashing = { ...fs, writeSync: (fd, text) => {
    fs.writeSync(fd, String(text).slice(0, 5));
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
} };
const c = load(crashing);
let threw = false;
try { c.writeJson(tokens, { 1: { tokenEnc: 'new' }, 2: { tokenEnc: 'other' } }, { mode: 0o600 }); } catch { threw = true; }
check('failed write reports the error', threw);
check('failed write leaves the old file intact', load().readJson(tokens)[1]?.tokenEnc === 'abc', fs.readFileSync(tokens, 'utf8'));
check('failed write leaves no temp file', !fs.readdirSync(dir).some(f => f.includes('.tmp-')), fs.readdirSync(dir));

// A file that is broken anyway (e.g. copied in by hand): moved aside, content kept
fs.writeFileSync(tokens, '{"1": {"tokenEnc": "ab');
const fresh = load();
const read = fresh.readJson(tokens);
const aside = fs.readdirSync(dir).find(f => f.startsWith('tokens.json.corrupt-'));
check('unreadable file reads as empty', Object.keys(read).length === 0, read);
check('unreadable file moved aside with its content', aside && fs.readFileSync(path.join(dir, aside), 'utf8').startsWith('{"1"'), fs.readdirSync(dir));
fresh.writeJson(tokens, {}, { mode: 0o600 });
check('the next save does not destroy the moved copy', fs.existsSync(path.join(dir, aside)));

// Any other read error must not look like an empty store: the next save would wipe the file
fs.writeFileSync(tokens, '{"1":{"tokenEnc":"keep"}}');
const denied = load({ ...fs, readFileSync: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } });
let deniedThrew = false;
try { denied.readJson(tokens); } catch { deniedThrew = true; }
check('a file that cannot be read throws instead of reading as empty', deniedThrew);
check('the unreadable file is left alone', fs.readFileSync(tokens, 'utf8').includes('keep'));

// One shared object per file: a request that loaded before another one saved still saves both changes
const shared = load();
const a = shared.readJson(tokens);
const b = shared.readJson(tokens);
a.x = 1;
shared.writeJson(tokens, a, { mode: 0o600 });
b.y = 2;
shared.writeJson(tokens, b, { mode: 0o600 });
const onDisk = JSON.parse(fs.readFileSync(tokens, 'utf8'));
check('saves after an await keep the other request\'s change', onDisk.x === 1 && onDisk.y === 2, onDisk);

fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
