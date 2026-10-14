// -----------------------------------------------------------------------------
// The container refreshes itself. Gladys polls unreliably
// (GladysAssistant/Gladys#3198: a device created without should_poll is never
// polled, even once the core is fixed), so the states must follow the cloud
// with no onPoll at all — on the interval of the configuration — and an
// unchanged value must be sent again before Gladys shows it as stale.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  BASE_CONFIG,
  createAll,
  createWorld,
  sensorIds,
  settle,
  systemIds,
} from './helpers/world.js';

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.UTC(2026, 9, 14, 12),
  });
  // The hub reads the mocked clock, which the ticks move.
  const clock = { now: () => Date.now() };
  const w = await createWorld({ timers: true, clock, ...options });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

async function tick(t, ms, step = ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    t.mock.timers.tick(step);
    await settle(60);
  }
}

const reads = (w) =>
  w.cloud.requests.filter((r) => r.host === 'api.simplisafe.com' && r.path.endsWith('/sensors'))
    .length;

test('the states follow the cloud on the internal timer, without any onPoll', async (t) => {
  const w = await timedWorld(t);
  assert.ok(
    w.fake.discoveredDevices.every((d) => d.should_poll === true && d.poll_frequency === 60_000),
  );
  const contact = sensorIds(w.gladys, '825').feature('contact');
  assert.equal(w.fake.lastState(contact), 1);
  w.cloud.sensor('825').status.triggered = true; // the door opens
  w.cloud.system.alarmState = 'HOME';
  const before = reads(w);
  await tick(t, 60_000);
  assert.equal(reads(w) - before, 1);
  assert.equal(w.fake.lastState(contact), 0);
  assert.equal(w.fake.lastState(systemIds(w.gladys).feature('state')), 'home');
  await tick(t, 60_000);
  assert.equal(reads(w) - before, 2);
  // The test never calls fake.poll(): every read came from the timer.
});

test('the interval of the configuration is followed', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, refresh_interval: '300' } });
  const before = reads(w);
  await tick(t, 240_000, 60_000);
  assert.equal(reads(w), before);
  await tick(t, 60_000);
  assert.equal(reads(w) - before, 1);
});

test('an unchanged value is sent again within 12 hours (heartbeat)', async (t) => {
  assert.ok(HUB_TIMINGS.heartbeatMs <= 12 * 60 * 60_000);
  const w = await timedWorld(t, { timings: { heartbeatMs: 5 * 60_000 } });
  const online = systemIds(w.gladys).feature('online');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === online).length;
  const first = count();
  await tick(t, 60_000);
  assert.equal(count(), first, 'unchanged: not sent');
  await tick(t, 4 * 60_000, 60_000);
  assert.equal(count(), first + 1, 'heartbeat');
});

test("the core's onPoll is a fallback: it never reads more often than the timer", async (t) => {
  const w = await timedWorld(t);
  await tick(t, 60_000);
  const before = reads(w);
  const [device] = w.fake.discoveredDevices;
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(reads(w), before, 'the timer just read');
  // The timer stalls (Gladys reachable, timer gone): onPoll takes over.
  clearTimeout(w.hub.timer);
  t.mock.timers.tick(60_000);
  await settle();
  await w.fake.poll(device);
  await settle();
  assert.equal(reads(w), before + 1);
});

test('the timers stop with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const requests = w.cloud.requests.length;
  await tick(t, 60 * 60_000, 5 * 60_000);
  assert.equal(w.cloud.requests.length, requests);
});
