// -----------------------------------------------------------------------------
// The answers of the SimpliSafe cloud read into plain objects, on the real
// answers kept by simplisafe-python (test/fixtures/simplisafe).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_STATES,
  EVENT_TYPES,
  alarmStateOf,
  armModeOf,
  parseEvent,
  parseSensors,
  parseSettings,
  parseSubscriptions,
  serviceMessageOf,
  stateOfEvent,
} from '../src/simplisafe/model.js';
import { envelope, fixture } from './helpers/fakeCloud.js';

test('a subscription with a base station is a system', () => {
  const [system, ...others] = parseSubscriptions(fixture('subscriptions-response.json'));
  assert.equal(others.length, 0);
  assert.equal(system.sid, '12345');
  assert.equal(system.serial, '1234ABCD');
  assert.equal(system.version, 3);
  assert.equal(system.name, '1234 Main Street');
  assert.equal(system.state, ALARM_STATES.OFF);
  assert.equal(system.mode, 'off');
  assert.equal(system.offline, false);
  assert.equal(system.powerOutage, false);
  assert.deepEqual(
    system.messages.map((message) => [message.text, message.category]),
    [['Power Outage - Backup battery in use.', 'error']],
  );
  assert.deepEqual(
    system.cameras.map((camera) => [camera.uuid, camera.kind, camera.name, camera.online]),
    [
      ['1234567890', 'camera', 'Camera', true],
      ['1234567892', 'doorbell', 'Doorbell', true],
      ['1234567891', 'camera', 'Unknown Camera', true],
    ],
  );
  const [cam] = system.cameras;
  assert.equal(cam.live, true);
  assert.equal(cam.privacyShutter, true);
  assert.deepEqual(cam.shutter, { off: 'closedAlarmOnly', home: 'closedAlarmOnly', away: 'open' });
});

test('a subscription without a base station, or without a system, is skipped', () => {
  const body = fixture('subscriptions-response.json');
  const first = body.subscriptions[0];
  const second = structuredClone(first);
  second.sid = 777;
  second.status.hasBaseStation = false;
  const third = structuredClone(first);
  third.sid = 778;
  delete third.location.system;
  body.subscriptions.push(second, third);
  assert.deepEqual(
    parseSubscriptions(body).map((system) => system.sid),
    ['12345'],
  );
  assert.deepEqual(parseSubscriptions({}), []);
  assert.deepEqual(parseSubscriptions(null), []);
});

test('the raw alarm states, as Home Assistant maps them', () => {
  const cases = {
    OFF: 'off',
    TEST: 'off',
    HOME: 'home',
    AWAY: 'away',
    HOME_COUNT: 'exit_delay',
    AWAY_COUNT: 'exit_delay',
    EXIT_DELAY: 'exit_delay',
    ENTRY_DELAY: 'entry_delay',
    ALARM_COUNT: 'entry_delay',
    ALARM: 'alarm',
  };
  for (const [raw, state] of Object.entries(cases)) {
    assert.equal(alarmStateOf(raw), state, raw);
  }
  assert.equal(alarmStateOf('ERROR'), null);
  assert.equal(alarmStateOf(undefined), null);
  // isAlarming wins.
  assert.equal(alarmStateOf('AWAY', true), 'alarm');
  assert.equal(armModeOf('AWAY_COUNT'), 'away');
  assert.equal(armModeOf('ENTRY_DELAY'), null);
});

test('sensors: kinds, detections, and what the API reports for each', () => {
  const { sensors, locks } = parseSensors(fixture('v3-sensors-response.json'));
  const kinds = {};
  for (const sensor of sensors) kinds[sensor.kind] = (kinds[sensor.kind] ?? 0) + 1;
  assert.deepEqual(kinds, {
    entry: 3,
    siren: 1,
    panic_button: 2,
    keypad: 1,
    smoke: 2,
    glass_break: 6,
    leak: 3,
    freeze: 1,
    motion: 2,
    smoke_co: 1,
  });
  const bySerial = Object.fromEntries(sensors.map((sensor) => [sensor.serial, sensor]));
  assert.equal(bySerial['825'].triggered, false); // entry: closed
  assert.equal(bySerial['785'].triggered, null); // motion: no state kept
  assert.equal(bySerial['491'].triggered, null); // glass break: no state kept
  assert.equal(bySerial['320'].temperature, 67); // freeze sensor, °F
  assert.deepEqual(bySerial['320'].detections, ['temperature', 'freeze']);
  assert.equal(bySerial['93'].tamper, false); // smoke detectors report tamper
  assert.equal(bySerial['825'].tamper, null);
  // The smoke and CO detector reads its two flags; its fixture is offline and tampered.
  const smokeCo = bySerial['00000000'];
  assert.deepEqual(
    [smokeCo.smoke, smokeCo.co, smokeCo.tamper, smokeCo.offline],
    [false, false, true, true],
  );
  // The lock keypads (253) are part of their lock: no device of their own.
  assert.ok(!sensors.some((sensor) => sensor.serial.endsWith('a')));
  assert.deepEqual(
    locks.map((lock) => [lock.serial, lock.name, lock.state]),
    [
      ['987', 'Front Door', 'locked'],
      ['654', 'Back Door', 'jammed'],
      ['321', 'Side Door', null], // lockState 42: unknown
    ],
  );
});

