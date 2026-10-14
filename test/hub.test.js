// -----------------------------------------------------------------------------
// The integration end to end, against the fake Gladys of the SDK and the fake
// SimpliSafe cloud: the sign-in, the devices and their states, the events of
// the WebSocket (states, pulses, scene triggers, pictures), the commands and
// the options that guard them, and what happens when the cloud refuses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { MESSAGES } from '../src/texts.js';
import { CODE, eventData, fakeJpeg } from './helpers/fakeCloud.js';
import {
  BASE_CONFIG,
  SID,
  cameraIds,
  createAll,
  createWorld,
  discovered,
  lockIds,
  sensorIds,
  settle,
  systemIds,
} from './helpers/world.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const saved = (w) => JSON.parse(readFileSync(join(w.dataDir, 'simplisafe-state.json'), 'utf8'));
const apiCalls = (w, fragment) =>
  w.cloud.requests.filter((r) => r.host === 'api.simplisafe.com' && r.path.includes(fragment))
    .length;

test('not signed in: Connect opens the sign-in page, the pasted address signs in', async (t) => {
  const w = await world(t, { signedIn: false });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Connecter/);
  assert.equal(w.fake.discoveredDevices.length, 0);

  const { data } = await w.fake.oauthAuthorizeUrl('simplisafe_account');
  const page = new URL(data.authorize_url);
  assert.equal(page.hostname, 'auth.simplisafe.com');
  w.cloud.challenge = page.searchParams.get('code_challenge');

  const pasted = `Failed to launch 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback?code=${CODE}' because the scheme does not have a registered handler.`;
  const ack = await w.fake.action('finish_sign_in', { address: pasted });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.match(
    ack.data.message.en,
    /^Connected: 1 system\(s\) \(1234 Main Street\), 29 device\(s\)/,
  );
  assert.match(ack.data.message.fr, /onglet Découverte/);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 29);
  // The refresh token is in /data, the code and the verifier are not.
  const state = saved(w);
  assert.equal(state.refreshToken, 'refresh-token-1');
  assert.equal(state.signIn, undefined);
  assert.ok(!JSON.stringify(state).includes(CODE));
  await settle();
  assert.ok(w.socket.current, 'the real-time events are on');
});

test('the sign-in explains what went wrong', async (t) => {
  const w = await world(t, { signedIn: false });
  const fail = async (address) => (await w.fake.action('finish_sign_in', { address })).error;
  assert.deepEqual(await fail(`code=${CODE}`), MESSAGES.noFlow);
  const { data } = await w.fake.oauthAuthorizeUrl('simplisafe_account');
  w.cloud.challenge = new URL(data.authorize_url).searchParams.get('code_challenge');
  assert.deepEqual(await fail('https://auth.simplisafe.com/u/login'), MESSAGES.codeFormat);
  assert.deepEqual(await fail(`code=${'x'.repeat(45)}`), MESSAGES.badCode);
  // A second Connect draws a new verifier: the code of the first page no longer works.
  await w.fake.oauthAuthorizeUrl('simplisafe_account');
  assert.deepEqual(await fail(`code=${CODE}`), MESSAGES.badCode);
});

test('signed in: every device discovered, states only for the devices added', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 29);
  assert.equal(w.fake.states.length, 0, 'Gladys drops states of devices not added');
  await createAll(w);
  const system = systemIds(w.gladys);
  assert.equal(w.fake.lastState(system.feature('state')), 'off');
  assert.equal(w.fake.lastState(system.feature('backup_battery')), 5293);
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '825').feature('contact')), 1);
  assert.equal(w.fake.lastState(lockIds(w.gladys, '987').feature('lock')), 1);
  assert.equal(w.fake.lastState(lockIds(w.gladys, '654').feature('lock_state')), 3);
  assert.ok(w.fake.widgetRefreshes.includes(WIDGET_KEY), 'the widget is nudged at creation');
  // The refresh token rotated at start: the new one is saved.
  assert.equal(saved(w).refreshToken, 'refresh-token-1');
});

test('a device added later gets all its states at once', async (t) => {
  const w = await world(t);
  const door = discovered(w, sensorIds(w.gladys, '14').device);
  await w.fake.deviceCreated(door);
  await settle();
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '14').feature('contact')), 1);
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '14').feature('online')), 1);
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '825').feature('contact')), undefined);
});

