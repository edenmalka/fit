// "Sign in with Hugging Face" for a static site (OAuth with PKCE, no secret needed).
// The sign-in token stays in this browser only and is sent only to Hugging Face.

import { HF_CLIENT_ID, HF_SCOPES } from './config.js';

const HUB = 'https://huggingface.co';
const KEY = 'fit:hf-session';
const PENDING = 'fit:hf-pending';

// Always the canonical .../admin.html address, so it matches the one registered on Hugging Face
// even if the page was opened as .../admin (GitHub Pages serves both).
const redirectUrl = () => new URL('admin.html', location.href).href.split(/[?#]/)[0];

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isConfigured() { return !!HF_CLIENT_ID; }

/** Sends the browser to Hugging Face's sign-in page. */
export async function signIn() {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  localStorage.setItem(PENDING, JSON.stringify({ verifier, nonce }));
  const params = new URLSearchParams({
    client_id: HF_CLIENT_ID,
    scope: HF_SCOPES,
    response_type: 'code',
    redirect_uri: redirectUrl(),
    state: nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.assign(`${HUB}/oauth/authorize?${params}`);
}

/**
 * Call on page load. If we just came back from Hugging Face, finishes the sign-in.
 * Returns the current session { token, expiresAt, user: {name, username, picture} } or null.
 */
export async function restoreSession() {
  const q = new URLSearchParams(location.search);
  if (q.has('code') || q.has('error')) {
    const pending = JSON.parse(localStorage.getItem(PENDING) || 'null');
    localStorage.removeItem(PENDING);
    history.replaceState(null, '', redirectUrl()); // clean the address bar
    if (q.has('error')) throw new Error(q.get('error_description') || q.get('error'));
    if (!pending || pending.nonce !== q.get('state')) throw new Error('sign-in state mismatch');

    const res = await fetch(`${HUB}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: q.get('code'),
        redirect_uri: redirectUrl(),
        code_verifier: pending.verifier,
        client_id: HF_CLIENT_ID,
      }),
    });
    if (!res.ok) throw new Error('token exchange failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const tok = await res.json();

    const info = await (await fetch(`${HUB}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })).json();

    const session = {
      token: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
      user: { name: info.name, username: info.preferred_username, picture: info.picture, isPro: !!info.isPro },
    };
    localStorage.setItem(KEY, JSON.stringify(session));
    return session;
  }

  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && saved.expiresAt > Date.now() + 60_000) return saved;
  localStorage.removeItem(KEY);
  return null;
}

export function signOut() { localStorage.removeItem(KEY); }
