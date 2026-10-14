// -----------------------------------------------------------------------------
// The SimpliSafe hub: one SimpliSafe account, read on the container's own
// timer and followed in real time over the WebSocket of the cloud.
//
//   - every 30 s to 5 min (the configuration, 1 min by default): the systems
//     (alarm state, base station online, mains power, alerts, cameras), then
//     the sensors and locks of each system, asking the base station for fresh
//     values (`forceUpdate`, as Home Assistant does), and every 10 minutes
//     the base station settings (backup battery). Only what the user added to
//     Gladys is read; the Discover tab, the start and the sign-in read all;
//   - the WebSocket: arming and disarming (with who did it, when SimpliSafe
//     says so), entry and exit delays, alarms, secret alerts, camera motion,
//     the doorbell, the locks, power outages and the link of the base
//     station. An event updates the states at once and fires the scene
//     triggers; the REST reads stay the reference.
// The container refreshes itself: Gladys polls unreliably
// (GladysAssistant/Gladys#3198), onPoll is a fallback that never reads the
// cloud more often than the timer would.
//
// States go through publishChangedStates (only the changes, plus a heartbeat
// every 6 hours: the front shows "no recent value" past 48 hours), and only
// for the devices the user added.
//
// The cloud has no published quota. homebridge-simplisafe3 saw it answer 403
// to clients asking too often: a 403 pauses the reads, 1 minute then twice
// as long each time, up to 2 hours. A 409 means the base station is syncing:
// skipped silently. Right after an arming, with a Smart Lock in the system,
// the sensors are not read for 20 s: the cloud has a bug where the base
// station then announces that the lock is not responding (simplisafe-python).
//
// Logs: info keeps the lifecycle (signed in, connected, cloud lost and back,
// a device offline and back, alarms, arming changes, doorbell, user
// commands); a problem that repeats is logged once, and once when it clears;
// the rest goes to debug (LOG_LEVEL=debug). Never a token, a sign-in code,
// an address, a PIN name or a picture address.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  buildCameraDevice,
  buildLockDevice,
  buildSensorDevice,
  buildSystemDevice,
  cameraIds,
  cameraValues,
  lockIds,
  lockValues,
  sensorIds,
  sensorValues,
  systemIds,
  systemValues,
} from './devices.js';
import { IMAGE_WIDTHS, liveUrl, snapshotUrl, toCameraImage } from './image.js';
import { authorizeUrl, extractCode, newCodeVerifier } from './simplisafe/auth.js';
import { ERROR_KINDS, SimpliSafeClient } from './simplisafe/client.js';
import {
  ALARM_STATES,
  DETECTIONS,
  EVENT_TYPES,
  PULSED_DETECTIONS,
  alarmStateOf,
  parseSensors,
  parseSettings,
  parseSubscriptions,
  stateOfEvent,
} from './simplisafe/model.js';
import { EventSocket } from './simplisafe/socket.js';
import { CONNECTION_TEXT, MESSAGES, STATE_NAMES, connectedReport, pick } from './texts.js';

const logger = createLogger({ name: 'simplisafe-hub' });

export const WIDGET_KEY = 'alarm';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ALARM: 'alarm_triggered',
  MODE: 'alarm_mode_changed',
  DOORBELL: 'doorbell_pressed',
});

export const HUB_TIMINGS = {
  settingsMs: 10 * 60_000,
  heartbeatMs: 6 * 60 * 60_000,
  // Motion, glass break and camera motion stay 1 this long after an event
  // (Home Assistant: one minute).
  pulseMs: 60_000,
  // A ring: 1, then 0 after this.
  ringMs: 10_000,
  // No sensor read this soon after an arming change when a lock is there.
  lockQuietMs: 20_000,
  // A read soon after an arming event or a command: the delays, the sensors.
  followUpMs: 5_000,
  // Paused reads after a 403: the first pause, doubled each time, capped.
  pauseMs: 60_000,
  maxPauseMs: 2 * 60 * 60_000,
  // A sign-in page opened longer ago than this is refused.
  signInMs: 30 * 60_000,
  // The picture of an event may not be ready at once (404): tries, spacing.
  imageTries: 4,
  imageRetryMs: 2_000,
  // A scene event waits this long at most for the picture of its event.
  eventImageWaitMs: 8_000,
};

export class UserError extends Error {
  /** @param {object} text a multi-language message, shown to the user */
  constructor(text) {
    super(text.en);
    // The SDK sends `message` back to Gladys, which shows the user's language.
    this.message = text;
    this.text = text;
  }
}

/** The user-facing text of a failure of the cloud. */
function failureText(err) {
  if (err instanceof UserError) return err.text;
  switch (err?.kind) {
    case ERROR_KINDS.NO_REMOTE:
      return MESSAGES.noRemote;
    case ERROR_KINDS.RATE_LIMITED:
      return MESSAGES.rateLimited;
    case ERROR_KINDS.BUSY:
      return MESSAGES.busy;
    case ERROR_KINDS.NETWORK:
    case ERROR_KINDS.SERVER:
      return MESSAGES.unreachable;
    case ERROR_KINDS.AUTH:
      return CONNECTION_TEXT.authExpired;
    case ERROR_KINDS.NOT_SIGNED_IN:
      return MESSAGES.notSignedIn;
    case ERROR_KINDS.BAD_CODE:
      return MESSAGES.badCode;
    default:
      return MESSAGES.failed;
  }
}

