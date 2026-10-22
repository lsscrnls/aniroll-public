// Passkeys for VIPs (js/passkeys.js): a way in while AniList's own login is down.
//   GET    /api/passkey             yours, and whether you may add one (VIPs only)
//   PATCH  /api/passkey             { id, label }: a name of your own
//   POST   /api/passkey/start       a challenge, for { mode: 'register' } (signed in, VIP) or { mode: 'login' }
//   POST   /api/passkey/register    a new passkey: its public key; your AniList token is sealed here
//   POST   /api/passkey/login       a signed challenge -> who you are and your token
//   POST   /api/passkey/reseal      the same passkey, sealing the token you are signed in with now
//   DELETE /api/passkey?id=         removes one of yours
// The token is sealed with a key the server keeps for passkeys alone (server.js passkeySeal: a root-only file
// mounted read-only, not the Jellyfin key, not in the data or its backups), so a passkey works in every browser
// and app its password manager reaches (2026-10-22: sealing in the browser with the passkey's PRF failed in
// Firefox and the iPhone app of the same Proton Pass passkey). Passkeys from before may still hold a PRF-sealed
// blob: login hands it back as before, and the browser turns it into a server-sealed one (reseal) right after.
// Signing in with the passkey puts that token's hash among the known viewers (server.js), so Jellyfin, parties
// and seats accept it while AniList cannot be asked.
// No CBOR: the browser hands over the public key as SPKI (getPublicKey) and the authenticator data as is.
const crypto = require('crypto');
const path = require('path');

const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const MAX_PER_USER = 5;
const RP_PROD = 'aniroll.app';
const ALGS = new Set([-7, -8, -257]); // ES256, EdDSA, RS256

