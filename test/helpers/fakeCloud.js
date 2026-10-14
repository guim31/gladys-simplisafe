// -----------------------------------------------------------------------------
// An in-memory SimpliSafe cloud behind the `request` seam of
// src/simplisafe/http.js, and behind the socket seam of
// src/simplisafe/socket.js: the token endpoint (authorization code with PKCE,
// rotating refresh tokens), the API (authCheck, subscriptions, sensors,
// settings, state, door lock) answering the fixtures of simplisafe-python,
// the media servers (event snapshots, live views), and the WebSocket
// (identify, hello, registered, subscribed, events). Every request is
// recorded; nothing touches the network.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { firstJpegOf } from '../../src/image.js';
import { codeChallenge } from '../../src/simplisafe/auth.js';
import { NetworkError } from '../../src/simplisafe/http.js';

export const USER_ID = '12345';
export const SID = '12345';
export const SYSTEM_SERIAL = '1234ABCD';
// A 45-character authorization code, like the SimpliSafe tenant hands out.
export const CODE = 'q3Zr8Xw1Kp0Lm7Nb2Vc9Hd4Js6Fg5Ta1Ye8Ui3Op0As7';
export const REFRESH_TOKEN = 'refresh-token-0';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/simplisafe/${name}`, import.meta.url), 'utf8'));

/**
 * A small JPEG for the tests: SOI, an APP1 segment holding an EXIF-like
 * thumbnail (its own FF D8 … FF D9, to catch a naive cut), a scan, EOI.
 */
export function fakeJpeg(size = 600, shade = 0x42) {
  const thumbnail = Buffer.from([0xff, 0xd8, 0x00, 0x11, 0xff, 0xd9]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 2 + thumbnail.length]), thumbnail]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scan = Buffer.alloc(Math.max(1, size), shade);
  // A stuffed FF 00 and a restart marker inside the scan, as real pictures have.
  scan[0] = 0xff;
  scan[1] = 0x00;
  if (scan.length > 4) {
    scan[2] = 0xff;
    scan[3] = 0xd0;
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos, scan, Buffer.from([0xff, 0xd9])]);
}

const json = (status, body) => ({ status, body: Buffer.from(JSON.stringify(body)) });

/** A WebSocket message: the CloudEvents envelope of simplisafe-python's tests. */
export const envelope = (type, data, source = 'service') => ({
  ...(data === undefined ? {} : { data }),
  datacontenttype: 'application/json',
  id: 'id:16803409109',
  source,
  specversion: '1.0',
  time: '2026-10-14T12:00:00.000Z',
  type,
});

/** One fake WebSocket, `ws`-like: events open, message, pong, close, error. */
class FakeSocket extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.sent = [];
    this.closed = false;
    setImmediate(() => {
      if (this.server.refuse) {
        this.emit('error', new Error('connect ECONNREFUSED'));
        return;
      }
      if (!this.closed) this.emit('open');
    });
  }

  send(raw) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.type !== 'com.simplisafe.connection.identify') return;
    const { auth, join } = message.data ?? {};
    if (!this.server.cloud.accessTokens.has(auth?.token) || join?.[0] !== `uid:${USER_ID}`) {
      setImmediate(() => this.close(4001));
      return;
    }
    this.identified = auth.token;
    if (this.server.silent) return;
    setImmediate(() => {
      this.receive(envelope('com.simplisafe.service.hello', fixture('ws-message-hello-data.json')));
      this.receive(envelope('com.simplisafe.service.registered'));
      this.receive(
        envelope('com.simplisafe.service.subscribed', fixture('ws-message-subscribed-data.json')),
      );
    });
  }

  receive(message) {
    if (!this.closed) this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  ping() {
    this.server.pings += 1;
    if (!this.server.noPong) setImmediate(() => !this.closed && this.emit('pong'));
  }

  close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code);
  }

  terminate() {
    this.close(1006);
  }
}

export class FakeSocketServer {
  constructor(cloud) {
    this.cloud = cloud;
    this.sockets = [];
    this.pings = 0;
    this.noPong = false;
    this.silent = false;
    this.refuse = false;
    this.connect = (url) => {
      this.urls = [...(this.urls ?? []), url];
      const socket = new FakeSocket(this);
      this.sockets.push(socket);
      return socket;
    };
  }

  /** The socket the integration currently listens to. */
  get current() {
    return [...this.sockets].reverse().find((socket) => !socket.closed && socket.identified);
  }

  /** Push an event (the `data` of the message) to the open socket. */
  push(data) {
    const socket = this.current;
    if (!socket) throw new Error('no open socket');
    socket.receive(envelope('com.simplisafe.event.standard', data, 'messagequeue'));
  }
}

/** An event of the system of the fixtures, from the disarm event of simplisafe-python. */
export function eventData(overrides = {}) {
  return {
    ...fixture('ws-message-event-data.json'),
    sid: Number(SID),
    eventTimestamp: Math.floor(Date.UTC(2026, 9, 14, 12) / 1000),
    ...overrides,
  };
}

export class FakeCloud {
  constructor() {
    this.subscriptions = fixture('subscriptions-response.json');
    this.sensorList = fixture('v3-sensors-response.json');
    this.settingsBody = fixture('v3-settings-response.json');
    this.code = CODE;
    this.challenge = null; // set from the sign-in page the integration opened
    this.usedCodes = new Set();
    this.refreshTokens = new Set([REFRESH_TOKEN]);
    this.accessTokens = new Set();
    this.counter = 0;
    this.online = true;
    this.blocked = false; // 403 on the API, as when SimpliSafe rate-limits
    this.busy = false; // 409 on the sensors
    this.noRemote = false; // the plan does not allow remote control
    this.exitDelay = 0;
    this.media = new Map(); // url (without query) → { status, body } or a function
    this.liveJpeg = fakeJpeg(800);
    this.requests = [];
    this.socketServer = new FakeSocketServer(this);
    this.request = (options) => this.handle(options);
  }

  get system() {
    return this.subscriptions.subscriptions[0].location.system;
  }

  sensor(serial) {
    return this.sensorList.sensors.find((sensor) => sensor.serial === serial);
  }

  issueTokens() {
    this.counter += 1;
    const access = `access-token-${this.counter}`;
    const refresh = `refresh-token-${this.counter}`;
    this.accessTokens.add(access);
    this.refreshTokens.add(refresh);
    return {
      ...fixture('api-token-response.json'),
      access_token: access,
      refresh_token: refresh,
      id_token: `id-token-${this.counter}`,
    };
  }

  /** Every token given so far: none may ever reach a log. */
  secrets() {
    const tokens = [];
    for (let i = 0; i <= this.counter; i += 1) {
      tokens.push(`access-token-${i}`, `refresh-token-${i}`, `id-token-${i}`);
    }
    return [...tokens, CODE];
  }

  /** Make every access token invalid (expired, revoked). */
  expireAccessTokens() {
    this.accessTokens.clear();
  }

  async handle({ method = 'GET', url, headers = {}, json: body, firstJpeg = false }) {
    const parsed = new URL(url);
    const record = { method, host: parsed.hostname, path: parsed.pathname, query: parsed.search };
    this.requests.push(record);
    await new Promise((resolve) => setImmediate(resolve));
    if (!this.online) {
      throw new NetworkError('ENOTFOUND', 'ENOTFOUND');
    }
    if (parsed.hostname === 'auth.simplisafe.com') return this.token(body);
    const bearer = String(headers.Authorization ?? '').replace(/^Bearer /, '');
    if (parsed.hostname === 'api.simplisafe.com') {
      if (!this.accessTokens.has(bearer)) return json(401, 'Unauthorized');
      if (this.blocked) return json(403, { message: 'Forbidden' });
      return this.api(method, parsed, body);
    }
    if (!this.accessTokens.has(bearer)) return { status: 401, body: Buffer.alloc(0) };
    return this.mediaAnswer(parsed, firstJpeg);
  }

  token(body = {}) {
    if (body.client_id !== '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5') {
      return json(401, { error: 'access_denied', error_description: 'Unauthorized' });
    }
    if (body.grant_type === 'authorization_code') {
      const valid =
        body.code === this.code &&
        !this.usedCodes.has(body.code) &&
        this.challenge !== null &&
        codeChallenge(String(body.code_verifier)) === this.challenge &&
        body.redirect_uri ===
          'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
      if (!valid) return json(403, fixture('invalid-authorization-code-response.json'));
      this.usedCodes.add(body.code);
      return json(200, this.issueTokens());
    }
    if (body.grant_type === 'refresh_token') {
      if (!this.refreshTokens.has(body.refresh_token)) {
        return json(403, fixture('invalid-refresh-token-response.json'));
      }
      // Rotation: the token used is spent.
      this.refreshTokens.delete(body.refresh_token);
      return json(200, this.issueTokens());
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  api(method, parsed, body) {
    const path = parsed.pathname.replace(/^\/v1\//, '');
    if (method === 'GET' && path === 'api/authCheck') {
      return json(200, fixture('auth-check-response.json'));
    }
    if (method === 'GET' && path === `users/${USER_ID}/subscriptions`) {
      return json(200, this.subscriptions);
    }
    if (method === 'GET' && path === `ss3/subscriptions/${SID}/sensors`) {
      if (this.busy) return json(409, { type: 'SettingsInProgress', message: 'busy' });
      return json(200, this.sensorList);
    }
    if (method === 'GET' && path === `ss3/subscriptions/${SID}/settings/normal`) {
      return json(200, this.settingsBody);
    }
    const state = path.match(new RegExp(`^ss3/subscriptions/${SID}/state/(off|home|away)$`));
    if (method === 'POST' && state) {
      if (this.noRemote) return json(403, fixture('unavailable-endpoint-response.json'));
      const next = state[1].toUpperCase();
      const delayed = next !== 'OFF' && this.exitDelay > 0;
      this.system.alarmState = delayed ? `${next}_COUNT` : next;
      return json(200, {
        ...fixture('v3-state-response.json'),
        state: next,
        exitDelay: delayed ? this.exitDelay : 0,
      });
    }
    const lock = path.match(new RegExp(`^doorlock/${SID}/([^/]+)/state$`));
    if (method === 'POST' && lock) {
      const sensor = this.sensor(decodeURIComponent(lock[1]));
      if (!sensor || !['lock', 'unlock'].includes(body?.state)) return json(400, { error: 'bad' });
      sensor.status.lockState = body.state === 'lock' ? 1 : 2;
      return json(200, { success: true });
    }
    return json(404, { message: `no route ${method} ${path}` });
  }

  mediaAnswer(parsed, firstJpeg) {
    const key = `${parsed.origin}${parsed.pathname}`;
    const answer = this.media.get(key);
    if (typeof answer === 'function') return answer(parsed, firstJpeg);
    if (answer) return answer;
    if (parsed.hostname === 'media.simplisafe.com' && parsed.pathname.endsWith('/mjpg')) {
      // An endless MJPEG stream, cut by the client at the first picture.
      const boundary = Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n');
      const frames = Buffer.concat([boundary, this.liveJpeg, boundary, this.liveJpeg]);
      // http.js stops reading at the first complete picture.
      return { status: 200, body: firstJpeg ? firstJpegOf(frames) : frames };
    }
    return { status: 404, body: Buffer.alloc(0) };
  }
}