test('only what is added is read: sensors for a sensor, settings for the system', async (t) => {
  const w = await world(t);
  const before = { sensors: apiCalls(w, '/sensors'), settings: apiCalls(w, '/settings') };
  await w.hub.refresh();
  assert.equal(apiCalls(w, '/subscriptions/12345/sensors'), before.sensors);
  assert.equal(apiCalls(w, `/users/`), 1, 'nothing added: not even the systems');
  await w.fake.deviceCreated(discovered(w, sensorIds(w.gladys, '825').device));
  await w.hub.refresh();
  assert.equal(apiCalls(w, '/sensors'), before.sensors + 1);
  assert.equal(apiCalls(w, '/settings'), before.settings);
});

test('arming from a keypad: state, scene trigger with who and from where', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.socket.push(
    eventData({ eventCid: 3401, sensorType: 1, pinName: 'Master PIN', info: 'Armed away' }),
  );
  await settle();
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'away');
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.MODE,
    data: {
      system: systemIds(w.gladys).device,
      mode: 'away',
      source: 'keypad',
      changed_by: 'Master PIN',
    },
  });
  // The exit delay and the disarm from the app follow the same path.
  w.socket.push(eventData({ eventCid: 9407, sensorType: 0, pinName: '' }));
  await settle();
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'exit_delay');
  w.socket.push(eventData({ eventCid: 1407, sensorType: 0, pinName: '' }));
  await settle();
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'off');
  assert.deepEqual(w.fake.sceneEvents.at(-1).data, {
    system: systemIds(w.gladys).device,
    mode: 'off',
    source: 'app',
    changed_by: null,
  });
  // An event of another account's system is ignored.
  w.socket.push(eventData({ eventCid: 3401, sid: 999 }));
  await settle();
  assert.equal(w.fake.sceneEvents.length, 2);
});

test('an alarm: state, the sensor that tripped it, the scene trigger with its kind', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.socket.push(eventData({ eventCid: 1134, sensorSerial: '825', sensorName: 'Fire Door' }));
  await settle();
  const system = systemIds(w.gladys);
  assert.equal(w.fake.lastState(system.feature('state')), 'alarm');
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '825').feature('contact')), 0, 'open');
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.ALARM,
    data: {
      system: system.device,
      kind: 'burglary',
      sensor: sensorIds(w.gladys, '825').device,
      sensor_name: 'Fire Door',
    },
  });
  // A water alarm on a leak sensor, of a sensor not in the list.
  w.socket.push(eventData({ eventCid: 1154, sensorSerial: 'nope', sensorName: 'Attic' }));
  await settle();
  assert.equal(w.fake.sceneEvents.at(-1).data.kind, 'water');
  assert.equal(w.fake.sceneEvents.at(-1).data.sensor, null);
  assert.equal(w.fake.sceneEvents.at(-1).data.sensor_name, 'Attic');
});

test('a secret alert on a motion sensor pulses its motion, then back to nothing', async (t) => {
  const w = await world(t);
  await createAll(w);
  const motion = sensorIds(w.gladys, '785').feature('motion');
  assert.equal(w.fake.lastState(motion), 0);
  w.socket.push(eventData({ eventCid: 1409, sensorSerial: '785' }));
  await settle();
  assert.equal(w.fake.lastState(motion), 1);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'off', 'silent');
  await sleep(80);
  await settle();
  assert.equal(w.fake.lastState(motion), 0);
});

test('the doorbell: its picture first, the ring pulse, then the scene trigger', async (t) => {
  const w = await world(t);
  await createAll(w);
  const doorbell = cameraIds(w.gladys, '1234567892');
  const snapshot =
    'https://remix.us-east-1.prd.cam.simplisafe.com/v1/preview/1234567892/12345/snapshot';
  let tries = 0;
  w.cloud.media.set(snapshot, (url) => {
    tries += 1;
    // The first try comes before the picture exists, as SimpliSafe does.
    if (tries === 1) return { status: 404, body: Buffer.alloc(0) };
    assert.equal(url.searchParams.get('width'), '640');
    return { status: 200, body: fakeJpeg(900) };
  });
  w.socket.push(
    eventData({
      eventCid: 1458,
      sensorType: 15,
      sensorSerial: '1234567892',
      videoStartedBy: '1234567892',
      video: { 1234567892: { _links: { 'snapshot/jpg': { href: `${snapshot}{&width}` } } } },
    }),
  );
  await sleep(30);
  await settle();
  const image = w.fake.cameraImages.at(-1);
  assert.equal(image.device_external_id, doorbell.device);
  assert.equal(image.image, `image/jpg;base64,${fakeJpeg(900).toString('base64')}`);
  assert.equal(tries, 2, 'a 404 is tried again');
  assert.equal(w.fake.lastState(doorbell.feature('ring')), 1);
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.DOORBELL,
    data: { camera: doorbell.device, camera_name: 'Doorbell' },
  });
  await sleep(80);
  await settle();
  assert.equal(w.fake.lastState(doorbell.feature('ring')), 0);
  // Disarmed, the shutter of this doorbell is closed: the live view shows the event picture.
  const ack = await w.fake.getImage(discovered(w, doorbell.device));
  assert.equal(ack.success, true);
  assert.match(ack.data.image, /^image\/jpg;base64,/);
});

