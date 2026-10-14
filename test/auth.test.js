// -----------------------------------------------------------------------------
// The sign-in: PKCE verifier and challenge (RFC 7636), the address of the
// SimpliSafe sign-in page, and the code taken out of whatever the user pastes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_ID,
  REDIRECT_URI,
  authorizeUrl,
  codeChallenge,
  extractCode,
  newCodeVerifier,
  newDeviceId,
} from '../src/simplisafe/auth.js';

const CODE = 'q3Zr8Xw1Kp0Lm7Nb2Vc9Hd4Js6Fg5Ta1Ye8Ui3Op0As7';

test('the S256 challenge follows RFC 7636 (appendix B)', () => {
  assert.equal(
    codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('a verifier is 43 to 128 unreserved characters, new each time', () => {
  const verifier = newCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(newCodeVerifier(), verifier);
  assert.match(newDeviceId(), /^[0-9A-F-]{36}$/);
});

test('the sign-in page is the one of the SimpliSafe iOS app, with the challenge', () => {
  const verifier = newCodeVerifier();
  const url = new URL(authorizeUrl({ verifier, deviceId: 'DEVICE-ID' }));
  assert.equal(url.origin, 'https://auth.simplisafe.com');
  assert.equal(url.pathname, '/authorize');
  const params = Object.fromEntries(url.searchParams);
  assert.equal(params.client_id, CLIENT_ID);
  assert.equal(params.redirect_uri, REDIRECT_URI);
  assert.equal(params.response_type, 'code');
  assert.equal(params.code_challenge_method, 'S256');
  assert.equal(params.code_challenge, codeChallenge(verifier));
  assert.equal(params.audience, 'https://api.simplisafe.com/');
  assert.match(params.scope, /offline_access/);
  assert.equal(params.device_id, 'DEVICE-ID');
  // The verifier itself never leaves the integration.
  assert.ok(!url.toString().includes(verifier));
});

test('the code is found in whatever the user pastes', () => {
  const address = `com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback?code=${CODE}`;
  for (const pasted of [
    address,
    `  ${address}  `,
    // Chrome and Edge, console
    `Failed to launch '${address}' because the scheme does not have a registered handler.`,
    // Firefox, console
    `Prevented navigation to “${address}” due to an unknown protocol.`,
    // The network tab copies the Location header
    `location: ${address}&state=xyz`,
    // The code alone, with what the user may take along
    CODE,
    `=${CODE}`,
    `"${CODE}"`,
    `code=${encodeURIComponent(CODE)}`,
  ]) {
    assert.equal(extractCode(pasted), CODE, pasted);
  }
});

test('anything else is not a code', () => {
  for (const pasted of [
    '',
    null,
    undefined,
    'hello',
    'https://auth.simplisafe.com/u/login?state=abc',
    'code=%E0%A4%A',
    'com.simplisafe.mobile://callback?error=access_denied',
  ]) {
    assert.equal(extractCode(pasted), null, String(pasted));
  }
});
