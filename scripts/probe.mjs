#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real SimpliSafe cloud, with the code of the integration
// (src/simplisafe). Read-only: it never arms, disarms, locks or unlocks.
// Nothing sensitive is printed: no token, no code, no address, no serial in
// clear (masked), no picture address.
//
// Without an account (default):
//
//   node scripts/probe.mjs
//
// (Node's fetch ignores HTTPS_PROXY: behind a proxy, Node 24 needs
// NODE_USE_ENV_PROXY=1.)
//
//   1. builds the sign-in address (PKCE) and opens it, without following the
//      redirects: SimpliSafe must answer with its sign-in page (or a redirect
//      to it on auth.simplisafe.com);
//   2. trades a made-up code for tokens: SimpliSafe must refuse it cleanly
//      (invalid_grant), seen by the integration as a bad code;
//   3. renews a made-up refresh token: refused, seen as "sign in again";
//   4. calls the API without a token: 401;
//   5. opens the WebSocket and identifies with a made-up token: never
//      subscribed.
//
// With an account (a file holding a refresh token, never an argument, so it
// stays out of the shell history). SimpliSafe ROTATES the refresh token: the
// file is rewritten with the new one (mode 0600), and the token saved by a
// running integration stops working if it was the same — use a sign-in of
// its own (scripts or the integration's "Finish the sign-in" on another
// Gladys):
//
//   SIMPLISAFE_TOKEN_FILE=./token.txt node scripts/probe.mjs
//
// it reads the user id, the systems (version, alarm state), the kinds of
// sensors and locks, the base station settings, and waits for the WebSocket
// to subscribe. Exit code 0 when the probe behaved as expected, 1 otherwise.
// -----------------------------------------------------------------------------

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { authorizeUrl, newCodeVerifier, newDeviceId } from '../src/simplisafe/auth.js';
import { ERROR_KINDS, SimpliSafeClient } from '../src/simplisafe/client.js';
import { httpRequest } from '../src/simplisafe/http.js';
import { parseSensors, parseSettings, parseSubscriptions } from '../src/simplisafe/model.js';
import { EventSocket } from '../src/simplisafe/socket.js';

const say = (line = '') => process.stdout.write(`${line}\n`);
const mask = (serial) => `…${String(serial).slice(-3)}`;
let failures = 0;
const check = (ok, message) => {
  say(`${ok ? 'OK  ' : 'FAIL'} ${message}`);
  if (!ok) failures += 1;
};

async function signInPage() {
  const url = authorizeUrl({ verifier: newCodeVerifier(), deviceId: newDeviceId() });
  const response = await httpRequest({ url, maxBytes: 2 * 1024 * 1024 });
  const location = response.headers?.location;
  let detail = `HTTP ${response.status}`;
  if (location) {
    try {
      const target = new URL(location, url);
      detail += `, to ${target.hostname}${target.pathname}`;
    } catch {
      detail += ', to an unreadable address';
    }
  }
  const page = response.body.toString('utf8');
  const ok =
    (response.status >= 300 && response.status < 400) ||
    (response.status === 200 && /<form|login|password/i.test(page));
  check(ok, `sign-in page (${detail})`);
}

async function fakeCode() {
  const client = new SimpliSafeClient();
  try {
    await client.exchangeCode('ProbeMadeUpCode0123456789abcdefghijklmnopqrs', newCodeVerifier());
    check(false, 'a made-up code was accepted');
  } catch (err) {
    check(err.kind === ERROR_KINDS.BAD_CODE, `made-up code refused: ${err.kind} (${err.message})`);
  }
}

async function fakeRefresh() {
  const client = new SimpliSafeClient({ tokens: { refreshToken: 'probe-made-up', userId: '1' } });
  try {
    await client.authCheck();
    check(false, 'a made-up refresh token was accepted');
  } catch (err) {
    check(err.kind === ERROR_KINDS.AUTH, `made-up refresh token refused: ${err.kind}`);
  }
}