test('a camera that rings is a doorbell from then on, even after a restart', async (t) => {
  const w = await world(t);
  const unknown = cameraIds(w.gladys, '1234567891');
  const features = () =>
    discovered(w, unknown.device).features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(!features().includes('ring'));
  w.socket.push(eventData({ eventCid: 1458, sensorSerial: '1234567891' }));
  await sleep(30);
  await settle();
  assert.ok(features().includes('ring'));
  assert.deepEqual(saved(w).doorbells, ['1234567891']);
  await w.app.stop();
  // The same /data (its rotated token and the doorbell), the same cloud.
  const again = await world(t, { dataDir: w.dataDir, cloud: w.cloud, signedIn: false });
  const ring = discovered(again, unknown.device).features.map((f) => f.external_id);
  assert.ok(ring.includes(unknown.feature('ring')));
});

test('camera motion pulses the camera; locks, power and base station follow the events', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.socket.push(eventData({ eventCid: 1170, sensorType: 12, sensorSerial: '1234567890' }));
  await settle();
  assert.equal(w.fake.lastState(cameraIds(w.gladys, '1234567890').feature('motion')), 1);
  w.socket.push(eventData({ eventCid: 9700, sensorSerial: '987' }));
  w.socket.push(eventData({ eventCid: 1301 }));
  w.socket.push(eventData({ eventCid: 1350 }));
  w.socket.push(eventData({ eventCid: 1381, sensorSerial: '129' }));
  await settle();
  assert.equal(w.fake.lastState(lockIds(w.gladys, '987').feature('lock')), 0);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('power')), 0);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('online')), 0);
  assert.equal(w.fake.lastState(sensorIds(w.gladys, '129').feature('online')), 0);
  w.socket.push(eventData({ eventCid: 3301 }));
  w.socket.push(eventData({ eventCid: 3350 }));
  await settle();
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('power')), 1);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('online')), 1);
});

test('arming from Gladys is off by default: widget and scene are refused', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  await createAll(w);
  const scene = await w.fake.sceneAction('set_alarm_mode', { mode: 'away' });
  assert.equal(scene.success, false);
  assert.deepEqual(scene.error, MESSAGES.controlOff);
  const widget = await w.fake.widgetAction(WIDGET_KEY, 'arm_away', { mode: 'away' }, {});
  assert.deepEqual(widget.error, MESSAGES.controlOff);
  assert.equal(apiCalls(w, '/state/'), 0);
});

test('"arm only" arms, never disarms', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, alarm_control: 'arm' } });
  await createAll(w);
  const armed = await w.fake.sceneAction('set_alarm_mode', { mode: 'home' });
  assert.deepEqual(armed, { success: true, data: { outputs: { state: 'home' } } });
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'home');
  const disarm = await w.fake.sceneAction('set_alarm_mode', { mode: 'off' });
  assert.deepEqual(disarm.error, MESSAGES.disarmOff);
  assert.equal(apiCalls(w, '/state/off'), 0);
});

test('"arm and disarm": the widget disarms; an exit delay is reported as such', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.exitDelay = 60;
  const away = await w.fake.widgetAction(
    WIDGET_KEY,
    'arm_away',
    { system: systemIds(w.gladys).device, mode: 'away' },
    {},
  );
  assert.equal(away.success, true);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'exit_delay');
  const off = await w.fake.widgetAction(WIDGET_KEY, 'disarm', { mode: 'off' }, {});
  assert.equal(off.success, true);
  assert.match(off.data.message.fr, /Désarmer/);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'off');
  assert.equal(apiCalls(w, `/ss3/subscriptions/${SID}/state/off`), 1);
});

