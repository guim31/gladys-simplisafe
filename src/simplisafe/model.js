// -----------------------------------------------------------------------------
// What the SimpliSafe API answers, turned into plain objects the rest of the
// code reads. Pure functions over the JSON of the cloud, read the way
// bachya/simplisafe-python (MIT) and homebridge-simplisafe3 (MIT) read it,
// and checked against the real answers kept in their tests
// (test/fixtures/simplisafe).
//
// Only the third generation of the system (SimpliSafe 3, `version: 3`) has
// the endpoints of sensors, locks and settings; a SimpliSafe 2 system (sold
// until 2018, its 2G/3G modules switched off since) is listed, not read.
// -----------------------------------------------------------------------------

/** Device types of the sensor list (simplipy DeviceTypes). */
export const DEVICE_TYPES = Object.freeze({
  REMOTE: 0,
  KEYPAD: 1,
  KEYCHAIN: 2,
  PANIC_BUTTON: 3,
  MOTION: 4,
  ENTRY: 5,
  GLASS_BREAK: 6,
  CO: 7,
  SMOKE: 8,
  LEAK: 9,
  TEMPERATURE: 10,
  CAMERA: 12,
  SIREN: 13,
  SMOKE_AND_CO: 14,
  DOORBELL: 15,
  LOCK: 16,
  OUTDOOR_CAMERA: 17,
  MOTION_V2: 20,
  OUTDOOR_SIREN: 22,
  LOCK_KEYPAD: 253,
});

// Detections a sensor reports (feature keys of src/devices.js: never rename
// one). The keypad, keychain remote, panic button and sirens report no
// detection: only their battery and their link to the base station.
export const DETECTIONS = Object.freeze({
  CONTACT: 'contact',
  MOTION: 'motion',
  GLASS_BREAK: 'glass_break',
  SMOKE: 'smoke',
  CO: 'co',
  LEAK: 'leak',
  TEMPERATURE: 'temperature',
  FREEZE: 'freeze',
});

/** The kind of each sensor type, and what it detects. */
export const SENSOR_KINDS = Object.freeze({
  [DEVICE_TYPES.ENTRY]: { kind: 'entry', detections: [DETECTIONS.CONTACT] },
  [DEVICE_TYPES.MOTION]: { kind: 'motion', detections: [DETECTIONS.MOTION] },
  [DEVICE_TYPES.MOTION_V2]: { kind: 'motion', detections: [DETECTIONS.MOTION] },
  [DEVICE_TYPES.GLASS_BREAK]: { kind: 'glass_break', detections: [DETECTIONS.GLASS_BREAK] },
  [DEVICE_TYPES.SMOKE]: { kind: 'smoke', detections: [DETECTIONS.SMOKE] },
  [DEVICE_TYPES.CO]: { kind: 'co', detections: [DETECTIONS.CO] },
  [DEVICE_TYPES.SMOKE_AND_CO]: { kind: 'smoke_co', detections: [DETECTIONS.SMOKE, DETECTIONS.CO] },
  [DEVICE_TYPES.LEAK]: { kind: 'leak', detections: [DETECTIONS.LEAK] },
  [DEVICE_TYPES.TEMPERATURE]: {
    kind: 'freeze',
    detections: [DETECTIONS.TEMPERATURE, DETECTIONS.FREEZE],
  },
  [DEVICE_TYPES.KEYPAD]: { kind: 'keypad', detections: [] },
  [DEVICE_TYPES.KEYCHAIN]: { kind: 'keychain', detections: [] },
  [DEVICE_TYPES.PANIC_BUTTON]: { kind: 'panic_button', detections: [] },
  [DEVICE_TYPES.SIREN]: { kind: 'siren', detections: [] },
  [DEVICE_TYPES.OUTDOOR_SIREN]: { kind: 'siren', detections: [] },
});

/** Detections that only show up through events (the API keeps no state for them). */
export const PULSED_DETECTIONS = new Set([DETECTIONS.MOTION, DETECTIONS.GLASS_BREAK]);

// State of the alarm, as Gladys stores it (the values of a text/select
// feature, kept in scenes and history: never change one).
export const ALARM_STATES = Object.freeze({
  OFF: 'off',
  HOME: 'home',
  AWAY: 'away',
  EXIT_DELAY: 'exit_delay',
  ENTRY_DELAY: 'entry_delay',
  ALARM: 'alarm',
});

/** The modes a command can set: the last segment of the state endpoint. */
export const ARM_MODES = Object.freeze(['off', 'home', 'away']);

