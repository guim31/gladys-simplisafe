// -----------------------------------------------------------------------------
// The Gladys devices of a SimpliSafe account, and the values of their
// features. Pure functions of the data parsed by src/simplisafe/model.js.
//
//   - the system (one per base station): alarm state (text/select, always
//     read-only: the alarm is driven by the widget and the scene action, as
//     the configuration allows, never like a switch or by a voice assistant),
//     base station online, mains power, backup battery, alerts;
//   - one device per sensor: its detection (opening, motion, glass break,
//     smoke, CO, water leak, temperature and freeze alert), low battery,
//     online, and tamper when the sensor reports it;
//   - one device per Smart Lock: lock command, lock state, low batteries
//     (lock and keypad), online;
//   - one device per camera (SimpliCam, Video Doorbell Pro, outdoor camera):
//     picture, motion, doorbell for a doorbell, online.
//
// External ids: the serial of the base station for the system, the base
// station serial plus the sensor serial for a sensor or a lock (a sensor
// serial is only unique within its system), the camera uuid for a camera.
// Feature keys are permanent: never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { ALARM_STATES, DETECTIONS } from './simplisafe/model.js';
import { FEATURE_NAMES, KIND_NAMES, NO_ALERT, STATE_NAMES, pick } from './texts.js';

export const DEVICE_TYPES = Object.freeze({
  SYSTEM: 'system',
  SENSOR: 'sensor',
  LOCK: 'lock',
  CAMERA: 'camera',
});

export const FEATURE_KEYS = Object.freeze({
  STATE: 'state',
  ONLINE: 'online',
  POWER: 'power',
  BACKUP_BATTERY: 'backup_battery',
  ALERTS: 'alerts',
  ...DETECTIONS,
  TAMPER: 'tamper',
  BATTERY_LOW: 'battery_low',
  LOCK: 'lock',
  LOCK_STATE: 'lock_state',
  KEYPAD_BATTERY_LOW: 'keypad_battery_low',
  IMAGE: 'image',
  RING: 'ring',
});

// Values of an opening sensor in Gladys (server/utils/constants.js
// OPENING_SENSOR_STATE): 0 is OPEN, 1 is CLOSED — the reverse of the other
// detectors, where 1 means "detected".
export const OPENING_SENSOR_STATE = Object.freeze({ OPEN: 0, CLOSED: 1 });

// Values of a lock in Gladys (server/utils/constants.js LOCK).
export const LOCK_STATE = Object.freeze({ UNLOCKED: 0, LOCKED: 1, ERROR: 3 });

// The core reads a device at most once a minute; the hub reads the cloud on
// its own timer anyway (GladysAssistant/Gladys#3198), onPoll is a fallback.
const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

export const systemIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPES.SYSTEM, serial);
export const sensorIds = (gladys, systemSerial, serial) =>
  gladys.externalIds(DEVICE_TYPES.SENSOR, `${systemSerial}-${serial}`);
export const lockIds = (gladys, systemSerial, serial) =>
  gladys.externalIds(DEVICE_TYPES.LOCK, `${systemSerial}-${serial}`);
export const cameraIds = (gladys, uuid) => gladys.externalIds(DEVICE_TYPES.CAMERA, uuid);

const nameOf = (key, language) => pick(FEATURE_NAMES, language)[key];
const kindOf = (kind, language) => pick(KIND_NAMES, language)[kind] ?? kind;
const named = (userName, kind, language) =>
  userName ? `${userName} - ${kindOf(kind, language)}` : kindOf(kind, language);

function feature(ids, key, language, category, type, extra = {}) {
  return {
    name: nameOf(key, language),
    external_id: ids.feature(key),
    category,
    type,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...extra,
  };
}

const binary = (ids, key, language, category) =>
  feature(ids, key, language, category, category === C.INPUT ? T.INPUT.BINARY : T.SENSOR.BINARY);

const online = (ids, language) => binary(ids, FEATURE_KEYS.ONLINE, language, C.INPUT);
const batteryLow = (ids, key, language) =>
  feature(ids, key, language, C.BATTERY_LOW, T.BATTERY_LOW.BINARY);

// --- System -------------------------------------------------------------------------