module.exports = function passkeys({ dataDir, readJson, writeJson, json, readBody, overLimit, clientIp, verifyViewer, refuseAuth,
    isVip, tokenHash, bearerToken, rememberViewer, allowedOrigin, isLocalOrigin, str, passkeySeal, passkeyOpen, decryptSecret }) {
    const file = path.join(dataDir, 'passkeys.json');
    const challenges = new Map(); // challenge -> { mode, userId, rpId, at }

    const load = () => readJson(file);
    const save = (all) => writeJson(file, all, { pretty: false, mode: 0o600 });
    // Logins sealed with the Jellyfin key (passkeys made before the passkey key existed) move to the passkey key
    // once, when the server starts. `sk: 2`: sealed with the passkey key
    if (passkeySeal) {
        const all = load();
        let moved = 0;
        for (const c of Object.values(all)) {
            if (!c.sealed || c.sk === 2) continue;
            const token = decryptSecret(c.sealed);
            if (!token) continue;
            c.sealed = passkeySeal(token);
            c.sk = 2;
            moved++;
        }
        if (moved) { save(all); console.log(`passkeys: ${moved} login(s) moved to the passkey key`); }
    }
    const seal = (token) => ({ sealed: passkeySeal(token), sk: 2 });

    const b64u = (v) => typeof v === 'string' && v.length < 20000 && /^[A-Za-z0-9_-]*$/.test(v) ? Buffer.from(v, 'base64url') : null;

    // The site the browser says it is on decides the passkey's domain: aniroll.app, or localhost for a dev server
    function rpFor(req) {
        const origin = String(req.headers.origin || '');
        if (origin === allowedOrigin) return { origin, rpId: RP_PROD };
        if (isLocalOrigin(origin)) return { origin, rpId: new URL(origin).hostname };
        return null;
    }

    function newChallenge(mode, rpId, userId = null) {
        const now = Date.now();
        for (const [c, v] of challenges) if (now - v.at > CHALLENGE_TTL_MS) challenges.delete(c);
        if (challenges.size > 2000) return null;
        const challenge = crypto.randomBytes(32).toString('base64url');
        challenges.set(challenge, { mode, rpId, userId, at: now });
        return challenge;
    }

    // clientDataJSON and authenticatorData of either ceremony, checked against a challenge this server gave out.
    // Each challenge counts once. -> { authData, clientData, ch } | { error }
    function checkCeremony(body, type, rp) {
        const clientData = b64u(body.clientDataJSON);
        const authData = b64u(body.authenticatorData);
        if (!clientData || !authData || authData.length < 37) return { error: 'Incomplete answer from the passkey' };
        let cd;
        try { cd = JSON.parse(clientData.toString('utf8')); } catch { return { error: 'Incomplete answer from the passkey' }; }
        const ch = challenges.get(String(cd.challenge || ''));
        if (!ch) return { error: 'This sign-in took too long, try again' };
        challenges.delete(cd.challenge);
        if (cd.type !== type || cd.origin !== rp.origin || ch.rpId !== rp.rpId) return { error: 'The passkey answered for another site' };
        if (!authData.subarray(0, 32).equals(crypto.createHash('sha256').update(rp.rpId).digest())) return { error: 'The passkey answered for another site' };
        // User present and verified (PIN, fingerprint, face): a passkey alone, without its owner, is not enough
        if ((authData[32] & 0x05) !== 0x05) return { error: 'The passkey did not confirm it is you' };
        return { authData, clientData, ch };
    }

    function verifySignature(cred, authData, clientData, signature) {
        try {
            const key = crypto.createPublicKey({ key: Buffer.from(cred.pk, 'base64'), format: 'der', type: 'spki' });
            const data = Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()]);
            if (cred.alg === -8) return crypto.verify(null, data, key, signature);
            if (cred.alg === -7) return crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
            return crypto.verify('sha256', data, key, signature);
        } catch { return false; }
    }

    const listFor = (all, userId, current) => Object.entries(all).filter(([, c]) => c.userId === userId)
        .map(([id, c]) => ({ id, label: c.label, created: c.created, used: c.used || null, current: c.tokenHash === current, sealed: c.sealed ? 'server' : 'passkey' }))
        .sort((a, b) => a.created - b.created);

    async function handle(req, res, pathname) {
        const rp = rpFor(req);

        if (pathname === '/api/passkey' && req.method === 'GET') {
            const auth = await verifyViewer(req);
            if (auth.status !== 'ok') return refuseAuth(res, auth);
            return json(res, 200, { vip: isVip(auth.viewer.id), passkeys: listFor(load(), auth.viewer.id, tokenHash(bearerToken(req))) });
        }

        if (pathname === '/api/passkey' && req.method === 'DELETE') {
            const auth = await verifyViewer(req);
            if (auth.status !== 'ok') return refuseAuth(res, auth);
            const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
            const all = load();
            if (!Object.hasOwn(all, id) || all[id].userId !== auth.viewer.id) return json(res, 404, { error: 'No such passkey' });
            delete all[id];
            save(all);
            return json(res, 200, { ok: true });
        }

        // A name of the user's own choosing
        if (pathname === '/api/passkey' && req.method === 'PATCH') {
            const auth = await verifyViewer(req);
            if (auth.status !== 'ok') return refuseAuth(res, auth);
            const body = await readBody(req);
            const id = typeof body.id === 'string' ? body.id : '';
            const label = str(body.label, 60).trim();
            const all = load();
            if (!Object.hasOwn(all, id) || all[id].userId !== auth.viewer.id) return json(res, 404, { error: 'No such passkey' });
            if (!label) return json(res, 400, { error: 'Give it a name' });
            all[id] = { ...all[id], label };
            save(all);
            return json(res, 200, { ok: true });
        }

        if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
        if (!rp) return json(res, 403, { error: 'Passkeys work on aniroll.app only' });
        if (overLimit('passkey-ip', clientIp(req), 20, 60000)) return json(res, 429, { error: 'Too many tries, wait a minute' });
        const body = await readBody(req);

        if (!passkeySeal && (pathname === '/api/passkey/register' || pathname === '/api/passkey/reseal' || body.mode === 'register')) {
            return json(res, 503, { error: 'Passkeys are switched off on this server right now' });
        }

        if (pathname === '/api/passkey/start') {
            if (body.mode === 'login') {
                const challenge = newChallenge('login', rp.rpId);
                return challenge ? json(res, 200, { challenge, rpId: rp.rpId }) : json(res, 503, { error: 'Busy, try again in a minute' });
            }
            if (body.mode !== 'register') return json(res, 400, { error: 'Unknown mode' });
            const auth = await verifyViewer(req);
            if (auth.status !== 'ok') return refuseAuth(res, auth);
            if (!isVip(auth.viewer.id)) return json(res, 403, { error: 'Passkeys are for VIPs' });
            const all = load();
            const mine = Object.keys(all).filter(id => all[id].userId === auth.viewer.id);
            if (mine.length >= MAX_PER_USER) return json(res, 400, { error: `${MAX_PER_USER} passkeys at most, remove one first` });
            const challenge = newChallenge('register', rp.rpId, auth.viewer.id);
            if (!challenge) return json(res, 503, { error: 'Busy, try again in a minute' });
            return json(res, 200, {
                challenge, rpId: rp.rpId, exclude: mine,
                // The passkey's user handle: not the AniList id itself, nothing the authenticator shows or tells
                user: { id: crypto.createHash('sha256').update(`aniroll:${auth.viewer.id}`).digest('base64url').slice(0, 32), name: auth.viewer.name },
            });
        }

        if (pathname === '/api/passkey/register') {
            const auth = await verifyViewer(req);
            if (auth.status !== 'ok') return refuseAuth(res, auth);
            if (!isVip(auth.viewer.id)) return json(res, 403, { error: 'Passkeys are for VIPs' });
            const c = checkCeremony(body, 'webauthn.create', rp);
            if (c.error) return json(res, 400, { error: c.error });
            if (c.ch.mode !== 'register' || c.ch.userId !== auth.viewer.id) return json(res, 400, { error: 'This sign-in took too long, try again' });
            const id = typeof body.id === 'string' ? body.id : '';
            const rawId = b64u(id);
            const pk = b64u(body.publicKey);
            const alg = Number(body.alg);
            if (!rawId || rawId.length < 16 || rawId.length > 1023 || !pk || pk.length > 2000 || !ALGS.has(alg)) return json(res, 400, { error: 'This passkey cannot be used here' });
            // The credential the authenticator says it made (attested data: AAGUID, id length, id) must be the one sent
            const ad = c.authData;
            if (!(ad[32] & 0x40) || ad.length < 55 || ad.readUInt16BE(53) !== rawId.length || !ad.subarray(55, 55 + rawId.length).equals(rawId)) {
                return json(res, 400, { error: 'This passkey cannot be used here' });
            }
            try { crypto.createPublicKey({ key: pk, format: 'der', type: 'spki' }); } catch { return json(res, 400, { error: 'This passkey cannot be used here' }); }
            const all = load();
            if (Object.hasOwn(all, id)) return json(res, 400, { error: 'This passkey is already there' });
            if (Object.keys(all).filter(k => all[k].userId === auth.viewer.id).length >= MAX_PER_USER) return json(res, 400, { error: `${MAX_PER_USER} passkeys at most, remove one first` });
            all[id] = {
                userId: auth.viewer.id, name: str(auth.viewer.name, 40), avatar: str(auth.viewer.avatar?.medium, 500),
                pk: pk.toString('base64'), alg, rpId: rp.rpId, tokenHash: tokenHash(bearerToken(req)),
                ...seal(bearerToken(req)),
                label: str(body.label, 60).trim() || 'Passkey', created: Date.now(), used: null,
            };
            save(all);
            return json(res, 200, { ok: true, id });
        }

        if (pathname === '/api/passkey/reseal') {
            const auth = await verifyViewer(req);
            if (auth.status !== 'ok') return refuseAuth(res, auth);
            const all = load();
            const id = typeof body.id === 'string' ? body.id : '';
            if (!Object.hasOwn(all, id) || all[id].userId !== auth.viewer.id) return json(res, 404, { error: 'No such passkey' });
            // Also turns a passkey from before (its login sealed by the passkey's PRF) into one that works everywhere
            const { blob: _old, sealed: _oldSealed, sk: _oldSk, ...rest } = all[id];
            all[id] = { ...rest, ...seal(bearerToken(req)), tokenHash: tokenHash(bearerToken(req)) };
            save(all);
            return json(res, 200, { ok: true });
        }

        if (pathname === '/api/passkey/login') {
            const c = checkCeremony(body, 'webauthn.get', rp);
            if (c.error) return json(res, 400, { error: c.error });
            if (c.ch.mode !== 'login') return json(res, 400, { error: 'This sign-in took too long, try again' });
            const all = load();
            const id = typeof body.id === 'string' ? body.id : '';
            const cred = Object.hasOwn(all, id) ? all[id] : null;
            const signature = b64u(body.signature);
            if (!cred || cred.rpId !== rp.rpId) return json(res, 404, { error: 'AniRoll does not know this passkey (removed?)' });
            if (!signature || !verifySignature(cred, c.authData, c.clientData, signature)) return json(res, 400, { error: 'The passkey’s answer did not check out' });
            if (!isVip(cred.userId)) return json(res, 403, { error: 'Passkeys are for VIPs' });
            all[id] = { ...cred, used: Date.now() };
            save(all);
            const viewer = { id: cred.userId, name: cred.name, avatar: { medium: cred.avatar } };
            rememberViewer(cred.tokenHash, viewer);
            if (cred.sealed) {
                const token = cred.sk === 2 ? passkeyOpen?.(cred.sealed) : decryptSecret(cred.sealed);
                if (!token) return json(res, 500, { error: 'AniRoll can’t open this passkey’s login any more. Remove it and make a new one.' });
                return json(res, 200, { viewer, token });
            }
            return json(res, 200, { viewer, blob: cred.blob });
        }

        return json(res, 404, { error: 'Not found' });
    }

    // "Delete my data": every passkey of the account
    function forgetUser(userId) {
        const all = load();
        const ids = Object.keys(all).filter(id => all[id].userId === userId);
        if (!ids.length) return;
        ids.forEach(id => delete all[id]);
        save(all);
    }

    return { handle, forgetUser };
};