// `alarmState` of the subscription → state (Home Assistant maps them the same
// way: a test is "disarmed", a countdown before the alarm is the entry delay).
const REST_STATES = {
  OFF: ALARM_STATES.OFF,
  TEST: ALARM_STATES.OFF,
  HOME: ALARM_STATES.HOME,
  AWAY: ALARM_STATES.AWAY,
  HOME_COUNT: ALARM_STATES.EXIT_DELAY,
  AWAY_COUNT: ALARM_STATES.EXIT_DELAY,
  EXIT_DELAY: ALARM_STATES.EXIT_DELAY,
  ENTRY_DELAY: ALARM_STATES.ENTRY_DELAY,
  ALARM_COUNT: ALARM_STATES.ENTRY_DELAY,
  ALARM: ALARM_STATES.ALARM,
};

// The mode the system is in or is going to (exit delays count as armed).
const REST_MODES = {
  OFF: 'off',
  TEST: 'off',
  HOME: 'home',
  HOME_COUNT: 'home',
  AWAY: 'away',
  AWAY_COUNT: 'away',
};

/** The alarm state of a raw `alarmState`, null when unknown (ERROR, UNKNOWN…). */
export function alarmStateOf(rawState, isAlarming = false) {
  if (isAlarming) return ALARM_STATES.ALARM;
  return REST_STATES[String(rawState ?? '').toUpperCase()] ?? null;
}

export function armModeOf(rawState) {
  return REST_MODES[String(rawState ?? '').toUpperCase()] ?? null;
}

// --- Events (WebSocket) ---------------------------------------------------------

// Kinds of alarm (scene trigger filter values: never change one), from the
// Contact ID code of the event: 1110 fire, 1120 panic, 1132 and 1134
// burglary, 1154 water leak, 1159 low temperature, 1162 carbon monoxide.
export const ALARM_KINDS = Object.freeze(['burglary', 'fire', 'co', 'water', 'freeze', 'panic']);

export const EVENT_TYPES = Object.freeze({
  ALARM: 'alarm',
  ALARM_CANCELED: 'alarm_canceled',
  ARMED: 'armed',
  DISARMED: 'disarmed',
  EXIT_DELAY: 'exit_delay',
  ENTRY_DELAY: 'entry_delay',
  SECRET_ALERT: 'secret_alert',
  CAMERA_MOTION: 'camera_motion',
  DOORBELL: 'doorbell',
  POWER_OUTAGE: 'power_outage',
  POWER_RESTORED: 'power_restored',
  CONNECTION_LOST: 'connection_lost',
  CONNECTION_RESTORED: 'connection_restored',
  SENSOR_LOST: 'sensor_not_responding',
  SENSOR_RESTORED: 'sensor_restored',
  LOCK_LOCKED: 'lock_locked',
  LOCK_UNLOCKED: 'lock_unlocked',
  LOCK_ERROR: 'lock_error',
  TEST: 'test',
});

// Event codes (`eventCid`) of simplipy's EVENT_MAPPING, with the mode an
// arming event sets and the kind of an alarm.
const T = EVENT_TYPES;
const EVENT_CIDS = {
  1110: { type: T.ALARM, kind: 'fire' },
  1120: { type: T.ALARM, kind: 'panic' },
  1132: { type: T.ALARM, kind: 'burglary' },
  1134: { type: T.ALARM, kind: 'burglary' },
  1154: { type: T.ALARM, kind: 'water' },
  1159: { type: T.ALARM, kind: 'freeze' },
  1162: { type: T.ALARM, kind: 'co' },
  1170: { type: T.CAMERA_MOTION },
  1301: { type: T.POWER_OUTAGE },
  1350: { type: T.CONNECTION_LOST },
  1381: { type: T.SENSOR_LOST },
  1400: { type: T.DISARMED, mode: 'off' },
  1406: { type: T.ALARM_CANCELED, mode: 'off' },
  1407: { type: T.DISARMED, mode: 'off' },
  1409: { type: T.SECRET_ALERT },
  1429: { type: T.ENTRY_DELAY },
  1458: { type: T.DOORBELL },
  1601: { type: T.TEST },
  1602: { type: T.TEST },
  1604: { type: T.TEST },
  3301: { type: T.POWER_RESTORED },
  3350: { type: T.CONNECTION_RESTORED },
  3381: { type: T.SENSOR_RESTORED },
  3401: { type: T.ARMED, mode: 'away' },
  3407: { type: T.ARMED, mode: 'away' },
  3441: { type: T.ARMED, mode: 'home' },
  3481: { type: T.ARMED, mode: 'away' },
  3487: { type: T.ARMED, mode: 'away' },
  3491: { type: T.ARMED, mode: 'home' },
  9401: { type: T.EXIT_DELAY, mode: 'away' },
  9407: { type: T.EXIT_DELAY, mode: 'away' },
  9441: { type: T.EXIT_DELAY, mode: 'home' },
  9700: { type: T.LOCK_UNLOCKED },
  9701: { type: T.LOCK_LOCKED },
  9703: { type: T.LOCK_ERROR },
};

