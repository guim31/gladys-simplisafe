// -----------------------------------------------------------------------------
// The real-time events of the SimpliSafe cloud: one WebSocket per account to
// wss://socketlink.prd.aser.simplisafe.com, as simplisafe-python and
// homebridge-simplisafe3 (both MIT) open it. After the connection, the client
// identifies itself with the access token and joins the namespace of its
// user (`uid:<userId>`); the server answers hello, registered, subscribed,
// then sends one CloudEvents message per event of the systems of the account
// (arming, alarm, entry delay, doorbell, camera motion, lock…).
//
// Kept alive with a WebSocket ping every 55 s (simplipy's heartbeat): a ping
// left without pong closes the socket. A lost socket comes back on its own,
// after 2 s, then 4, 8… up to 5 minutes between attempts.
//
// The socket only says something happened: the states of the REST reads stay
// the reference, and the hub reads them again after a reconnection.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { USER_AGENT } from './client.js';
import { parseEvent, serviceMessageOf } from './model.js';

export const SOCKET_URL = 'wss://socketlink.prd.aser.simplisafe.com';

export const SOCKET_TIMINGS = {
  pingMs: 55_000,
  handshakeMs: 15_000,
  // No "subscribed" this long after the connection: the socket is dropped.
  subscribeMs: 30_000,
  retryBaseMs: 2_000,
  retryMaxMs: 5 * 60_000,
};

/** The identification message, sent right after the connection opens. */
export function identifyMessage({ token, userId }, now = Date.now()) {
  return {
    datacontenttype: 'application/json',
    type: 'com.simplisafe.connection.identify',
    time: new Date(now).toISOString(),
    id: `ts:${now}`,
    specversion: '1.0',
    source: USER_AGENT,
    data: {
      auth: { schema: 'bearer', token },
      join: [`uid:${userId}`],
    },
  };
}

const defaultConnect = (url, { handshakeMs }) =>
  new WebSocket(url, { handshakeTimeout: handshakeMs, headers: { 'User-Agent': USER_AGENT } });

/**
 * Events: 'event' (a parsed event, src/simplisafe/model.js), 'up' (subscribed),
 * 'down' (a subscribed socket was lost), 'failure' (an attempt failed: { error,
 * attempts }).
 */
export class EventSocket extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => Promise<{ token: string, userId: string }>} options.auth
   * @param {Function} [options.connect] (url, timings) => a `ws`-like socket
   * @param {object} [options.timings] SOCKET_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ auth, connect = defaultConnect, timings, now } = {}) {
    super();
    this.auth = auth;
    this.connect = connect;
    this.timings = { ...SOCKET_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.socket = null;
    this.running = false;
    this.up = false;
    this.failures = 0;
    this.timers = {};
    this.awaitingPong = false;
    // Bumped by stop() and restart(): an opening started before is abandoned.
    this.generation = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.open();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.drop();
    this.clear('retry');
  }

  /** Close and open again now (e.g. with a renewed access token). */
  restart() {
    if (!this.running) return;
    this.generation += 1;
    this.drop();
    this.clear('retry');
    this.failures = 0;
    this.open();
  }

  clear(name) {
    const timer = this.timers[name];
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      delete this.timers[name];
    }
  }

  later(name, ms, fn, repeat = false) {
    this.clear(name);
    const timer = repeat ? setInterval(fn, ms) : setTimeout(fn, ms);
    timer.unref?.();
    this.timers[name] = timer;
  }

  /** Close the current socket without scheduling anything. */
  drop() {
    this.clear('ping');
    this.clear('subscribe');
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => {}); // a late error of a socket we let go of
      try {
        socket.terminate();
      } catch {
        // already closed
      }
    }
    if (this.up) {
      this.up = false;
      this.emit('down');
    }
  }

  async open() {
    const generation = this.generation;
    let credentials;
    try {
      credentials = await this.auth();
    } catch (err) {
      if (generation === this.generation) this.failed(err);
      return;
    }
    if (!this.running || this.socket || generation !== this.generation) return;
    let socket;
    try {
      socket = this.connect(SOCKET_URL, this.timings);
    } catch (err) {
      this.failed(err);
      return;
    }
    this.socket = socket;
    this.awaitingPong = false;
    socket.on('open', () => {
      if (socket !== this.socket) return;
      socket.send(JSON.stringify(identifyMessage(credentials, this.now())));
      this.later('subscribe', this.timings.subscribeMs, () =>
        this.lost(socket, new Error('no subscription from the server')),
      );
    });
    socket.on('message', (raw) => this.received(socket, raw));
    socket.on('pong', () => {
      this.awaitingPong = false;
    });
    socket.on('unexpected-response', (_request, response) =>
      this.lost(socket, new Error(`HTTP ${response?.statusCode ?? '?'}`)),
    );
    socket.on('error', (err) => this.lost(socket, err));
    socket.on('close', (code) => this.lost(socket, new Error(`closed (${code ?? '-'})`)));
  }

  received(socket, raw) {
    if (socket !== this.socket) return;
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (serviceMessageOf(message) === 'subscribed') {
      this.clear('subscribe');
      this.failures = 0;
      if (!this.up) {
        this.up = true;
        this.emit('up');
      }
      this.later(
        'ping',
        this.timings.pingMs,
        () => {
          if (this.awaitingPong) {
            this.lost(socket, new Error('no pong'));
            return;
          }
          this.awaitingPong = true;
          try {
            socket.ping();
          } catch (err) {
            this.lost(socket, err);
          }
        },
        true,
      );
      return;
    }
    const event = parseEvent(message);
    if (event) this.emit('event', event);
  }

  lost(socket, error) {
    if (socket !== this.socket) return;
    this.drop();
    this.failed(error);
  }

  failed(error) {
    if (!this.running) return;
    this.failures += 1;
    this.emit('failure', { error, attempts: this.failures });
    const wait = Math.min(
      this.timings.retryBaseMs * 2 ** (this.failures - 1),
      this.timings.retryMaxMs,
    );
    this.later('retry', wait, () => {
      delete this.timers.retry;
      if (this.running && !this.socket) this.open();
    });
  }
}
