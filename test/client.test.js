// -----------------------------------------------------------------------------
// The SimpliSafe API client against the fake cloud: the code exchange, the
// rotating refresh token handed over at every renewal, a 401 renewing once,
// one renewal at a time, and the kinds of errors the hub acts on.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeChallenge, newCodeVerifier } from '../src/simplisafe/auth.js';
import { ERROR_KINDS, SimpliSafeClient } from '../src/simplisafe/client.js';
import { CODE, FakeCloud, REFRESH_TOKEN, SID, USER_ID, fixture } from './helpers/fakeCloud.js';

function signedIn(cloud, extra = {}) {
  const saved = [];
  const client = new SimpliSafeClient({
    request: cloud.request,
    tokens: { refreshToken: REFRESH_TOKEN, userId: USER_ID },
    onTokens: (tokens) => saved.push(tokens),
    ...extra,
  });
  return { client, saved };
}

test('the code and its verifier are traded for tokens, then the user id is read', async () => {
  const cloud = new FakeCloud();
  const verifier = newCodeVerifier();
  cloud.challenge = codeChallenge(verifier);
  const saved = [];
  const client = new SimpliSafeClient({ request: cloud.request, onTokens: (t) => saved.push(t) });
  assert.equal(client.signedIn, false);
  assert.equal(await client.exchangeCode(CODE, verifier), USER_ID);
  assert.equal(client.signedIn, true);
  assert.deepEqual(saved.at(-1), { refreshToken: 'refresh-token-1', userId: USER_ID });
  // The code works once.
  const again = new SimpliSafeClient({ request: cloud.request });
  await assert.rejects(again.exchangeCode(CODE, verifier), { kind: ERROR_KINDS.BAD_CODE });
});

test('a code with another verifier is refused as a bad code', async () => {
  const cloud = new FakeCloud();
  cloud.challenge = codeChallenge(newCodeVerifier());
  const client = new SimpliSafeClient({ request: cloud.request });
  await assert.rejects(client.exchangeCode(CODE, newCodeVerifier()), {
    kind: ERROR_KINDS.BAD_CODE,
  });
  assert.equal(client.signedIn, false);
});

test('each renewal hands over the new refresh token: the old one is spent', async () => {
  let now = Date.UTC(2026, 9, 14, 12);
  const cloud = new FakeCloud();
  const { client, saved } = signedIn(cloud, { now: () => now });
  await client.subscriptions();
  assert.deepEqual(saved, [{ refreshToken: 'refresh-token-1', userId: USER_ID }]);
  assert.ok(!cloud.refreshTokens.has(REFRESH_TOKEN));
  // Within the hour: no renewal.
  now += 30 * 60_000;
  await client.subscriptions();
  assert.equal(saved.length, 1);
  // Five minutes before the end of the hour: renewed.
  now += 26 * 60_000;
  await client.subscriptions();
  assert.equal(saved.at(-1).refreshToken, 'refresh-token-2');
});

test('one renewal at a time: concurrent calls share it', async () => {
  const cloud = new FakeCloud();
  const { client, saved } = signedIn(cloud);
  await Promise.all([client.subscriptions(), client.sensors(SID), client.settings(SID)]);
  assert.equal(saved.length, 1);
  assert.equal(cloud.requests.filter((r) => r.host === 'auth.simplisafe.com').length, 1);
});

test('a 401 renews the token once and tries again', async () => {
  const cloud = new FakeCloud();
  const { client } = signedIn(cloud);
  await client.subscriptions();
  cloud.expireAccessTokens();
  const body = await client.subscriptions();
  assert.equal(body.subscriptions.length, 1);
  assert.equal(cloud.requests.filter((r) => r.host === 'auth.simplisafe.com').length, 2);
});

test('a refused refresh token is an AUTH error (sign in again)', async () => {
  const cloud = new FakeCloud();
  cloud.refreshTokens.clear();
  const { client } = signedIn(cloud);
  await assert.rejects(client.subscriptions(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.match(err.message, /Unknown or invalid refresh token/);
    return true;
  });
});

test('error kinds: rate limit, base station busy, no remote control, network', async () => {
  const cloud = new FakeCloud();
  const { client } = signedIn(cloud);
  cloud.blocked = true;
  await assert.rejects(client.subscriptions(), { kind: ERROR_KINDS.RATE_LIMITED, status: 403 });
  cloud.blocked = false;
  cloud.busy = true;
  await assert.rejects(client.sensors(SID), { kind: ERROR_KINDS.BUSY, status: 409 });
  cloud.noRemote = true;
  await assert.rejects(client.setState(SID, 'away'), { kind: ERROR_KINDS.NO_REMOTE });
  cloud.online = false;
  await assert.rejects(client.subscriptions(), { kind: ERROR_KINDS.NETWORK });
});

test('the endpoints of simplisafe-python', async () => {
  const cloud = new FakeCloud();
  const { client } = signedIn(cloud);
  await client.subscriptions();
  await client.sensors(SID);
  await client.sensors(SID, false);
  await client.settings(SID);
  await client.setState(SID, 'home');
  await client.setLock(SID, '987', 'lock');
  const api = cloud.requests
    .filter((r) => r.host === 'api.simplisafe.com')
    .map((r) => `${r.method} ${r.path}${r.query}`);
  assert.deepEqual(api, [
    `GET /v1/users/${USER_ID}/subscriptions?activeOnly=true`,
    `GET /v1/ss3/subscriptions/${SID}/sensors?forceUpdate=true`,
    `GET /v1/ss3/subscriptions/${SID}/sensors?forceUpdate=false`,
    `GET /v1/ss3/subscriptions/${SID}/settings/normal?forceUpdate=false`,
    `POST /v1/ss3/subscriptions/${SID}/state/home`,
    `POST /v1/doorlock/${SID}/987/state`,
  ]);
  assert.equal(cloud.sensor('987').status.lockState, 1);
});

test('a quoted string or a non-JSON answer does not crash the client', async () => {
  const answers = [
    { status: 200, body: Buffer.from(JSON.stringify(fixture('api-token-response.json'))) },
    { status: 500, body: Buffer.from('"Internal error"') },
    { status: 502, body: Buffer.from('<html>Bad gateway</html>') },
  ];
  const client = new SimpliSafeClient({
    request: async () => answers.shift(),
    tokens: { refreshToken: 'x', userId: USER_ID },
  });
  await assert.rejects(client.subscriptions(), { kind: ERROR_KINDS.SERVER, status: 500 });
  await assert.rejects(client.subscriptions(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.SERVER);
    assert.match(err.message, /Bad gateway/);
    return true;
  });
});