/** The alarm state an event puts the system in, null when it changes none. */
export function stateOfEvent(event) {
  switch (event.type) {
    case T.ALARM:
      return ALARM_STATES.ALARM;
    case T.ALARM_CANCELED:
    case T.DISARMED:
      return ALARM_STATES.OFF;
    case T.ARMED:
      return event.mode === 'home' ? ALARM_STATES.HOME : ALARM_STATES.AWAY;
    case T.EXIT_DELAY:
      return ALARM_STATES.EXIT_DELAY;
    case T.ENTRY_DELAY:
      return ALARM_STATES.ENTRY_DELAY;
    default:
      return null;
  }
}

// Who armed or disarmed (scene trigger filter values: never change one), from
// the type of the device that sent the event: 0 the app or the website, 1 a
// keypad, 2 a keychain remote.
export const SOURCES = Object.freeze(['app', 'keypad', 'keychain', 'other']);
const SOURCE_OF_TYPE = { 0: 'app', 1: 'keypad', 2: 'keychain' };

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const serialOf = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/**
 * The event of a WebSocket message, null for anything else (the service
 * messages hello, registered, subscribed). simplipy reads the CloudEvents
 * envelope type `com.simplisafe.event.standard`, homebridge-simplisafe3 the
 * `messagequeue` source: either is enough.
 */
export function parseEvent(message) {
  if (!message || typeof message !== 'object') return null;
  const isEvent =
    message.type === 'com.simplisafe.event.standard' || message.source === 'messagequeue';
  const data = message.data;
  if (!isEvent || !data || typeof data !== 'object') return null;
  const cid = Number(data.eventCid);
  const known = EVENT_CIDS[cid] ?? null;
  const videoUuid = text(data.videoStartedBy);
  const links = videoUuid ? data.video?.[videoUuid]?._links : null;
  const sensorType = Number.isInteger(data.sensorType) ? data.sensorType : null;
  const seconds = Number(data.eventTimestamp);
  return {
    cid,
    type: known?.type ?? null,
    kind: known?.kind ?? null,
    mode: known?.mode ?? null,
    sid: serialOf(data.sid),
    at: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
    info: text(data.info),
    sensorSerial: serialOf(data.sensorSerial),
    sensorName: text(data.sensorName),
    sensorType,
    changedBy: text(data.pinName),
    source: SOURCE_OF_TYPE[sensorType] ?? 'other',
    videoUuid: videoUuid || null,
    snapshot: typeof links?.['snapshot/jpg']?.href === 'string' ? links['snapshot/jpg'].href : null,
  };
}

/** A service message of the socket: 'hello', 'registered', 'subscribed' or null. */
export function serviceMessageOf(message) {
  const type = typeof message?.type === 'string' ? message.type : '';
  if (type === 'com.simplisafe.service.hello') return 'hello';
  if (type === 'com.simplisafe.service.registered') return 'registered';
  if (
    type === 'com.simplisafe.service.subscribed' ||
    type === 'com.simplisafe.namespace.subscribed'
  )
    return 'subscribed';
  return null;
}

// --- Subscriptions (systems and cameras) ----------------------------------------

// Camera models (simplipy MODEL_TO_TYPE); newer models carry code names and
// are plain cameras unless they ring.
const CAMERA_MODELS = {
  SS001: 'camera',
  SS002: 'doorbell',
  SS003: 'camera',
  SSOBCM4: 'outdoor',
};

function parseCamera(raw) {
  const uuid = serialOf(raw?.uuid);
  if (!uuid) return null;
  const settings = raw.cameraSettings ?? {};
  const provider = settings.admin?.webRTCProvider;
  const features = raw.supportedFeatures ?? {};
  return {
    uuid,
    // The short serial the events carry in `sensorSerial`.
    serial: serialOf(raw.serial) || uuid.slice(-8),
    model: text(raw.model),
    kind: CAMERA_MODELS[text(raw.model)] ?? 'camera',
    name: text(settings.cameraName) || text(raw.model) || uuid.slice(-6),
    online: text(raw.status).toLowerCase() === 'online',
    // homebridge-simplisafe3: the first cameras stream from media.simplisafe.com,
    // the newer ones ("mist") through LiveKit only.
    live: !provider || provider === 'simplisafe',
    wired: features.wired !== false,
    privacyShutter: features.privacyShutter === true,
    shutter: {
      off: text(settings.shutterOff),
      home: text(settings.shutterHome),
      away: text(settings.shutterAway),
    },
  };
}

