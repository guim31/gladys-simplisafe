// -----------------------------------------------------------------------------
// The WebSocket of the SimpliSafe cloud, against the fake socket server:
// identification with the access token and the user namespace, events,
// keep-alive pings, reconnection with backoff, restart with a new token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventSocket, SOCKET_URL, identifyMessage } from '../src/simplisafe/socket.js';
import { FakeCloud, USER_ID, eventData } from './helpers/fakeCloud.js';
import { settle } from './helpers/world.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(t, timings = {}) {
  const cloud = new FakeCloud();
  cloud.accessTokens.add('token-a');
  let token = 'token-a';
  const socket = new EventSocket({
    auth: async () => ({ token, userId: USER_ID }),
    connect: cloud.socketServer.connect,
    timings: { retryBaseMs: 5, retryMaxMs: 20, pingMs: 1_000, subscribeMs: 500, ...timings },
  });
  const seen = { events: [], up: 0, down: 0, failures: [] };
  socket.on('event', (event) => seen.events.push(event));
  socket.on('up', () => (seen.up += 1));
  socket.on('down', () => (seen.down += 1));
  socket.on('failure', (failure) => seen.failures.push(failure));
  t.after(() => socket.stop());
  return { cloud, server: cloud.socketServer, socket, seen, setToken: (next) => (token = next) };
}

test('the identification carries the bearer token and joins the user namespace', () => {
  const message = identifyMessage({ token: 'abc', userId: '12345' }, Date.UTC(2026, 9, 14));
  assert.equal(message.type, 'com.simplisafe.connection.identify');
  assert.equal(message.specversion, '1.0');
  assert.equal(message.time, '2026-10-14T00:00:00.000Z');
  assert.deepEqual(message.data, { auth: { schema: 'bearer', token: 'abc' }, join: ['uid:12345'] });
});

test('identified and subscribed, then the events of the account arrive', async (t) => {
  const { server, socket, seen } = setup(t);
  socket.start();
  await settle();
  assert.deepEqual(server.urls, [SOCKET_URL]);
  assert.equal(seen.up, 1);
  assert.equal(socket.up, true);
  server.push(eventData({ eventCid: 3441, sensorType: 0 }));
  await settle(5);
  assert.equal(seen.events.length, 1);
  assert.equal(seen.events[0].type, 'armed');
  assert.equal(seen.events[0].mode, 'home');
  // Garbage is ignored.
  server.current.emit('message', Buffer.from('not json'));
  await settle(5);
  assert.equal(seen.events.length, 1);
});

test('a socket closed by the server comes back on its own', async (t) => {
  const { server, socket, seen } = setup(t);
  socket.start();
  await settle();
  server.current.close(1006);
  await settle();
  assert.equal(seen.down, 1);
  await sleep(20);
  await settle();
  assert.equal(seen.up, 2);
  assert.equal(server.sockets.length, 2);
  assert.equal(seen.failures.length, 1);
});

test('a ping left without pong drops the socket, and it reconnects', async (t) => {
  const { server, socket, seen } = setup(t, { pingMs: 15 });
  socket.start();
  await settle();
  server.noPong = true;
  await sleep(60);
  await settle();
  assert.ok(seen.down >= 1);
  assert.ok(seen.failures.some((failure) => /no pong/.test(failure.error.message)));
  server.noPong = false;
  await sleep(40);
  await settle();
  assert.equal(socket.up, true);
});

test('a refused token never subscribes: retried with backoff, then works with a new one', async (t) => {
  const { cloud, server, socket, seen, setToken } = setup(t);
  setToken('revoked');
  socket.start();
  await sleep(30);
  await settle();
  assert.equal(seen.up, 0);
  assert.ok(seen.failures.length >= 2);
  assert.ok(seen.failures.at(-1).attempts >= 2);
  cloud.accessTokens.add('token-b');
  setToken('token-b');
  await sleep(40);
  await settle();
  assert.equal(seen.up, 1);
  assert.equal(server.current.identified, 'token-b');
});

test('restart() identifies again at once (a renewed token); stop() ends it all', async (t) => {
  const { cloud, server, socket, setToken } = setup(t);
  socket.start();
  await settle();
  cloud.accessTokens.add('token-c');
  setToken('token-c');
  socket.restart();
  await settle();
  assert.equal(server.current.identified, 'token-c');
  socket.stop();
  await sleep(30);
  assert.equal(server.current, undefined);
  const count = server.sockets.length;
  await sleep(30);
  assert.equal(server.sockets.length, count);
});
