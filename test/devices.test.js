// -----------------------------------------------------------------------------
// The Gladys devices of the fixtures and the values of their features: the
// opening sensor inverted like the core wants it (0 = open), the lock states,
// detections that only come from events, the alarm state always read-only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  LOCK_STATE,
  OPENING_SENSOR_STATE,
  alertsText,
  buildCameraDevice,
  buildLockDevice,
  buildSensorDevice,
  buildSystemDevice,
  cameraValues,
  lockValues,
  sensorValues,
  systemValues,
} from '../src/devices.js';
import { parseSensors, parseSettings, parseSubscriptions } from '../src/simplisafe/model.js';
import { fixture } from './helpers/fakeCloud.js';

const gladys = createFakeGladys();
const [system] = parseSubscriptions(fixture('subscriptions-response.json'));
const { sensors, locks } = parseSensors(fixture('v3-sensors-response.json'));
const settings = parseSettings(fixture('v3-settings-response.json'));
const sensor = (serial) => sensors.find((candidate) => candidate.serial === serial);
const keysOf = (device) => device.features.map((feature) => feature.external_id.split(':').at(-1));

test('Gladys opening sensors: 0 is open, 1 is closed', () => {
  assert.deepEqual(OPENING_SENSOR_STATE, { OPEN: 0, CLOSED: 1 });
  const door = sensor('825');
  assert.equal(sensorValues(door).contact, OPENING_SENSOR_STATE.CLOSED);
  assert.equal(sensorValues({ ...door, triggered: true }).contact, OPENING_SENSOR_STATE.OPEN);
  // Unknown (no `triggered` in the answer): nothing published.
  assert.equal(sensorValues({ ...door, triggered: null }).contact, undefined);
});

test('the system: read-only alarm state with every state as an option', () => {
  const device = buildSystemDevice(gladys, system, 'fr');
  assert.equal(device.name, 'Alarme SimpliSafe - 1234 Main Street');
  assert.deepEqual(keysOf(device), ['state', 'online', 'power', 'backup_battery', 'alerts']);
  const state = device.features[0];
  assert.equal(state.read_only, true, 'never driven like a switch or by a voice assistant');
  assert.deepEqual(
    state.supported_options.map((option) => [option.value, option.label]),
    [
      ['off', 'Désarmée'],
      ['home', 'Armée (maison)'],
      ['away', 'Armée (absent)'],
      ['exit_delay', 'Délai de sortie'],
      ['entry_delay', "Délai d'entrée"],
      ['alarm', 'Alarme en cours'],
    ],
  );
  assert.ok(device.features.every((feature) => feature.read_only));
  assert.deepEqual(systemValues(system, settings, 'en'), {
    state: { text: 'off' },
    online: 1,
    power: 1,
    backup_battery: 5293,
    alerts: { text: 'Power Outage - Backup battery in use.' },
  });
});

test('alerts: the latest, with the count when there are several; a text when none', () => {
  assert.equal(alertsText({ messages: [] }, 'fr'), 'Aucune alerte');
  assert.equal(
    alertsText(
      {
        messages: [
          { text: 'Old one', at: 1 },
          { text: 'Sensor offline', at: 2 },
        ],
      },
      'en',
    ),
    '(2) Sensor offline',
  );
});

test('every kind of sensor gets its detections, low battery and online', () => {
  const features = (serial) => keysOf(buildSensorDevice(gladys, system, sensor(serial), 'en'));
  assert.deepEqual(features('825'), ['contact', 'battery_low', 'online']);
  assert.deepEqual(features('785'), ['motion', 'battery_low', 'online']);
  assert.deepEqual(features('491'), ['glass_break', 'battery_low', 'online']);
  assert.deepEqual(features('93'), ['smoke', 'tamper', 'battery_low', 'online']);
  assert.deepEqual(features('00000000'), ['smoke', 'co', 'tamper', 'battery_low', 'online']);
  assert.deepEqual(features('129'), ['leak', 'battery_low', 'online']);
  assert.deepEqual(features('320'), ['temperature', 'freeze', 'battery_low', 'online']);
  assert.deepEqual(features('972'), ['battery_low', 'online']); // keypad
  assert.deepEqual(features('236'), ['battery_low', 'online']); // siren
  const freeze = buildSensorDevice(gladys, system, sensor('320'), 'en');
  assert.equal(freeze.name, 'Basement - Freeze sensor');
  assert.equal(freeze.features[0].unit, 'fahrenheit');
  assert.deepEqual(sensorValues(sensor('320')), {
    temperature: 67,
    freeze: 0,
    battery_low: 0,
    online: 1,
  });
  assert.deepEqual(sensorValues(sensor('00000000')), {
    smoke: 0,
    co: 0,
    tamper: 1,
    battery_low: 0,
    online: 0,
  });
});

test('motion and glass break: nothing detected between events, 1 while an event pulses', () => {
  assert.equal(sensorValues(sensor('785')).motion, 0);
  assert.equal(sensorValues(sensor('785'), { motion: 1 }).motion, 1);
  assert.equal(sensorValues(sensor('491'), { glass_break: 1 }).glass_break, 1);
});

test('the Smart Lock: a lock command, its state, two batteries', () => {
  const device = buildLockDevice(gladys, system, locks[0], 'en');
  assert.deepEqual(keysOf(device), [
    'lock',
    'lock_state',
    'battery_low',
    'keypad_battery_low',
    'online',
  ]);
  assert.equal(device.features[0].read_only, false);
  assert.equal(device.features[0].has_feedback, true);
  assert.deepEqual(lockValues(locks[0]), {
    lock: 1,
    lock_state: LOCK_STATE.LOCKED,
    battery_low: 0,
    keypad_battery_low: 0,
    online: 1,
  });
  // Jammed: the state says so, the command keeps its last value.
  assert.deepEqual(lockValues(locks[1]), {
    lock_state: LOCK_STATE.ERROR,
    battery_low: 0,
    keypad_battery_low: 0,
    online: 1,
  });
  // Unknown (lockState 42): nothing about the bolt.
  assert.equal(lockValues(locks[2]).lock_state, undefined);
});

test('cameras: picture, motion, the doorbell for a doorbell, online', () => {
  const [camera, doorbell] = system.cameras;
  assert.deepEqual(keysOf(buildCameraDevice(gladys, camera, { language: 'en', doorbell: false })), [
    'image',
    'motion',
    'online',
  ]);
  const bell = buildCameraDevice(gladys, doorbell, { language: 'de', doorbell: true });
  assert.deepEqual(keysOf(bell), ['image', 'motion', 'ring', 'online']);
  assert.equal(bell.name, 'Doorbell - Video-Türklingel');
  assert.deepEqual(cameraValues(doorbell, { ring: 1 }, true), { motion: 0, online: 1, ring: 1 });
});

test('the external ids: base station serial, then the serial of each device', () => {
  assert.equal(
    buildSystemDevice(gladys, system, 'en').external_id,
    'ext:test-integration:system:1234ABCD',
  );
  assert.equal(
    buildSensorDevice(gladys, system, sensor('825'), 'en').external_id,
    'ext:test-integration:sensor:1234ABCD-825',
  );
  assert.equal(
    buildLockDevice(gladys, system, locks[0], 'en').external_id,
    'ext:test-integration:lock:1234ABCD-987',
  );
  assert.equal(
    buildCameraDevice(gladys, system.cameras[0], { language: 'en' }).external_id,
    'ext:test-integration:camera:1234567890',
  );
});