function parseMessage(raw) {
  const id = text(raw?.id) || text(raw?._id);
  const message = text(raw?.text);
  if (!id || !message) return null;
  const seconds = Number(raw.timestamp);
  return {
    id,
    text: message,
    category: text(raw.category),
    code: text(raw.code),
    at: Number.isFinite(seconds) ? seconds * 1000 : null,
  };
}

/**
 * The systems of `GET /users/{userId}/subscriptions`: one per subscription
 * with a base station, in the order of the answer.
 */
export function parseSubscriptions(body) {
  const list = Array.isArray(body?.subscriptions) ? body.subscriptions : [];
  const systems = [];
  for (const subscription of list) {
    const system = subscription?.location?.system;
    if (!subscription?.status?.hasBaseStation || !system || typeof system !== 'object') continue;
    const sid = serialOf(subscription.sid);
    const serial = serialOf(system.serial);
    if (!sid || !serial) continue;
    const location = subscription.location;
    systems.push({
      sid,
      serial,
      version: Number(system.version) === 2 ? 2 : 3,
      name: text(location.locationName) || text(location.street1),
      rawState: text(system.alarmState),
      state: alarmStateOf(system.alarmState, system.isAlarming === true),
      mode: armModeOf(system.alarmState),
      offline: system.isOffline === true,
      powerOutage: system.powerOutage === true,
      temperature: Number.isFinite(system.temperature) ? system.temperature : null,
      messages: (Array.isArray(system.messages) ? system.messages : [])
        .map(parseMessage)
        .filter(Boolean),
      cameras: (Array.isArray(system.cameras) ? system.cameras : [])
        .map(parseCamera)
        .filter(Boolean),
    });
  }
  return systems;
}

// --- Sensors and locks -------------------------------------------------------------

const flag = (value) => (value === true ? true : value === false ? false : null);

function parseSensor(raw, kind) {
  const status = raw.status && typeof raw.status === 'object' ? raw.status : {};
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : {};
  const isSmokeCo = raw.type === DEVICE_TYPES.SMOKE_AND_CO;
  return {
    serial: serialOf(raw.serial),
    type: raw.type,
    kind: kind.kind,
    detections: kind.detections,
    name: text(raw.name),
    // `triggered` is only there for the sensors the base station follows
    // (entry, leak, smoke, CO, freeze): absent for motion and glass break.
    triggered: flag(status.triggered),
    smoke: isSmokeCo ? flag(status.smokeTriggered) : flag(status.triggered),
    co: isSmokeCo ? flag(status.coTriggered) : flag(status.triggered),
    temperature: Number.isFinite(status.temperature) ? status.temperature : null,
    tamper: flag(status.tamper),
    lowBattery: flags.lowBattery === true,
    offline: flags.offline === true,
  };
}

// Lock states (simplipy LockStates): the API says 1 locked, 2 unlocked, and
// `lockJamState` when the bolt is stuck.
function lockStateOf(status) {
  if (status.lockJamState) return 'jammed';
  if (status.lockState === 1) return 'locked';
  if (status.lockState === 2 || status.lockState === 0) return 'unlocked';
  return null;
}

function parseLock(raw) {
  const status = raw.status && typeof raw.status === 'object' ? raw.status : {};
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : {};
  return {
    serial: serialOf(raw.serial),
    name: text(raw.name),
    state: status.lockDisabled === true ? null : lockStateOf(status),
    lowBattery: status.lockLowBattery === true,
    keypadLowBattery: status.pinPadLowBattery === true,
    offline: flags.offline === true,
  };
}

/** The sensors and locks of `GET /ss3/subscriptions/{sid}/sensors`. */
export function parseSensors(body) {
  const list = Array.isArray(body?.sensors) ? body.sensors : [];
  const sensors = [];
  const locks = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || !serialOf(raw.serial)) continue;
    if (raw.type === DEVICE_TYPES.LOCK) {
      locks.push(parseLock(raw));
      continue;
    }
    const kind = SENSOR_KINDS[raw.type];
    if (kind) sensors.push(parseSensor(raw, kind));
  }
  return { sensors, locks };
}

/** The base station status of `GET /ss3/subscriptions/{sid}/settings/normal`. */
export function parseSettings(body) {
  const status = body?.basestationStatus ?? {};
  const number = (value) => (Number.isFinite(value) ? value : null);
  return {
    backupBattery: number(status.backupBattery),
    wallPower: number(status.wallPower),
    wifiRssi: number(status.wifiRssi),
    rfJamming: status.rfJamming === true,
  };
}
