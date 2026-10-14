// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle — reads, motion, pictures, polls, widget contents —
// writes nothing; a failure that repeats is logged once, and its end once.
// Never a token, the sign-in code or its verifier, the address of the home or
// a PIN name — at any level, debug included.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIDGET_KEY } from '../src/hub.js';
import { CODE, eventData } from './helpers/fakeCloud.js';
import {
  cameraIds,
  createAll,
  createWorld,
  discovered,
  sensorIds,
  settle,
  systemIds,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  // The smoke and CO detector of the fixtures is offline: said once, at the first read.
  await w.hub.refresh();
  assert.ok(logs.texts().some((text) => text.includes('Kitchen (…0000) is offline')));
  logs.clear();

  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
    w.socket.push(eventData({ eventCid: 1170, sensorSerial: '1234567890' }));
    w.socket.push(eventData({ eventCid: 1409, sensorSerial: '785' }));
    w.socket.push(eventData({ eventCid: 1601 }));
    await w.fake.poll(discovered(w, systemIds(w.gladys).device));
    await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr', units: 'metric' });
    await w.fake.getImage(discovered(w, cameraIds(w.gladys, '1234567890').device));
  }
  // The token renewal reconnects the socket: not news either.
  w.clock.advance(60 * 60_000);
  await w.hub.refresh();
  await sleep(80); // the pulses end
  await settle();
  assert.deepEqual(logs.texts(), []);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  await w.hub.refresh();
  logs.clear();
  w.cloud.online = false;
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  w.cloud.online = true;
  w.clock.advance(60_000);
  await w.hub.refresh();
  await w.hub.refresh();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^\[[^\]]+\] /, '')),
    [
      '[WARN] [simplisafe-hub] The SimpliSafe cloud cannot be read (network: ENOTFOUND)',
      '[INFO] [simplisafe-hub] The SimpliSafe cloud answers again',
    ],
  );
});

test('a sensor that goes offline is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  await w.hub.refresh();
  logs.clear();
  w.cloud.sensor('825').flags.offline = true;
  await w.hub.refresh();
  w.clock.advance(60_000);
  await w.hub.refresh();
  w.cloud.sensor('825').flags.offline = false;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^\[[^\]]+\] \[INFO\] \[simplisafe-hub\] /, '')),
    ['Fire Door (…825) is offline', 'Fire Door (…825) is online again'],
  );
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '825').feature('online')), 1);
});

test('a user command is one line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  await w.fake.sceneAction('set_alarm_mode', { mode: 'home' });
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^\[[^\]]+\] /, '')),
    ['[INFO] [simplisafe-hub] Alarm set to home from the scene on …ABCD'],
  );
});

test('no secret, address or PIN name in the logs, even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { signedIn: false });
  const { data } = await w.fake.oauthAuthorizeUrl('simplisafe_account');
  w.cloud.challenge = new URL(data.authorize_url).searchParams.get('code_challenge');
  await settle();
  const verifier = JSON.parse(readFileSync(join(w.dataDir, 'simplisafe-state.json'), 'utf8')).signIn
    .verifier;
  await w.fake.action('finish_sign_in', { address: `com.simplisafe.mobile://cb?code=${CODE}` });
  await createAll(w);
  w.socket.push(eventData({ eventCid: 3401, pinName: 'Master PIN' }));
  w.socket.push(eventData({ eventCid: 1134, sensorSerial: '825' }));
  w.cloud.expireAccessTokens();
  await w.hub.refresh();
  await w.fake.action('test_connection', {});
  w.cloud.refreshTokens.clear();
  w.cloud.expireAccessTokens();
  await w.hub.refresh();
  await settle();
  const text = logs.texts().join('\n');
  assert.ok(text.length > 0);
  for (const secret of [
    ...w.cloud.secrets(),
    verifier,
    w.cloud.challenge,
    '1234 Main Street',
    'Master PIN',
  ]) {
    assert.ok(!text.includes(secret), `the logs hold "${secret}"`);
  }
});
