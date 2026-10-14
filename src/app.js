// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { SimpliSafeHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'simplisafe-app' });

// Manifest actions (`actions`) and their handlers: keys are permanent.
export const ACTIONS = {
  finish_sign_in: (hub, fields = {}) => hub.finishSignIn(fields.address),
  test_connection: (hub) => hub.testConnection(),
  sign_out: (hub) => hub.signOut(),
};

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, request, connectSocket, timers, timings,
 *   socketTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new SimpliSafeHub({
    gladys,
    store: options.store ?? new Store(),
    request: options.request,
    connectSocket: options.connectSocket,
    timers: options.timers ?? true,
    timings: options.timings,
    socketTimings: options.socketTimings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first read is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  // The "Connect" button of the account_link field: the SimpliSafe sign-in page.
  gladys.onOAuthAuthorizeUrl(whenReady(() => hub.signInUrl()));

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  gladys.onGetImage(whenReady((device) => hub.getImage(device)));

  // The hub reads the cloud on its own timer (GladysAssistant/Gladys#3198);
  // this only serves a Gladys that polls anyway, never faster than the timer.
  gladys.onPoll(
    whenReady(async () => {
      await hub.poll();
    }),
  );

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => hub.reconfigure(normalizeConfig(newConfig))));

  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(
      key,
      whenReady((fields) => handler(hub, fields)),
    );
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, extra) => widget.action(hub, { actionKey, params, ...extra })),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
