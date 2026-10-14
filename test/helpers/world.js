// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake SimpliSafe cloud and
// its WebSocket, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No periodic timer runs unless
// `timers: true` (with node:test mock timers): the tests read the cloud with
// `world.hub.refresh()` and push events with `world.cloud.socketServer.push()`.
// -----------------------------------------------------------------------------

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeCloud, REFRESH_TOKEN, SID, SYSTEM_SERIAL, USER_ID } from './fakeCloud.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  alarm_control: 'full',
  allow_unlock: false,
  refresh_interval: '60',
  language: 'en',
};

/** A manual clock. */
export function createClock(start = Date.UTC(2026, 9, 14, 12, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the handlers, the fake network and the fake socket settle. */
export async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {FakeCloud} [options.cloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.signedIn] a sign-in saved in /data
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] HUB_TIMINGS overrides
 */
export async function createWorld({
  clock = createClock(),
  cloud = new FakeCloud(),
  config = BASE_CONFIG,
  devices = [],
  signedIn = true,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-simplisafe-')),
  timings = {},
  socketTimings = {},
  timers = false,
} = {}) {
  if (signedIn) {
    writeFileSync(
      join(dataDir, 'simplisafe-state.json'),
      JSON.stringify({ refreshToken: REFRESH_TOKEN, userId: USER_ID }),
    );
  }
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: cloud.request,
    connectSocket: cloud.socketServer.connect,
    timers,
    timings: {
      pulseMs: 50,
      ringMs: 50,
      imageRetryMs: 1,
      eventImageWaitMs: 500,
      ...timings,
    },
    socketTimings: { retryBaseMs: 5, ...socketTimings },
    now: clock.now,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    cloud,
    socket: cloud.socketServer,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return world;
}

export const systemIds = (gladys) => gladys.externalIds('system', SYSTEM_SERIAL);
export const sensorIds = (gladys, serial) =>
  gladys.externalIds('sensor', `${SYSTEM_SERIAL}-${serial}`);
export const lockIds = (gladys, serial) => gladys.externalIds('lock', `${SYSTEM_SERIAL}-${serial}`);
export const cameraIds = (gladys, uuid) => gladys.externalIds('camera', uuid);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

/** The discovered device of an external id. */
export const discovered = (world, externalId) =>
  world.fake.discoveredDevices.find((device) => device.external_id === externalId);

export { SID, SYSTEM_SERIAL, USER_ID };