async function noToken() {
  const response = await httpRequest({ url: 'https://api.simplisafe.com/v1/api/authCheck' });
  check(
    response.status === 401 || response.status === 403,
    `API without a token: HTTP ${response.status}`,
  );
}

function socketWith(auth, waitMs) {
  return new Promise((resolve) => {
    const socket = new EventSocket({ auth, timings: { subscribeMs: waitMs, retryBaseMs: 60_000 } });
    const done = (result) => {
      socket.stop();
      resolve(result);
    };
    socket.on('up', () => done('subscribed'));
    socket.on('failure', ({ error }) => done(`failed (${error?.message ?? error})`));
    setTimeout(() => done('no answer'), waitMs + 2000).unref();
    socket.start();
  });
}

async function fakeSocket() {
  const result = await socketWith(async () => ({ token: 'probe-made-up', userId: '1' }), 10_000);
  // Refused by the server (closed, never subscribed), not unreachable.
  const reached = !/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|HTTP 40[37]/.test(result);
  check(result !== 'subscribed' && reached, `WebSocket with a made-up token: ${result}`);
}

async function account(file) {
  const saved = (await readFile(file, 'utf8')).trim();
  const client = new SimpliSafeClient({
    tokens: { refreshToken: saved },
    onTokens: async ({ refreshToken }) => {
      if (refreshToken && refreshToken !== saved) {
        await writeFile(file, `${refreshToken}\n`, { mode: 0o600 });
        await chmod(file, 0o600);
      }
    },
  });
  try {
    await client.authCheck();
  } catch (err) {
    check(false, `sign-in with the saved token: ${err.kind} (${err.message})`);
    return;
  }
  check(true, `signed in, the token file holds the renewed token`);
  const systems = parseSubscriptions(await client.subscriptions());
  check(systems.length > 0, `${systems.length} system(s)`);
  for (const system of systems) {
    say(
      `     system ${mask(system.serial)}: SimpliSafe ${system.version}, state ${system.rawState} → ${system.state}, ` +
        `${system.cameras.length} camera(s) (${system.cameras.map((c) => `${c.model || '?'}/${c.live ? 'live' : 'no live'}`).join(', ')}), ` +
        `${system.messages.length} alert(s)`,
    );
    if (system.version !== 3) continue;
    try {
      const { sensors, locks } = parseSensors(await client.sensors(system.sid));
      const kinds = {};
      for (const sensor of sensors) kinds[sensor.kind] = (kinds[sensor.kind] ?? 0) + 1;
      say(`     sensors: ${JSON.stringify(kinds)}, ${locks.length} lock(s)`);
      const reported = sensors.filter((s) => s.triggered !== null).map((s) => s.kind);
      say(`     with a reported state: ${JSON.stringify([...new Set(reported)])}`);
      const settings = parseSettings(await client.settings(system.sid));
      say(
        `     backup battery value: ${settings.backupBattery}, wall power: ${settings.wallPower}`,
      );
    } catch (err) {
      check(false, `sensors or settings: ${err.kind} (${err.message})`);
    }
  }
  const result = await socketWith(
    async () => ({ token: await client.token(), userId: await client.requireUser() }),
    20_000,
  );
  check(result === 'subscribed', `WebSocket: ${result}`);
}

const steps = [signInPage, fakeCode, fakeRefresh, noToken, fakeSocket];
for (const step of steps) {
  try {
    await step();
  } catch (err) {
    check(false, `${step.name}: ${err.code ?? ''} ${err.message}`);
  }
}
if (process.env.SIMPLISAFE_TOKEN_FILE) {
  try {
    await account(process.env.SIMPLISAFE_TOKEN_FILE);
  } catch (err) {
    check(false, `account: ${err.kind ?? err.code ?? ''} ${err.message}`);
  }
}
say(failures === 0 ? 'Probe OK' : `Probe: ${failures} unexpected result(s)`);
process.exit(failures === 0 ? 0 : 1);
