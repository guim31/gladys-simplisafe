// -----------------------------------------------------------------------------
// The SimpliSafe sign-in: OAuth2 authorization code with PKCE, the way the
// SimpliSafe iOS app signs in (Auth0 tenant auth.simplisafe.com), as
// bachya/simplisafe-python (MIT) does it in simplipy/util/auth.py.
//
// There is no callback Gladys could receive: the sign-in page sends the
// browser to `com.simplisafe.mobile://…/callback?code=…`, an address only the
// mobile app opens. The browser shows nothing, but the address appears in its
// developer tools (console or network tab). The user pastes the line, the
// address or the code alone in the "Finish the sign-in" action: the code is
// taken out of whatever was pasted (extractCode).
// -----------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const AUTH_HOST = 'auth.simplisafe.com';
export const AUTH_BASE = `https://${AUTH_HOST}`;

// The identity of the iOS app, public and identical in every client of the
// SimpliSafe API (simplisafe-python, Home Assistant, homebridge-simplisafe3).
export const CLIENT_ID = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
export const REDIRECT_URI =
  'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const AUTH0_CLIENT =
  'eyJ2ZXJzaW9uIjoiMi4zLjIiLCJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsic3dpZnQiOiI1LngiLCJpT1MiOiIxNi4zIn19';
const SCOPE = 'offline_access email openid https://api.simplisafe.com/scopes/user:platform';
const AUDIENCE = 'https://api.simplisafe.com/';

const base64url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A PKCE code verifier: 43 to 128 unreserved characters (RFC 7636). */
export function newCodeVerifier() {
  return base64url(randomBytes(40));
}

/** The S256 challenge of a verifier (RFC 7636, section 4.2). */
export function codeChallenge(verifier) {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** A device id for the sign-in page, drawn once per installation. */
export const newDeviceId = () => randomUUID().toUpperCase();

/**
 * The address of the SimpliSafe sign-in page.
 * @param {{ verifier: string, deviceId: string }} flow
 */
export function authorizeUrl({ verifier, deviceId }) {
  const params = new URLSearchParams({
    audience: AUDIENCE,
    auth0Client: AUTH0_CLIENT,
    client_id: CLIENT_ID,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
    device: 'iPhone',
    device_id: deviceId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

// An authorization code of the SimpliSafe tenant: 45 URL-safe characters
// today (Home Assistant checks that length); a range leaves room for change.
const BARE_CODE = /^[A-Za-z0-9_-]{20,128}$/;
const IN_ADDRESS = /(?:^|[?&\s])code=([^&#\s'"“”‘’<>]+)/;

/**
 * The authorization code of a pasted text, `null` when none is found.
 * Accepts the console line ("Failed to launch 'com.simplisafe.mobile://…'"),
 * the address, or the code alone (with the "=" of the address, quotes or
 * spaces around it).
 * @param {unknown} pasted
 */
export function extractCode(pasted) {
  const text = String(pasted ?? '').trim();
  if (!text) return null;
  const match = text.match(IN_ADDRESS);
  let code = match ? match[1] : text.replace(/^["'“”‘’=]+|["'“”‘’.]+$/g, '');
  try {
    code = decodeURIComponent(code);
  } catch {
    return null;
  }
  return BARE_CODE.test(code) ? code : null;
}