test('a plan without remote control: the command says so', async (t) => {
  const w = await world(t);
  w.cloud.noRemote = true;
  const ack = await w.fake.sceneAction('set_alarm_mode', { mode: 'home' });
  assert.deepEqual(ack.error, MESSAGES.noRemote);
});

test('the Smart Lock locks; unlocking needs its option', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ids = lockIds(w.gladys, '321');
  const device = discovered(w, ids.device);
  const feature = device.features.find((f) => f.external_id === ids.feature('lock'));
  assert.equal((await w.fake.setValue(device, feature, 1)).success, true);
  assert.equal(w.fake.lastState(ids.feature('lock')), 1);
  assert.equal(w.cloud.sensor('321').status.lockState, 1);
  const refused = await w.fake.setValue(device, feature, 0);
  assert.equal(refused.success, false);
  assert.deepEqual(refused.error, MESSAGES.unlockOff);
  assert.equal(w.cloud.sensor('321').status.lockState, 1);

  await w.fake.configUpdated({ ...BASE_CONFIG, allow_unlock: true });
  assert.equal((await w.fake.setValue(device, feature, 0)).success, true);
  assert.equal(w.cloud.sensor('321').status.lockState, 2);
  // Every other feature is read-only.
  const state = device.features.find((f) => f.external_id === ids.feature('lock_state'));
  assert.equal((await w.fake.setValue(device, state, 1)).success, false);
});

test('after an arming with a Smart Lock, the cloud is left alone for 20 s', async (t) => {
  const w = await world(t);
  await createAll(w);
  await w.fake.sceneAction('set_alarm_mode', { mode: 'home' });
  const before = apiCalls(w, '/users/');
  await w.hub.refresh();
  assert.equal(apiCalls(w, '/users/'), before);
  w.clock.advance(20_000);
  await w.hub.refresh();
  assert.equal(apiCalls(w, '/users/'), before + 1);
});

test('a live picture only when the privacy shutter is open in the current mode', async (t) => {
  const w = await world(t);
  await createAll(w);
  const camera = discovered(w, cameraIds(w.gladys, '1234567890').device);
  // Disarmed: the shutter of this camera closes ("closedAlarmOnly"), no event picture yet.
  const closed = await w.fake.getImage(camera);
  assert.equal(closed.success, false);
  assert.deepEqual(closed.error, MESSAGES.noImage);
  assert.equal(w.cloud.requests.filter((r) => r.host === 'media.simplisafe.com').length, 0);
  // Armed away: open, the live view gives its first picture.
  w.socket.push(eventData({ eventCid: 3481, sensorType: 0 }));
  await settle();
  const live = await w.fake.getImage(camera);
  assert.equal(live.success, true);
  assert.equal(live.data.image, `image/jpg;base64,${w.cloud.liveJpeg.toString('base64')}`);
});

test('a refused sign-in stops everything and asks to sign in again', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.refreshTokens.clear();
  w.cloud.expireAccessTokens();
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /sign in again/);
  await settle();
  assert.equal(w.socket.current, undefined, 'the socket is closed');
  const requests = w.cloud.requests.length;
  await w.hub.refresh();
  assert.equal(w.cloud.requests.length, requests, 'no more requests');
});

test('a 403 pauses the reads, longer each time; a read that works lifts it', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.blocked = true;
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refusing requests/);
  const requests = w.cloud.requests.length;
  w.clock.advance(30_000);
  await w.hub.refresh();
  assert.equal(w.cloud.requests.length, requests, 'paused');
  w.clock.advance(31_000);
  await w.hub.refresh(); // still blocked: 2 minutes now
  w.clock.advance(61_000);
  await w.hub.refresh();
  assert.equal(w.cloud.requests.length, requests + 1);
  w.cloud.blocked = false;
  w.clock.advance(61_000);
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('Gladys restarted: everything is sent again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(w.fake.states.length > count, 'the states are sent again');
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('sign out: the tokens leave /data, the devices stay', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('sign_out', {});
  assert.deepEqual(ack.data.message, MESSAGES.signedOut);
  assert.equal(saved(w).refreshToken, undefined);
  assert.equal(w.fake.connectionStatus.connected, false);
  const test = await w.fake.action('test_connection', {});
  assert.deepEqual(test.error, MESSAGES.notSignedIn);
});

test('test the connection: lists the systems', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.de, /^Verbunden: 1 System\(e\) \(1234 Main Street\)/);
  w.cloud.online = false;
  const down = await w.fake.action('test_connection', {});
  assert.deepEqual(down.error, MESSAGES.unreachable);
});