test('the base station settings: backup battery and the rest', () => {
  assert.deepEqual(parseSettings(fixture('v3-settings-response.json')), {
    backupBattery: 5293,
    wallPower: 5933,
    wifiRssi: -49,
    rfJamming: false,
  });
  assert.deepEqual(parseSettings({}), {
    backupBattery: null,
    wallPower: null,
    wifiRssi: null,
    rfJamming: false,
  });
});

test('a WebSocket event, in the envelope of simplisafe-python', () => {
  const event = parseEvent(
    envelope(
      'com.simplisafe.event.standard',
      fixture('ws-message-event-data.json'),
      'messagequeue',
    ),
  );
  assert.equal(event.cid, 1400);
  assert.equal(event.type, EVENT_TYPES.DISARMED);
  assert.equal(event.mode, 'off');
  assert.equal(event.sid, '12345');
  assert.equal(event.changedBy, 'Master PIN');
  assert.equal(event.source, 'keypad');
  assert.equal(event.at, 1632957286000);
  assert.equal(stateOfEvent(event), 'off');
});

test('a camera motion event carries the snapshot of its clip', () => {
  const event = parseEvent(
    envelope('com.simplisafe.event.standard', fixture('ws-motion-event-data.json'), 'messagequeue'),
  );
  assert.equal(event.type, EVENT_TYPES.CAMERA_MOTION);
  assert.equal(event.videoUuid, '0a1b2c3d4e5f60718293a4b5c6d7e8f9');
  assert.equal(event.sensorSerial, 'c6d7e8f9');
  assert.equal(event.snapshot, 'https://image-url{&width}');
  assert.equal(stateOfEvent(event), null);
});

test('event codes: alarms by kind, arming by mode, delays', () => {
  const of = (eventCid, extra = {}) =>
    parseEvent({ source: 'messagequeue', data: { eventCid, sid: 1, ...extra } });
  assert.deepEqual(
    [1110, 1120, 1132, 1134, 1154, 1159, 1162].map((cid) => of(cid).kind),
    ['fire', 'panic', 'burglary', 'burglary', 'water', 'freeze', 'co'],
  );
  assert.deepEqual(
    [3401, 3407, 3441, 3481, 3487, 3491].map((cid) => of(cid).mode),
    ['away', 'away', 'home', 'away', 'away', 'home'],
  );
  assert.equal(stateOfEvent(of(1110)), 'alarm');
  assert.equal(stateOfEvent(of(3441)), 'home');
  assert.equal(stateOfEvent(of(9401)), 'exit_delay');
  assert.equal(stateOfEvent(of(1429)), 'entry_delay');
  assert.equal(stateOfEvent(of(1406)), 'off');
  assert.equal(of(1458).type, EVENT_TYPES.DOORBELL);
  assert.equal(of(9701).type, EVENT_TYPES.LOCK_LOCKED);
  // Who: 0 the app, 1 a keypad, 2 a key fob.
  assert.deepEqual(
    [0, 1, 2, 5, undefined].map((sensorType) => of(3407, { sensorType }).source),
    ['app', 'keypad', 'keychain', 'other', 'other'],
  );
  // An unknown code is an event without a type, ignored by the hub.
  assert.equal(of(4242).type, null);
});

test('service messages and anything else', () => {
  assert.equal(serviceMessageOf(envelope('com.simplisafe.service.hello', {})), 'hello');
  assert.equal(serviceMessageOf(envelope('com.simplisafe.service.subscribed', {})), 'subscribed');
  assert.equal(serviceMessageOf({ type: 'com.simplisafe.namespace.subscribed' }), 'subscribed');
  assert.equal(parseEvent(envelope('com.simplisafe.service.hello', {})), null);
  assert.equal(parseEvent(null), null);
  assert.equal(parseEvent({ type: 'com.simplisafe.event.standard' }), null);
});
