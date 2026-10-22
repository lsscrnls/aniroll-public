// @ts-check
// Passkeys for VIPs (api/passkeys.js): signing in while AniList's own login is down.
// Made while signed in: the passkey seals your AniList token with a key only it can give (WebAuthn PRF), and
// AniRoll's server keeps the sealed token. Signing in with the passkey later, on any device, opens it again here
// in the browser; the server never sees the token itself. A passkey without PRF (Proton Pass on an iPhone) has
// the server seal it with its own key instead. Shown to VIPs only: the passkey card in Settings,
// a one-time note, and the sign-in on the landing page of a browser a VIP used before (or #/passkey).
import { getToken, setToken, setCachedUser } from './auth.js';
import { rememberAccount } from './accounts.js';

const INFO = new TextEncoder().encode('aniroll passkey token v1');
// The same salt for every passkey: what it gives back still differs per passkey, and sign-in must work
// before AniRoll knows which passkey it is
// (asked when needed: crypto.subtle is missing outside https, and this module is loaded by the start page)
const salt = async () => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('AniRoll passkey login v1')));

export const passkeysSupported = () => typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.create && !!window.crypto?.subtle;
export const vipDevice = () => { try { return localStorage.getItem('aniroll_vip_device') === '1'; } catch { return false; } };

const b64u = (/** @type {ArrayBuffer | Uint8Array} */ buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (/** @type {string} */ s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function call(path, { method = 'POST', body = undefined, auth = true } = {}) {
    const token = getToken();
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `AniRoll answered ${res.status}`);
    return data;
}

async function sealKey(/** @type {ArrayBuffer} */ prf) {
    const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(prf, token) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(prf), new TextEncoder().encode(token));
    return { iv: b64u(iv), ct: b64u(ct) };
}

async function unseal(prf, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(blob.iv) }, await sealKey(prf), fromB64u(blob.ct));
    return new TextDecoder().decode(pt);
}

const prfOf = (cred) => /** @type {any} */ (cred).getClientExtensionResults?.()?.prf;
const NO_PRF = 'This passkey can’t open your login. Remove it in Settings and make a new one.';

// Asks the passkey once more, for its PRF answer (some only give it when signing in, not when made)
async function prfFor(rpId, credentialId = null) {
    const prfSalt = await salt();
    const cred = await navigator.credentials.get({ publicKey: /** @type {any} */ ({
        challenge: crypto.getRandomValues(new Uint8Array(32)), rpId, userVerification: 'required',
        allowCredentials: credentialId ? [{ type: 'public-key', id: fromB64u(credentialId) }] : [],
        extensions: { prf: { eval: { first: prfSalt } } },
    }) });
    const first = prfOf(cred)?.results?.first;
    if (!first) throw new Error(NO_PRF);
    return { cred, first };
}

/** @returns {Promise<{ vip: boolean, passkeys: { id: string, label: string, created: number, used: number | null, current: boolean, sealed: 'passkey' | 'server' }[] }>} */
export function listPasskeys() {
    return call('/api/passkey', { method: 'GET' });
}

export function removePasskey(id) {
    return call(`/api/passkey?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return browser ? `${os}, ${browser}` : os;
}

// Makes a passkey for the account signed in now and seals its token with it
export async function addPasskey() {
    const token = getToken();
    if (!token) throw new Error('Sign in first');
    const start = await call('/api/passkey/start', { body: { mode: 'register' } });
    const prfSalt = await salt();
    const cred = /** @type {any} */ (await navigator.credentials.create({ publicKey: /** @type {any} */ ({
        challenge: fromB64u(start.challenge),
        rp: { id: start.rpId, name: 'AniRoll' },
        user: { id: fromB64u(start.user.id), name: start.user.name, displayName: start.user.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: (start.exclude || []).map(id => ({ type: 'public-key', id: fromB64u(id) })),
        attestation: 'none',
        extensions: { prf: { eval: { first: prfSalt } } },
    }) }));
    if (!cred) throw new Error('No passkey was made');
    const response = cred.response;
    const publicKey = response.getPublicKey?.();
    if (!publicKey || !response.getAuthenticatorData) throw new Error('This browser can’t hand over the passkey, try another one');
    // PRF said yes but gave nothing yet: one more touch for it. Said no, or nothing at all: the server seals it
    const prf = prfOf(cred);
    let first = prf?.results?.first || null;
    if (!first && prf?.enabled === true) first = await prfFor(start.rpId, b64u(cred.rawId)).then(r => r.first, err => {
        if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') throw err;
        return null;
    });
    await call('/api/passkey/register', { body: {
        id: b64u(cred.rawId), publicKey: b64u(publicKey), alg: response.getPublicKeyAlgorithm(),
        clientDataJSON: b64u(response.clientDataJSON), authenticatorData: b64u(response.getAuthenticatorData()),
        ...(first ? { blob: await seal(first, token) } : { serverSeal: true }), label: deviceLabel(),
    } });
}

// The passkey keeps the login you had when it was made: this puts the current one in instead
export async function resealPasskey(id, server = false) {
    const token = getToken();
    if (!token) throw new Error('Sign in first');
    // Sealed by the server: it takes the login you are signed in with, no passkey needed
    if (server) return void await call('/api/passkey/reseal', { body: { id } });
    const rpId = location.hostname;
    const { first } = await prfFor(rpId, id);
    await call('/api/passkey/reseal', { body: { id, blob: await seal(first, token) } });
}

// Signs in with a passkey: who it belongs to and the sealed token from the server, opened here
export async function signInWithPasskey() {
    const start = await call('/api/passkey/start', { body: { mode: 'login' }, auth: false });
    const prfSalt = await salt();
    const cred = /** @type {any} */ (await navigator.credentials.get({ publicKey: /** @type {any} */ ({
        challenge: fromB64u(start.challenge), rpId: start.rpId, userVerification: 'required', allowCredentials: [],
        extensions: { prf: { eval: { first: prfSalt } } },
    }) }));
    if (!cred) throw new Error('No passkey was chosen');
    const first = prfOf(cred)?.results?.first;
    const answer = await call('/api/passkey/login', { auth: false, body: {
        id: b64u(cred.rawId), clientDataJSON: b64u(cred.response.clientDataJSON),
        authenticatorData: b64u(cred.response.authenticatorData), signature: b64u(cred.response.signature),
    } });
    let token = answer.token || null;
    if (!token) {
        if (!first) throw new Error(NO_PRF);
        try { token = await unseal(first, answer.blob); } catch { throw new Error(NO_PRF); }
    }
    setToken(token);
    // What the server knows of the account; AniList fills in the rest once it answers (the cache is "old")
    setCachedUser({ id: answer.viewer.id, name: answer.viewer.name, avatar: { large: answer.viewer.avatar?.medium, medium: answer.viewer.avatar?.medium } });
    try {
        localStorage.setItem('aniroll_user_ts', '0');
        localStorage.setItem('aniroll_vip_device', '1');
    } catch { /* fine */ }
    rememberAccount(answer.viewer);
    window.location.hash = '/';
    window.location.reload();
}
