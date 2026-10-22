// @ts-check
// Passkeys for VIPs (api/passkeys.js): signing in while AniList's own login is down.
// Made while signed in: AniRoll's server keeps your AniList token sealed with its own key, so the passkey works in
// every browser and app your password manager reaches. Passkeys from before sealed it with the passkey's PRF in
// the browser instead; signing in with one where PRF works turns it into the new kind. Shown to VIPs only: the
// passkey card in Settings, a one-time note, and the sign-in on the landing page of a browser a VIP used before
// (or #/passkey).
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

async function unseal(prf, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(blob.iv) }, await sealKey(prf), fromB64u(blob.ct));
    return new TextDecoder().decode(pt);
}

const prfOf = (cred) => /** @type {any} */ (cred).getClientExtensionResults?.()?.prf;
// A passkey from before whose PRF this browser or app doesn't get
const NO_PRF = 'This older passkey only opens in the browser you made it in. Sign in with it there once (or make a new one in Settings), then it works everywhere.';

/** @returns {Promise<{ vip: boolean, passkeys: { id: string, label: string, created: number, used: number | null, current: boolean, sealed: 'passkey' | 'server' }[] }>} */
export function listPasskeys() {
    return call('/api/passkey', { method: 'GET' });
}

export function renamePasskey(id, label) {
    return call('/api/passkey', { method: 'PATCH', body: { id, label } });
}

export function removePasskey(id) {
    return call(`/api/passkey?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// A first name for a new passkey, until the user gives it one: where it was made
export function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return browser ? `${os}, ${browser}` : os;
}

// Makes a passkey for the account signed in now; the server seals its token. Resolves the passkey's id
export async function addPasskey(label = deviceLabel()) {
    if (!getToken()) throw new Error('Sign in first');
    const start = await call('/api/passkey/start', { body: { mode: 'register' } });
    const cred = /** @type {any} */ (await navigator.credentials.create({ publicKey: /** @type {any} */ ({
        challenge: fromB64u(start.challenge),
        rp: { id: start.rpId, name: 'AniRoll' },
        user: { id: fromB64u(start.user.id), name: start.user.name, displayName: start.user.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: (start.exclude || []).map(id => ({ type: 'public-key', id: fromB64u(id) })),
        attestation: 'none',
    }) }));
    if (!cred) throw new Error('No passkey was made');
    const response = cred.response;
    const publicKey = response.getPublicKey?.();
    if (!publicKey || !response.getAuthenticatorData) throw new Error('This browser can’t hand over the passkey, try another one');
    const id = b64u(cred.rawId);
    await call('/api/passkey/register', { body: {
        id, publicKey: b64u(publicKey), alg: response.getPublicKeyAlgorithm(),
        clientDataJSON: b64u(response.clientDataJSON), authenticatorData: b64u(response.getAuthenticatorData()), label,
    } });
    return id;
}

// The passkey keeps the login you had when it was made: this puts the current one in instead (and turns a
// passkey from before into one that works everywhere)
export async function resealPasskey(id) {
    if (!getToken()) throw new Error('Sign in first');
    await call('/api/passkey/reseal', { body: { id } });
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
    // A passkey from before, opened with its PRF: from now on the server keeps the login, so the same passkey
    // works in every browser and app
    if (!answer.token) await resealPasskey(b64u(cred.rawId)).catch(() => { /* next time */ });
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