export function buildSystemDevice(gladys, system, language) {
  const ids = systemIds(gladys, system.serial);
  const states = pick(STATE_NAMES, language);
  return {
    name: system.name
      ? `${kindOf('system', language)} - ${system.name}`
      : kindOf('system', language),
    external_id: ids.device,
    model: 'SimpliSafe 3',
    ...POLLING,
    features: [
      feature(ids, FEATURE_KEYS.STATE, language, C.TEXT, T.TEXT.SELECT, {
        // NOT NULL in Gladys even for a text feature.
        max: 0,
        supported_options: Object.values(ALARM_STATES).map((value, index) => ({
          value,
          label: states[value],
          sort_order: index,
        })),
      }),
      online(ids, language),
      binary(ids, FEATURE_KEYS.POWER, language, C.INPUT),
      feature(
        ids,
        FEATURE_KEYS.BACKUP_BATTERY,
        language,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.VOLTAGE,
        {
          unit: U.MILLI_VOLT,
          max: 10_000,
        },
      ),
      feature(ids, FEATURE_KEYS.ALERTS, language, C.TEXT, T.TEXT.TEXT, { max: 0 }),
    ],
  };
}

/** The alerts of a system as one text: the latest, with the count when several. */
export function alertsText(system, language) {
  const messages = [...(system.messages ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  if (messages.length === 0) return pick(NO_ALERT, language);
  const latest = messages[0].text.slice(0, 200);
  return messages.length > 1 ? `(${messages.length}) ${latest}` : latest;
}

/**
 * The values of a system's features, by feature key: a number, `{ text }`,
 * or absent when unknown.
 */
export function systemValues(system, settings, language) {
  const values = {
    [FEATURE_KEYS.ONLINE]: system.offline ? 0 : 1,
    [FEATURE_KEYS.POWER]: system.powerOutage ? 0 : 1,
    [FEATURE_KEYS.ALERTS]: { text: alertsText(system, language) },
  };
  if (system.state) values[FEATURE_KEYS.STATE] = { text: system.state };
  if (Number.isFinite(settings?.backupBattery)) {
    values[FEATURE_KEYS.BACKUP_BATTERY] = settings.backupBattery;
  }
  return values;
}

// --- Sensors ------------------------------------------------------------------------

const DETECTION_FEATURES = {
  [DETECTIONS.CONTACT]: (ids, language) =>
    binary(ids, DETECTIONS.CONTACT, language, C.OPENING_SENSOR),
  [DETECTIONS.MOTION]: (ids, language) => binary(ids, DETECTIONS.MOTION, language, C.MOTION_SENSOR),
  // Gladys has no glass break category: a binary input named after it.
  [DETECTIONS.GLASS_BREAK]: (ids, language) =>
    binary(ids, DETECTIONS.GLASS_BREAK, language, C.INPUT),
  [DETECTIONS.SMOKE]: (ids, language) => binary(ids, DETECTIONS.SMOKE, language, C.SMOKE_SENSOR),
  [DETECTIONS.CO]: (ids, language) => binary(ids, DETECTIONS.CO, language, C.CO_SENSOR),
  [DETECTIONS.LEAK]: (ids, language) => binary(ids, DETECTIONS.LEAK, language, C.LEAK_SENSOR),
  // The freeze sensor reports in °F; Gladys shows it in the unit of each user.
  [DETECTIONS.TEMPERATURE]: (ids, language) =>
    feature(ids, DETECTIONS.TEMPERATURE, language, C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
      unit: U.FAHRENHEIT,
      min: -40,
      max: 140,
    }),
  [DETECTIONS.FREEZE]: (ids, language) => binary(ids, DETECTIONS.FREEZE, language, C.INPUT),
};

export function buildSensorDevice(gladys, system, sensor, language) {
  const ids = sensorIds(gladys, system.serial, sensor.serial);
  const features = sensor.detections.map((key) => DETECTION_FEATURES[key](ids, language));
  if (sensor.tamper !== null) {
    features.push(feature(ids, FEATURE_KEYS.TAMPER, language, C.TAMPER, T.TAMPER.BINARY));
  }
  features.push(batteryLow(ids, FEATURE_KEYS.BATTERY_LOW, language), online(ids, language));
  return {
    name: named(sensor.name, sensor.kind, language),
    external_id: ids.device,
    model: kindOf(sensor.kind, 'en'),
    ...POLLING,
    features,
  };
}

const bit = (value) => (value ? 1 : 0);

/**
 * The values of a sensor's features. `pulses` holds the detections an event
 * set for a while (motion, glass break, secret alerts): they win over the
 * API, which keeps no state for motion and glass break.
 */
export function sensorValues(sensor, pulses = {}) {
  const values = {};
  for (const key of sensor.detections) {
    if (pulses[key] !== undefined) {
      values[key] = pulses[key];
      continue;
    }
    switch (key) {
      case DETECTIONS.CONTACT:
        if (sensor.triggered !== null) {
          values[key] = sensor.triggered ? OPENING_SENSOR_STATE.OPEN : OPENING_SENSOR_STATE.CLOSED;
        }
        break;
      case DETECTIONS.MOTION:
      case DETECTIONS.GLASS_BREAK:
        // Nothing is reported between events: "nothing detected".
        values[key] = bit(sensor.triggered);
        break;
      case DETECTIONS.SMOKE:
        if (sensor.smoke !== null) values[key] = bit(sensor.smoke);
        break;
      case DETECTIONS.CO:
        if (sensor.co !== null) values[key] = bit(sensor.co);
        break;
      case DETECTIONS.TEMPERATURE:
        if (sensor.temperature !== null) values[key] = sensor.temperature;
        break;
      default:
        // LEAK, FREEZE
        if (sensor.triggered !== null) values[key] = bit(sensor.triggered);
    }
  }
  if (sensor.tamper !== null) values[FEATURE_KEYS.TAMPER] = bit(sensor.tamper);
  values[FEATURE_KEYS.BATTERY_LOW] = bit(sensor.lowBattery);
  values[FEATURE_KEYS.ONLINE] = sensor.offline ? 0 : 1;
  return values;
}

// --- Locks --------------------------------------------------------------------------

export function buildLockDevice(gladys, system, lock, language) {
  const ids = lockIds(gladys, system.serial, lock.serial);
  return {
    name: named(lock.name, 'lock', language),
    external_id: ids.device,
    model: 'SimpliSafe Smart Lock',
    ...POLLING,
    features: [
      feature(ids, FEATURE_KEYS.LOCK, language, C.LOCK, T.LOCK.BINARY, {
        read_only: false,
        has_feedback: true,
      }),
      feature(ids, FEATURE_KEYS.LOCK_STATE, language, C.LOCK, T.LOCK.STATE, { max: 3 }),
      batteryLow(ids, FEATURE_KEYS.BATTERY_LOW, language),
      batteryLow(ids, FEATURE_KEYS.KEYPAD_BATTERY_LOW, language),
      online(ids, language),
    ],
  };
}

export function lockValues(lock) {
  const values = {
    [FEATURE_KEYS.BATTERY_LOW]: bit(lock.lowBattery),
    [FEATURE_KEYS.KEYPAD_BATTERY_LOW]: bit(lock.keypadLowBattery),
    [FEATURE_KEYS.ONLINE]: lock.offline ? 0 : 1,
  };
  if (lock.state === 'locked' || lock.state === 'unlocked') {
    const locked = lock.state === 'locked';
    values[FEATURE_KEYS.LOCK] = locked ? 1 : 0;
    values[FEATURE_KEYS.LOCK_STATE] = locked ? LOCK_STATE.LOCKED : LOCK_STATE.UNLOCKED;
  } else if (lock.state === 'jammed') {
    values[FEATURE_KEYS.LOCK_STATE] = LOCK_STATE.ERROR;
  }
  return values;
}

// --- Cameras ------------------------------------------------------------------------

export function buildCameraDevice(gladys, camera, { language, doorbell }) {
  const ids = cameraIds(gladys, camera.uuid);
  const features = [
    feature(ids, FEATURE_KEYS.IMAGE, language, C.CAMERA, T.CAMERA.IMAGE, { max: 0 }),
    binary(ids, FEATURE_KEYS.MOTION, language, C.MOTION_SENSOR),
  ];
  if (doorbell) {
    features.push(feature(ids, FEATURE_KEYS.RING, language, C.DOORBELL, T.DOORBELL.RING));
  }
  features.push(online(ids, language));
  const kind = doorbell ? 'doorbell' : camera.kind;
  return {
    name: named(camera.name, kind, language),
    external_id: ids.device,
    model: camera.model ? `${kindOf(kind, 'en')} (${camera.model})` : kindOf(kind, 'en'),
    ...POLLING,
    features,
  };
}

export function cameraValues(camera, pulses = {}, doorbell = false) {
  const values = {
    [FEATURE_KEYS.MOTION]: pulses[FEATURE_KEYS.MOTION] ?? 0,
    [FEATURE_KEYS.ONLINE]: camera.online ? 1 : 0,
  };
  if (doorbell) values[FEATURE_KEYS.RING] = pulses[FEATURE_KEYS.RING] ?? 0;
  return values;
}