/** A serial for the logs: its last characters only. */
const masked = (serial) => `…${String(serial).slice(-4)}`;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const asState = (externalId, value) =>
  value !== null && typeof value === 'object'
    ? { device_feature_external_id: externalId, text: value.text }
    : { device_feature_external_id: externalId, state: value };

export class SimpliSafeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/simplisafe/http.js)
   * @param {Function} [options.connectSocket] WebSocket seam (src/simplisafe/socket.js)
   * @param {boolean} [options.timers] the periodic read (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.socketTimings] SOCKET_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({
    gladys,
    store,
    request,
    connectSocket,
    timers = true,
    timings,
    socketTimings,
    now,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.connectSocket = connectSocket;
    this.socketTimings = socketTimings;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.socket = null;
    /** sid → { system, sensors: Map, locks: Map, settings, settingsAt, quietUntil } */
    this.systems = new Map();
    this.discovered = false;
    this.lastReadAt = null;
    this.reading = null;
    this.pulses = new Map(); // device external id → { key: value }
    this.pulseTimers = new Map(); // `${device}:${key}` → timer
    this.images = new Map(); // camera external id → { image, at }
    this.doorbells = new Set();
    this.timer = null;
    this.followUp = null;
    this.stopped = false;
    // Why the reads stopped: an AUTH error (sign in again), null otherwise.
    this.authFailed = false;
    this.pausedUntil = 0;
    this.pauseStep = 0;
    this.connection = null;
    this.structure = null;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Logs --------------------------------------------------------------------

  /** Log a problem once (`level` warn or info), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say so once, the next occurrence logs again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle ---------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    this.doorbells = new Set(Array.isArray(saved.doorbells) ? saved.doorbells : []);
    this.client = this.createClient(saved);
    this.schedule();
    if (!this.client.signedIn) {
      logger.info('Not signed in to SimpliSafe yet');
      await this.publishConnection();
      return;
    }
    await this.discover();
  }

  createClient(saved = {}) {
    return new SimpliSafeClient({
      request: this.request,
      now: this.now,
      tokens: { refreshToken: saved.refreshToken, userId: saved.userId },
      onTokens: async ({ refreshToken, userId }) => {
        await this.store.update({ refreshToken, userId });
        // The socket identified itself with the previous access token.
        this.socket?.restart();
      },
    });
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.structure = null;
    if (this.discovered) {
      await this.publishDevices();
      await this.publishAllStates();
    }
    await this.publishConnection();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous?.refreshMs !== config.refreshMs) this.schedule();
    if (previous?.language !== config.language && this.discovered) {
      // Names of new devices; Gladys keeps those of the devices already added.
      this.structure = null;
      await this.publishDevices();
      await this.publishAllStates();
    }
    this.nudgeWidget();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.followUp);
    this.timer = null;
    this.followUp = null;
    for (const timer of this.pulseTimers.values()) clearTimeout(timer);
    this.pulseTimers.clear();
    this.socket?.stop();
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timersEnabled || this.stopped) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.refresh();
      } catch (err) {
        logger.debug(`Read failed: ${err.message}`);
      } finally {
        this.schedule();
      }
    }, this.config?.refreshMs ?? 60_000);
    this.timer.unref?.();
  }

  /** A read soon (after an arming, a command), coalesced. */
  scheduleFollowUp(ms = this.timings.followUpMs) {
    if (!this.timersEnabled || this.stopped) return;
    clearTimeout(this.followUp);
    this.followUp = setTimeout(() => {
      this.followUp = null;
      this.refresh({ force: true }).catch((err) => logger.debug(`Read failed: ${err.message}`));
    }, ms);
    this.followUp.unref?.();
  }

  // --- Socket ------------------------------------------------------------------

  startSocket() {
    if (this.socket || this.stopped) return;
    this.socket = new EventSocket({
      auth: async () => ({
        token: await this.client.token(),
        userId: await this.client.requireUser(),
      }),
      connect: this.connectSocket,
      timings: this.socketTimings,
      now: this.now,
    });
    this.socket.on('event', (event) => {
      this.handleEvent(event).catch((err) => logger.warn(`Event not handled: ${err.message}`));
    });
    let wasUp = false;
    this.socket.on('up', () => {
      logger.debug('Real-time events connected');
      this.resolved('socket', 'Real-time events of SimpliSafe are back');
      if (wasUp) {
        // Events may have been missed while the socket was down.
        this.refresh({ force: true }).catch(() => {});
      }
      wasUp = true;
    });
    this.socket.on('down', () => logger.debug('Real-time events disconnected'));
    this.socket.on('failure', ({ error, attempts }) => {
      if (error?.kind === ERROR_KINDS.AUTH) {
        this.authLost();
        return;
      }
      const message = `Real-time events of SimpliSafe unavailable (${error?.message ?? error}): retrying`;
      // A single drop is ordinary (the token renewal reconnects every hour).
      if (attempts >= 3) this.problem('socket', message);
      else logger.debug(message);
    });
    this.socket.start();
  }

  stopSocket() {
    this.socket?.stop();
    this.socket = null;
  }

  // --- Reading the cloud -------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** Is any device of the system added to Gladys? Which kinds? */
  createdOf(entry) {
    const system = this.isCreated(systemIds(this.gladys, entry.system.serial).device);
    const sensors =
      [...entry.sensors.values()].some((sensor) =>
        this.isCreated(sensorIds(this.gladys, entry.system.serial, sensor.serial).device),
      ) ||
      [...entry.locks.values()].some((lock) =>
        this.isCreated(lockIds(this.gladys, entry.system.serial, lock.serial).device),
      );
    const cameras = entry.system.cameras.some((camera) =>
      this.isCreated(cameraIds(this.gladys, camera.uuid).device),
    );
    return { system, sensors, cameras, any: system || sensors || cameras };
  }

  canRead() {
    return Boolean(this.client?.signedIn) && !this.authFailed && !this.stopped;
  }

  /** Everything, for the Discover tab, the start and the sign-in. */
  async discover() {
    if (!this.canRead()) return false;
    const ok = await this.read({ all: true });
    if (ok) {
      this.discovered = true;
      await this.publishDevices();
      await this.publishAllStates();
      this.startSocket();
    }
    await this.publishConnection();
    this.nudgeWidget();
    return ok;
  }

  /**
   * The periodic read: the systems that have a device in Gladys. Coalesced
   * with a read in progress; `force` reads even within the pause of a 403
   * (a command just went through) — never within the 20 s after an arming.
   */
  async refresh({ force = false } = {}) {
    if (!this.canRead()) return false;
    if (!this.discovered) return this.discover();
    if (!force && this.now() < this.pausedUntil) {
      logger.debug('Reads paused (SimpliSafe refused the last ones)');
      return false;
    }
    const ok = await this.read({ all: false });
    if (ok) {
      await this.publishDevicesIfChanged();
      await this.publishAllStates();
      this.nudgeWidget();
    }
    await this.publishConnection();
    return ok;
  }

  /** onPoll: a read if the timer has not done one recently, else the known states. */
  async poll() {
    const period = this.config?.refreshMs ?? 60_000;
    if (this.lastReadAt === null || this.now() - this.lastReadAt >= period * 0.9) {
      return this.refresh();
    }
    await this.publishAllStates();
    return true;
  }

  /** One read at a time: a periodic read joins the one in progress, a full one waits for it. */
  async read(options) {
    while (this.reading) {
      if (!options.all) return this.reading;
      await this.reading.catch(() => {});
    }
    this.reading = this.readCloud(options).finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readCloud({ all }) {
    const started = this.now();
    try {
      const anyCreated = [...this.systems.values()].some((entry) => this.createdOf(entry).any);
      if (!all && !anyCreated) {
        logger.debug('No SimpliSafe device in Gladys: nothing to read');
        this.lastReadAt = started;
        return true;
      }
      // simplisafe-python: a system with a lock read within ~15 s of an
      // arming change announces that the lock is not responding. The whole
      // read waits for the end of that window.
      if ([...this.systems.values()].some((entry) => started < entry.quietUntil)) {
        logger.debug('Read postponed: a system with a Smart Lock was just armed or disarmed');
        return true;
      }
      this.applySystems(parseSubscriptions(await this.client.subscriptions()));
      for (const entry of this.systems.values()) {
        if (entry.system.version !== 3) continue;
        const created = this.createdOf(entry);
        if (all || created.sensors) {
          this.applySensors(entry, parseSensors(await this.client.sensors(entry.system.sid)));
        }
        if ((all || created.system) && started - entry.settingsAt >= this.timings.settingsMs) {
          entry.settings = parseSettings(await this.client.settings(entry.system.sid));
          entry.settingsAt = started;
        }
      }
      this.lastReadAt = started;
      this.readSucceeded();
      return true;
    } catch (err) {
      this.readFailed(err);
      return false;
    }
  }

  applySystems(systems) {
    const seen = new Set();
    for (const system of systems) {
      seen.add(system.sid);
      const entry = this.systems.get(system.sid);
      if (entry) {
        this.followOnline(system);
        // During a delay or an alarm the API does not say which mode: kept.
        system.mode ??= entry.system.mode;
        entry.system = system;
      } else {
        if (system.version !== 3) {
          this.problem(
            `v2:${system.sid}`,
            `System ${masked(system.serial)} is a SimpliSafe 2: not supported, skipped`,
            'info',
          );
        }
        this.systems.set(system.sid, {
          system,
          sensors: new Map(),
          locks: new Map(),
          settings: null,
          settingsAt: -Infinity,
          quietUntil: 0,
        });
      }
    }
    for (const sid of [...this.systems.keys()]) {
      if (!seen.has(sid)) this.systems.delete(sid);
    }
  }

  /** The base station going offline and back: lifecycle, logged once each way. */
  followOnline(system) {
    const key = `offline:${system.serial}`;
    if (system.offline) {
      this.problem(key, `Base station ${masked(system.serial)} is offline`, 'info');
    } else {
      this.resolved(key, `Base station ${masked(system.serial)} is online again`);
    }
  }

  applySensors(entry, { sensors, locks }) {
    entry.sensors = new Map(sensors.map((sensor) => [sensor.serial, sensor]));
    entry.locks = new Map(locks.map((lock) => [lock.serial, lock]));
    const known = [
      ...sensors.map((device) => [
        device,
        sensorIds(this.gladys, entry.system.serial, device.serial),
      ]),
      ...locks.map((device) => [device, lockIds(this.gladys, entry.system.serial, device.serial)]),
    ];
    for (const [device, ids] of known) {
      if (!this.isCreated(ids.device)) continue;
      const key = `offline:${entry.system.serial}:${device.serial}`;
      const label = `${device.name || 'device'} (${masked(device.serial)})`;
      if (device.offline) this.problem(key, `${label} is offline`, 'info');
      else this.resolved(key, `${label} is online again`);
    }
  }

  readSucceeded() {
    this.pauseStep = 0;
    this.pausedUntil = 0;
    this.resolved('cloud', 'The SimpliSafe cloud answers again');
    this.resolved('paused', 'SimpliSafe accepts requests again');
  }

  readFailed(err) {
    switch (err?.kind) {
      case ERROR_KINDS.AUTH:
      case ERROR_KINDS.NOT_SIGNED_IN:
        this.authLost();
        break;
      case ERROR_KINDS.RATE_LIMITED: {
        const pause = Math.min(this.timings.pauseMs * 2 ** this.pauseStep, this.timings.maxPauseMs);
        this.pauseStep += 1;
        this.pausedUntil = this.now() + pause;
        this.problem(
          'paused',
          `SimpliSafe refused a read (${err.message}): reads paused, ${Math.round(pause / 60_000)} min first`,
        );
        break;
      }
      case ERROR_KINDS.BUSY:
        logger.debug(`Base station busy (${err.message}): read skipped`);
        break;
      default:
        this.problem('cloud', `The SimpliSafe cloud cannot be read (${err?.message ?? err})`);
    }
  }

  authLost() {
    if (this.authFailed) return;
    this.authFailed = true;
    this.stopSocket();
    logger.warn('SimpliSafe refused the saved sign-in: sign in again from the configuration');
    this.publishConnection().catch(() => {});
  }

  // --- Devices -----------------------------------------------------------------

  buildDevices() {
    const devices = [];
    for (const entry of this.systems.values()) {
      const { system } = entry;
      if (system.version !== 3) continue;
      devices.push(buildSystemDevice(this.gladys, system, this.language));
      for (const sensor of entry.sensors.values()) {
        devices.push(buildSensorDevice(this.gladys, system, sensor, this.language));
      }
      for (const lock of entry.locks.values()) {
        devices.push(buildLockDevice(this.gladys, system, lock, this.language));
      }
      for (const camera of system.cameras) {
        devices.push(
          buildCameraDevice(this.gladys, camera, {
            language: this.language,
            doorbell: this.isDoorbell(camera),
          }),
        );
      }
    }
    return devices;
  }

  isDoorbell(camera) {
    return camera.kind === 'doorbell' || this.doorbells.has(camera.uuid);
  }

  async publishDevices() {
    const devices = this.buildDevices();
    this.structure = JSON.stringify(devices);
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.structure = null;
      logger.warn(`Devices not published: ${err.message}`);
    }
  }

  async publishDevicesIfChanged() {
    if (JSON.stringify(this.buildDevices()) !== this.structure) {
      await this.publishDevices();
    }
  }

  async rediscover() {
    if (!this.canRead()) {
      await this.publishConnection();
      return;
    }
    await this.discover();
  }

  async onDeviceCreated(device) {
    // The SDK forgot what it had published for this device: send it all now.
    await this.publishAllStates();
    const image = this.images.get(device.external_id);
    if (image) {
      await this.gladys.publishCameraImage(device.external_id, image.image).catch(() => {});
    }
    this.nudgeWidget();
  }

  // --- States ------------------------------------------------------------------

  statesOf(ids, values) {
    return Object.entries(values).map(([key, value]) => asState(ids.feature(key), value));
  }

  /** The states of every device added to Gladys. */
  collectStates() {
    const states = [];
    for (const entry of this.systems.values()) {
      const { system } = entry;
      if (system.version !== 3) continue;
      const ids = systemIds(this.gladys, system.serial);
      if (this.isCreated(ids.device)) {
        states.push(...this.statesOf(ids, systemValues(system, entry.settings, this.language)));
      }
      for (const sensor of entry.sensors.values()) {
        const sIds = sensorIds(this.gladys, system.serial, sensor.serial);
        if (!this.isCreated(sIds.device)) continue;
        states.push(...this.statesOf(sIds, sensorValues(sensor, this.pulses.get(sIds.device))));
      }
      for (const lock of entry.locks.values()) {
        const lIds = lockIds(this.gladys, system.serial, lock.serial);
        if (this.isCreated(lIds.device)) states.push(...this.statesOf(lIds, lockValues(lock)));
      }
      for (const camera of system.cameras) {
        const cIds = cameraIds(this.gladys, camera.uuid);
        if (!this.isCreated(cIds.device)) continue;
        const values = cameraValues(camera, this.pulses.get(cIds.device), this.isDoorbell(camera));
        states.push(...this.statesOf(cIds, values));
      }
    }
    return states;
  }

  async publishAllStates() {
    await this.sendStates(this.collectStates());
  }

  async sendStates(states) {
    if (states.length === 0) return;
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states', 'States are accepted by Gladys again');
    } catch (err) {
      this.problem('states', `States not published: ${err.message}`);
    }
  }

  // --- Connection status -------------------------------------------------------

  connectionStatus() {
    if (!this.client?.signedIn) return { ok: false, text: CONNECTION_TEXT.notSignedIn };
    if (this.authFailed) return { ok: false, text: CONNECTION_TEXT.authExpired };
    if (this.warned.has('paused')) return { ok: false, text: CONNECTION_TEXT.rateLimited };
    if (this.warned.has('cloud') || !this.discovered) {
      return { ok: false, text: CONNECTION_TEXT.unreachable };
    }
    if (![...this.systems.values()].some((entry) => entry.system.version === 3)) {
      return { ok: false, text: CONNECTION_TEXT.noSystem };
    }
    return { ok: true, text: null };
  }

  async publishConnection() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) return;
    try {
      if (status.ok) await this.gladys.setConnectionStatus(true);
      else await this.gladys.setConnectionStatus(false, status.text);
      this.connection = key;
    } catch (err) {
      logger.debug(`Connection status not sent: ${err.message}`);
    }
  }

  nudgeWidget() {
    try {
      this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
    } catch {
      // dropped while disconnected
    }
  }

  // --- Events ------------------------------------------------------------------

  findSensor(entry, serial) {
    return serial ? (entry.sensors.get(serial) ?? null) : null;
  }

  findCamera(entry, event) {
    return (
      entry.system.cameras.find(
        (camera) =>
          (event.videoUuid && camera.uuid === event.videoUuid) ||
          (event.sensorSerial &&
            (camera.serial === event.sensorSerial || camera.uuid.endsWith(event.sensorSerial))),
      ) ?? null
    );
  }

  async handleEvent(event) {
    const entry = this.systems.get(event.sid);
    if (!entry || entry.system.version !== 3) {
      logger.debug(`Event ${event.cid} of an unknown system ignored`);
      return;
    }
    logger.debug(
      `Event ${event.cid} (${event.type ?? 'unknown'}) on ${masked(entry.system.serial)}`,
    );
    const { system } = entry;
    const systemExternalId = systemIds(this.gladys, system.serial).device;

    const state = stateOfEvent(event);
    if (state) {
      const changed = system.state !== state;
      system.state = state;
      if (event.mode) system.mode = event.mode;
      if (changed) {
        await this.sendStates(this.systemStates(entry));
        this.nudgeWidget();
      }
    }

    switch (event.type) {
      case EVENT_TYPES.ARMED:
      case EVENT_TYPES.DISARMED:
      case EVENT_TYPES.ALARM_CANCELED:
        await this.armingChanged(entry, event, systemExternalId);
        break;
      case EVENT_TYPES.ALARM:
        await this.alarmed(entry, event, systemExternalId);
        break;
      case EVENT_TYPES.SECRET_ALERT:
        await this.sensorDetected(entry, this.findSensor(entry, event.sensorSerial));
        break;
      case EVENT_TYPES.CAMERA_MOTION:
        await this.cameraEvent(entry, event, false);
        break;
      case EVENT_TYPES.DOORBELL:
        await this.cameraEvent(entry, event, true);
        break;
      case EVENT_TYPES.POWER_OUTAGE:
      case EVENT_TYPES.POWER_RESTORED:
        system.powerOutage = event.type === EVENT_TYPES.POWER_OUTAGE;
        logger.info(
          system.powerOutage
            ? `Power outage at base station ${masked(system.serial)}: on backup battery`
            : `Mains power back at base station ${masked(system.serial)}`,
        );
        await this.sendStates(this.systemStates(entry));
        break;
      case EVENT_TYPES.CONNECTION_LOST:
      case EVENT_TYPES.CONNECTION_RESTORED: {
        system.offline = event.type === EVENT_TYPES.CONNECTION_LOST;
        this.followOnline(system);
        await this.sendStates(this.systemStates(entry));
        break;
      }
      case EVENT_TYPES.SENSOR_LOST:
      case EVENT_TYPES.SENSOR_RESTORED: {
        const sensor = this.findSensor(entry, event.sensorSerial);
        if (sensor) {
          sensor.offline = event.type === EVENT_TYPES.SENSOR_LOST;
          await this.sendStates(this.sensorStates(entry, sensor));
        }
        break;
      }
      case EVENT_TYPES.LOCK_LOCKED:
      case EVENT_TYPES.LOCK_UNLOCKED:
      case EVENT_TYPES.LOCK_ERROR: {
        const lock = entry.locks.get(event.sensorSerial);
        if (lock) {
          lock.state =
            event.type === EVENT_TYPES.LOCK_LOCKED
              ? 'locked'
              : event.type === EVENT_TYPES.LOCK_UNLOCKED
                ? 'unlocked'
                : 'jammed';
          await this.sendStates(this.lockStates(entry, lock));
          this.nudgeWidget();
        }
        break;
      }
      default:
    }
  }

  systemStates(entry) {
    const ids = systemIds(this.gladys, entry.system.serial);
    if (!this.isCreated(ids.device)) return [];
    return this.statesOf(ids, systemValues(entry.system, entry.settings, this.language));
  }

  sensorStates(entry, sensor) {
    const ids = sensorIds(this.gladys, entry.system.serial, sensor.serial);
    if (!this.isCreated(ids.device)) return [];
    return this.statesOf(ids, sensorValues(sensor, this.pulses.get(ids.device)));
  }

  lockStates(entry, lock) {
    const ids = lockIds(this.gladys, entry.system.serial, lock.serial);
    if (!this.isCreated(ids.device)) return [];
    return this.statesOf(ids, lockValues(lock));
  }

  cameraStates(camera) {
    const ids = cameraIds(this.gladys, camera.uuid);
    if (!this.isCreated(ids.device)) return [];
    return this.statesOf(
      ids,
      cameraValues(camera, this.pulses.get(ids.device), this.isDoorbell(camera)),
    );
  }

  async armingChanged(entry, event, systemExternalId) {
    const { system } = entry;
    this.quietAfterArming(entry);
    logger.info(
      `Alarm ${event.mode === 'off' ? 'disarmed' : `armed (${event.mode})`} on ${masked(system.serial)}, from ${event.source}`,
    );
    await this.fire(TRIGGERS.MODE, {
      system: systemExternalId,
      mode: event.mode,
      source: event.source,
      changed_by: event.changedBy || null,
    });
    this.scheduleFollowUp(entry.locks.size > 0 ? this.timings.lockQuietMs : undefined);
  }

  /** Right after an arming change, a system with a lock is left alone for 20 s. */
  quietAfterArming(entry) {
    if (entry.locks.size > 0) entry.quietUntil = this.now() + this.timings.lockQuietMs;
  }

  async alarmed(entry, event, systemExternalId) {
    const sensor = this.findSensor(entry, event.sensorSerial);
    logger.info(
      `ALARM (${event.kind}) on ${masked(entry.system.serial)}${sensor ? `, sensor ${masked(sensor.serial)}` : ''}`,
    );
    await this.sensorDetected(entry, sensor);
    await this.fire(TRIGGERS.ALARM, {
      system: systemExternalId,
      kind: event.kind,
      sensor: sensor ? sensorIds(this.gladys, entry.system.serial, sensor.serial).device : null,
      sensor_name: sensor?.name || event.sensorName || null,
    });
  }

  /** An alarm or a secret alert named a sensor: show what it detected. */
  async sensorDetected(entry, sensor) {
    if (!sensor) return;
    const ids = sensorIds(this.gladys, entry.system.serial, sensor.serial);
    if (sensor.detections.includes(DETECTIONS.CONTACT)) {
      // Open until the next read says otherwise.
      sensor.triggered = true;
      await this.sendStates(this.sensorStates(entry, sensor));
      return;
    }
    const key = sensor.detections.find((detection) => PULSED_DETECTIONS.has(detection));
    if (key) {
      await this.pulse(ids.device, key, this.timings.pulseMs, () =>
        this.sensorStates(entry, sensor),
      );
    }
  }

  /** A detection at 1 for `ms`, then back to what the API says. */
  async pulse(deviceExternalId, key, ms, statesOf) {
    const values = { ...this.pulses.get(deviceExternalId), [key]: 1 };
    this.pulses.set(deviceExternalId, values);
    await this.sendStates(statesOf());
    const timerKey = `${deviceExternalId}:${key}`;
    clearTimeout(this.pulseTimers.get(timerKey));
    const timer = setTimeout(() => {
      this.pulseTimers.delete(timerKey);
      const current = { ...this.pulses.get(deviceExternalId) };
      delete current[key];
      if (Object.keys(current).length > 0) this.pulses.set(deviceExternalId, current);
      else this.pulses.delete(deviceExternalId);
      this.sendStates(statesOf()).catch(() => {});
    }, ms);
    timer.unref?.();
    this.pulseTimers.set(timerKey, timer);
  }

  async cameraEvent(entry, event, ring) {
    const camera = this.findCamera(entry, event);
    if (!camera) {
      logger.debug(`Camera event ${event.cid} of an unknown camera`);
      return;
    }
    const ids = cameraIds(this.gladys, camera.uuid);
    if (ring && !this.isDoorbell(camera)) {
      // A doorbell model the integration does not know: it rings, so it is one.
      this.doorbells.add(camera.uuid);
      await this.store.update({ doorbells: [...this.doorbells] });
      await this.publishDevices();
    }
    const picture = this.eventPicture(camera, event);
    if (ring) {
      logger.info(`Doorbell ${masked(camera.uuid)} rang`);
      await this.pulse(ids.device, FEATURE_KEYS.RING, this.timings.ringMs, () =>
        this.cameraStates(camera),
      );
      // The picture first (bounded), so a scene sending the camera image sends this one.
      await Promise.race([picture, delay(this.timings.eventImageWaitMs)]);
      await this.fire(TRIGGERS.DOORBELL, { camera: ids.device, camera_name: camera.name });
    } else {
      await this.pulse(ids.device, FEATURE_KEYS.MOTION, this.timings.pulseMs, () =>
        this.cameraStates(camera),
      );
    }
  }

  /** The picture of an event, published as the camera image. Never throws. */
  async eventPicture(camera, event) {
    if (!event.snapshot) return null;
    const ids = cameraIds(this.gladys, camera.uuid);
    try {
      const image = await this.fetchImage((width) => snapshotUrl(event.snapshot, width), true);
      if (!image) return null;
      this.images.set(ids.device, { image, at: this.now() });
      if (this.isCreated(ids.device)) {
        await this.gladys.publishCameraImage(ids.device, image);
      }
      this.nudgeWidget();
      return image;
    } catch (err) {
      this.problem(
        `image:${camera.uuid}`,
        `No picture for camera ${masked(camera.uuid)} (${err.message})`,
      );
      return null;
    }
  }

  /**
   * A picture that fits Gladys: the widths of IMAGE_WIDTHS in turn. A picture
   * of an event may not exist yet: a 404 is tried again (`retry`).
   */
  async fetchImage(addressOf, retry = false, { firstJpeg = false } = {}) {
    for (const width of IMAGE_WIDTHS) {
      const address = addressOf(width);
      if (!address) return null;
      let bytes;
      for (let attempt = 1; ; attempt += 1) {
        try {
          bytes = await this.client.media(address, { firstJpeg });
          break;
        } catch (err) {
          if (!retry || err.status !== 404 || attempt >= this.timings.imageTries) throw err;
          await delay(this.timings.imageRetryMs);
        }
      }
      const image = toCameraImage(bytes);
      if (image) return image;
    }
    return null;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      this.problem(`trigger:${key}`, `Scene trigger ${key} not sent: ${err.message}`);
    }
  }

  // --- Images ------------------------------------------------------------------

  findCameraByExternalId(externalId) {
    for (const entry of this.systems.values()) {
      for (const camera of entry.system.cameras) {
        if (cameraIds(this.gladys, camera.uuid).device === externalId) return { entry, camera };
      }
    }
    return null;
  }

  /**
   * A live picture when it is safe: a wired camera of the first generation
   * (media.simplisafe.com), whose privacy shutter is open in the current mode
   * — a picture never opens a shutter, nor wakes a battery camera. Otherwise
   * the picture of the last event.
   */
  async getImage(device) {
    const found = this.findCameraByExternalId(device.external_id);
    if (!found) throw new UserError(MESSAGES.unknownDevice);
    const { entry, camera } = found;
    if (this.canLive(entry, camera) && this.canRead()) {
      try {
        const image = await this.fetchImage((width) => liveUrl(camera.uuid, width), false, {
          firstJpeg: true,
        });
        if (image) {
          this.images.set(device.external_id, { image, at: this.now() });
          this.resolved(`live:${camera.uuid}`);
          return image;
        }
      } catch (err) {
        this.problem(
          `live:${camera.uuid}`,
          `No live picture of camera ${masked(camera.uuid)} (${err.message}): the last event picture is used`,
        );
      }
    }
    const last = this.images.get(device.external_id);
    if (last) return last.image;
    throw new UserError(MESSAGES.noImage);
  }

  canLive(entry, camera) {
    if (!camera.live || !camera.wired || !camera.online) return false;
    if (!camera.privacyShutter) return true;
    const mode = entry.system.mode ?? 'off';
    return camera.shutter[mode] === 'open';
  }

  // --- Commands ----------------------------------------------------------------

  requireReady() {
    if (!this.client?.signedIn) throw new UserError(MESSAGES.notSignedIn);
    if (this.authFailed) throw new UserError(CONNECTION_TEXT.authExpired);
  }

  findLock(externalId) {
    for (const entry of this.systems.values()) {
      for (const lock of entry.locks.values()) {
        if (lockIds(this.gladys, entry.system.serial, lock.serial).device === externalId) {
          return { entry, lock };
        }
      }
    }
    return null;
  }

  async setValue(device, feature, value) {
    const found = this.findLock(device.external_id);
    if (
      !found ||
      feature.external_id !==
        lockIds(this.gladys, found.entry.system.serial, found.lock.serial).feature(
          FEATURE_KEYS.LOCK,
        )
    ) {
      throw new Error(`${feature?.external_id ?? 'This feature'} is read-only`);
    }
    const lock = Number(value) === 1;
    await this.setLock(found, lock);
  }

  async setLock({ entry, lock }, locked) {
    this.requireReady();
    if (!locked && !this.config.allowUnlock) throw new UserError(MESSAGES.unlockOff);
    try {
      await this.client.setLock(entry.system.sid, lock.serial, locked ? 'lock' : 'unlock');
    } catch (err) {
      logger.warn(`Lock command refused: ${err.message}`);
      throw new UserError(failureText(err));
    }
    logger.info(`Smart Lock ${masked(lock.serial)} ${locked ? 'locked' : 'unlocked'} from Gladys`);
    lock.state = locked ? 'locked' : 'unlocked';
    await this.sendStates(this.lockStates(entry, lock));
    this.nudgeWidget();
  }

  /** The system a command or a widget is about: the one chosen, or the only one. */
  resolveSystem(externalId) {
    const supported = [...this.systems.values()].filter((entry) => entry.system.version === 3);
    if (externalId) {
      const entry = supported.find(
        (candidate) => systemIds(this.gladys, candidate.system.serial).device === externalId,
      );
      if (!entry) throw new UserError(MESSAGES.unknownDevice);
      return entry;
    }
    if (supported.length === 1) return supported[0];
    throw new UserError(supported.length === 0 ? MESSAGES.notSignedIn : MESSAGES.chooseSystem);
  }

  /**
   * Arm (home, away) or disarm (off), as far as the configuration allows.
   * @param {string|null} systemExternalId
   * @param {'off'|'home'|'away'} mode
   * @param {string} origin for the log: 'widget', 'scene'
   */
  async setArmMode(systemExternalId, mode, origin) {
    this.requireReady();
    if (!this.config.canArm) throw new UserError(MESSAGES.controlOff);
    if (mode === 'off' && !this.config.canDisarm) throw new UserError(MESSAGES.disarmOff);
    const entry = this.resolveSystem(systemExternalId);
    let answer;
    try {
      answer = await this.client.setState(entry.system.sid, mode);
    } catch (err) {
      logger.warn(`Arming command refused: ${err.message}`);
      throw new UserError(failureText(err));
    }
    logger.info(`Alarm set to ${mode} from the ${origin} on ${masked(entry.system.serial)}`);
    const { system } = entry;
    system.mode = mode;
    system.state =
      mode !== 'off' && Number(answer?.exitDelay) > 0
        ? ALARM_STATES.EXIT_DELAY
        : (alarmStateOf(answer?.state) ?? (mode === 'off' ? ALARM_STATES.OFF : mode));
    this.quietAfterArming(entry);
    await this.sendStates(this.systemStates(entry));
    this.nudgeWidget();
    this.scheduleFollowUp(entry.locks.size > 0 ? this.timings.lockQuietMs : undefined);
    return { mode, state: system.state };
  }

  // --- Sign-in -----------------------------------------------------------------

  /** The "Connect" button: a new PKCE verifier, and the sign-in page. */
  async signInUrl() {
    if (!this.client) throw new UserError(MESSAGES.starting);
    const verifier = newCodeVerifier();
    await this.store.update({ signIn: { verifier, at: this.now() } });
    logger.info('Sign-in page of SimpliSafe opened');
    return authorizeUrl({ verifier, deviceId: this.store.get('deviceId') });
  }

  /** "Finish the sign-in": the pasted code for tokens, then the devices. */
  async finishSignIn(pasted) {
    if (!this.client) throw new UserError(MESSAGES.starting);
    const code = extractCode(pasted);
    if (!code) throw new UserError(MESSAGES.codeFormat);
    const flow = this.store.get('signIn');
    if (!flow?.verifier || this.now() - Number(flow.at) > this.timings.signInMs) {
      throw new UserError(MESSAGES.noFlow);
    }
    this.stopSocket();
    const client = this.createClient();
    try {
      await client.exchangeCode(code, flow.verifier);
    } catch (err) {
      logger.warn(`Sign-in refused: ${err.message}`);
      throw new UserError(failureText(err));
    }
    // A code works once: the flow is spent.
    await this.store.update({ signIn: undefined });
    this.client = client;
    this.authFailed = false;
    this.pausedUntil = 0;
    this.pauseStep = 0;
    this.warned.clear();
    this.systems.clear();
    this.discovered = false;
    logger.info('Signed in to SimpliSafe');
    const ok = await this.discover();
    if (!ok) throw new UserError(MESSAGES.unreachable);
    return this.report();
  }

  report() {
    const supported = [...this.systems.values()].filter((entry) => entry.system.version === 3);
    if (supported.length === 0) return CONNECTION_TEXT.noSystem;
    const devices = this.buildDevices().length;
    const systems = supported.map((entry) => entry.system.name || masked(entry.system.serial));
    return connectedReport({ systems, devices });
  }

  async testConnection() {
    this.requireReady();
    try {
      await this.client.authCheck();
      this.applySystems(parseSubscriptions(await this.client.subscriptions()));
    } catch (err) {
      this.readFailed(err);
      await this.publishConnection();
      throw new UserError(failureText(err));
    }
    if (!this.discovered) await this.discover();
    return this.report();
  }

  async signOut() {
    this.stopSocket();
    this.client?.signOut();
    await this.store.update({ refreshToken: undefined, userId: undefined, signIn: undefined });
    this.authFailed = false;
    this.discovered = false;
    this.systems.clear();
    logger.info('Signed out of SimpliSafe');
    await this.publishConnection();
    return MESSAGES.signedOut;
  }

  // --- Widget ------------------------------------------------------------------

  /** What the widget shows of a system (null when there is none to show). */
  view(systemExternalId, language = this.language) {
    let entry;
    try {
      entry = this.resolveSystem(systemExternalId);
    } catch {
      return null;
    }
    const { system } = entry;
    const openings = [...entry.sensors.values()].filter(
      (sensor) => sensor.detections.includes(DETECTIONS.CONTACT) && sensor.triggered === true,
    );
    const lowBatteries = [...entry.sensors.values(), ...entry.locks.values()].filter(
      (device) => device.lowBattery || device.keypadLowBattery,
    );
    return {
      externalId: systemIds(this.gladys, system.serial).device,
      name: system.name,
      state: system.state,
      stateLabel: system.state ? pick(STATE_NAMES, language)[system.state] : null,
      mode: system.mode,
      offline: system.offline,
      powerOutage: system.powerOutage,
      openings: openings.map((sensor) => sensor.name || masked(sensor.serial)),
      lowBatteries: lowBatteries.length,
      alerts: system.messages.length,
      canArm: Boolean(this.config?.canArm),
      canDisarm: Boolean(this.config?.canDisarm),
    };
  }
}
