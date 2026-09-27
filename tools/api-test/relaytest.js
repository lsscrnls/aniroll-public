// The Jellyfin relay must never reach private addresses, also not through DNS rebinding:
// a name that looks public when checked and points to 127.0.0.1 when connecting.
// DNS is stubbed; the real http module makes the connection.
const http = require('http');
const https = require('https');
const net = require('net');
const { loadFunctions } = require('./source');

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
};

// A resolver that answers from a table, like dns.lookup(host, { all: true }, cb)
function stubDns(table) {
    return { lookup: (host, opts, cb) => setImmediate(() => (table[host] ? cb(null, table[host]) : cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })))) };
}
const v4 = (...ips) => ips.map(address => ({ address, family: net.isIPv6(address) ? 6 : 4 }));

function load(table, isPrivateOverride) {
    const names = ['publicLookup', 'relayRequest', 'RELAY_MAX_BYTES'];
    const ctx = { http, https, net, dnsCallback: stubDns(table), Buffer, setTimeout, clearTimeout, setImmediate, Error };
    if (isPrivateOverride) ctx.isPrivateIp = isPrivateOverride;
    else names.unshift('isPrivateIp');
    return loadFunctions('api/server.js', names, ctx);
}

(async () => {
    const { isPrivateIp } = load({});
    const privateIps = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.1',
        '198.18.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1'];
    const publicIps = ['93.184.216.34', '1.1.1.1', '100.63.255.1', '100.128.0.1', '172.32.0.1', '2606:4700::1111'];
    const wrongPrivate = privateIps.filter(ip => !isPrivateIp(ip));
    const wrongPublic = publicIps.filter(ip => isPrivateIp(ip));
    check('private and special ranges refused', !wrongPrivate.length, wrongPrivate);
    check('public addresses allowed', !wrongPublic.length, wrongPublic);

    // Rebinding: the name resolves to loopback when the relay connects
    const rebound = load({ 'jellyfin.example': v4('127.0.0.1') });
    const err = await rebound.relayRequest(new URL('http://jellyfin.example:3999/System/Info'), 'GET', {}).catch(e => e);
    check('connection to a name that resolves to 127.0.0.1 refused', err && err.code === 'EPRIVATE', err && err.message);
    const mixed = load({ 'jellyfin.example': v4('93.184.216.34', '10.0.0.5') });
    const mixedErr = await mixed.relayRequest(new URL('http://jellyfin.example/System/Info'), 'GET', {}).catch(e => e);
    check('one private address among public ones refused', mixedErr && mixedErr.code === 'EPRIVATE', mixedErr && mixedErr.message);

    // The request itself, against a local stand-in for Jellyfin (loopback counts as public here)
    let seenAuth = null;
    const server = http.createServer((req, res) => {
        seenAuth = req.headers.authorization;
        if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/' }); return res.end(); }
        if (req.url === '/big') { res.writeHead(200); res.write('x'.repeat(400000)); return res.end(); }
        if (req.url === '/slow') return; // never answers
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ServerName: 'Test' }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const open = load({ 'jellyfin.example': v4('127.0.0.1') }, () => false);
    const url = (p) => new URL(`http://jellyfin.example:${port}${p}`);

    const ok = await open.relayRequest(url('/System/Info'), 'GET', { Authorization: 'MediaBrowser Token="k"' });
    check('answer and status come through', ok.status === 200 && JSON.parse(ok.text).ServerName === 'Test' && seenAuth === 'MediaBrowser Token="k"', ok);
    const redirect = await open.relayRequest(url('/redirect'), 'GET', {});
    check('redirects are not followed', redirect.status === 302, redirect);
    const big = await open.relayRequest(url('/big'), 'GET', {});
    check('answer capped at 256 KB', big.text.length === open.RELAY_MAX_BYTES, big.text.length);
    const started = Date.now();
    const slow = await open.relayRequest(url('/slow'), 'GET', {}).catch(e => e);
    check('gives up after 8 s', slow instanceof Error && Date.now() - started < 9500, slow && slow.message);

    server.close();
    server.closeAllConnections();
    process.exitCode = results.every(Boolean) ? 0 : 1;
})().catch(e => { console.error(e); process.exit(1); });
