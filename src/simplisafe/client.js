// -----------------------------------------------------------------------------
// The SimpliSafe cloud API (api.simplisafe.com/v1), as the apps use it and
// bachya/simplisafe-python (MIT) documents it. There is no public API: these
// are the endpoints of the apps, unofficial, without a published quota.
//
// Tokens: the sign-in gives an access token (one hour) and a refresh token.
// SimpliSafe rotates the refresh token: each renewal returns a new one and
// the previous one stops working, so every new one is handed to `onTokens`
// (saved under /data) before anything else, and only one renewal runs at a
// time — two renewals racing with the same token would sign the account out.
//
// Errors are SimpliSafeError with a `kind` (ERROR_KINDS) the hub acts on:
// AUTH (sign in again), NO_REMOTE (the plan does not allow remote control),
// RATE_LIMITED (wait), BUSY (the base station is syncing: 409), NETWORK,
// SERVER, API (anything else).
// -----------------------------------------------------------------------------

import { AUTH_BASE, CLIENT_ID, REDIRECT_URI } from './auth.js';
import { NetworkError, httpRequest } from './http.js';

export const API_BASE = 'https://api.simplisafe.com/v1';

// The user agent of simplipy (Safari on macOS): the cloud is known to answer it.
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15';

export const ERROR_KINDS = Object.freeze({
  NOT_SIGNED_IN: 'not_signed_in',
  AUTH: 'auth',
  BAD_CODE: 'bad_code',
  NO_REMOTE: 'no_remote',
  RATE_LIMITED: 'rate_limited',
  BUSY: 'busy',
  NETWORK: 'network',
  SERVER: 'server',
  API: 'api',
});

export class SimpliSafeError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'SimpliSafeError';
    this.kind = kind;
    this.status = status;
  }
}

// Renew the access token this long before it expires.
const RENEW_MARGIN_MS = 5 * 60_000;
const DEFAULT_LIFETIME_S = 3600;

/** The JSON of an answer; the cloud sometimes answers a quoted string. */
function parseBody(body) {
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    return typeof data === 'string' ? { error: data } : (data ?? {});
  } catch {
    return { type: 'DataParsingError', message: raw.slice(0, 200) };
  }
}

const describe = (data, status) => {
  const detail =
    (typeof data?.message === 'string' && data.message) ||
    (typeof data?.error_description === 'string' && data.error_description) ||
    (typeof data?.error === 'string' && data.error) ||
    '';
  return `HTTP ${status}${detail ? `: ${detail.slice(0, 120)}` : ''}`;
};

function apiError(status, data) {
  if (data?.type === 'NoRemoteManagement') {
    return new SimpliSafeError(ERROR_KINDS.NO_REMOTE, describe(data, status), status);
  }
  // homebridge-simplisafe3: a 403 is how SimpliSafe blocks a client that asks too often.
  if (status === 403 || status === 429) {
    return new SimpliSafeError(ERROR_KINDS.RATE_LIMITED, describe(data, status), status);
  }
  if (status === 409) return new SimpliSafeError(ERROR_KINDS.BUSY, describe(data, status), status);
  if (status >= 500) return new SimpliSafeError(ERROR_KINDS.SERVER, describe(data, status), status);
  return new SimpliSafeError(ERROR_KINDS.API, describe(data, status), status);
}

function networkError(err) {
  return new SimpliSafeError(
    ERROR_KINDS.NETWORK,
    err instanceof NetworkError ? `network: ${err.code}` : `network: ${err.message}`,
  );
}

export class SimpliSafeClient {
  /**
   * @param {object} [options]
   * @param {Function} [options.request] HTTP seam (src/simplisafe/http.js)
   * @param {{ refreshToken?: string, userId?: string }} [options.tokens] saved sign-in
   * @param {(tokens: { refreshToken: string|null, userId: string|null }) => Promise|void} [options.onTokens]
   * @param {() => number} [options.now]
   */
  constructor({ request = httpRequest, tokens = {}, onTokens = () => {}, now } = {}) {
    this.request = request;
    this.onTokens = onTokens;
    this.now = now ?? (() => Date.now());
    this.refreshToken = tokens.refreshToken || null;
    this.userId = tokens.userId ? String(tokens.userId) : null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.renewing = null;
  }

  get signedIn() {
    return Boolean(this.refreshToken);
  }

  // --- Tokens ------------------------------------------------------------------

  async tokenRequest(json) {
    let response;
    try {
      response = await this.request({
        method: 'POST',
        url: `${AUTH_BASE}/oauth/token`,
        headers: { 'User-Agent': USER_AGENT },
        json,
      });
    } catch (err) {
      throw networkError(err);
    }
    const data = parseBody(response.body);
    if (response.status >= 200 && response.status < 300 && typeof data.access_token === 'string') {
      return data;
    }
    return { failed: true, status: response.status, data };
  }

  async saveTokens(data) {
    this.accessToken = data.access_token;
    const lifetime = Number(data.expires_in) > 0 ? Number(data.expires_in) : DEFAULT_LIFETIME_S;
    this.expiresAt = this.now() + lifetime * 1000;
    if (typeof data.refresh_token === 'string' && data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    await this.onTokens({ refreshToken: this.refreshToken, userId: this.userId });
  }

  /**
   * Trade the authorization code of the sign-in page for tokens, then read
   * the user id of the account.
   */
  async exchangeCode(code, verifier) {
    const result = await this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code_verifier: verifier,
      code,
      redirect_uri: REDIRECT_URI,
    });
    if (result.failed) {
      const { status, data } = result;
      if (status >= 500) throw apiError(status, data);
      if (status === 429) throw apiError(status, data);
      // invalid_grant: a wrong, expired or already used code, or another verifier.
      throw new SimpliSafeError(ERROR_KINDS.BAD_CODE, describe(data, status), status);
    }
    this.userId = null;
    await this.saveTokens(result);
    await this.authCheck();
    return this.userId;
  }

  /** Renew the access token (one renewal at a time). */
  renew() {
    if (!this.renewing) {
      this.renewing = (async () => {
        if (!this.refreshToken) {
          throw new SimpliSafeError(ERROR_KINDS.NOT_SIGNED_IN, 'not signed in');
        }
        const result = await this.tokenRequest({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: this.refreshToken,
        });
        if (result.failed) {
          const { status, data } = result;
          if (status >= 500 || status === 429) throw apiError(status, data);
          // invalid_grant, 401, 403: the refresh token is no longer valid
          // (password changed, signed out, already used).
          throw new SimpliSafeError(ERROR_KINDS.AUTH, describe(data, status), status);
        }
        await this.saveTokens(result);
      })().finally(() => {
        this.renewing = null;
      });
    }
    return this.renewing;
  }

  /** A valid access token, renewed when it is about to expire. */
  async token() {
    if (!this.accessToken || this.now() >= this.expiresAt - RENEW_MARGIN_MS) {
      await this.renew();
    }
    return this.accessToken;
  }

  /** Forget the sign-in (the saved tokens are removed by the caller). */
  signOut() {
    this.refreshToken = null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.userId = null;
  }

  // --- API ---------------------------------------------------------------------

  /**
   * One API call. A 401 renews the token once and tries again (the token may
   * have been revoked before its expiry).
   */
  async api(method, path, { query, json, retried = false } = {}) {
    const token = await this.token();
    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await this.request({
        method,
        url: url.toString(),
        headers: { 'User-Agent': USER_AGENT, Authorization: `Bearer ${token}` },
        json,
      });
    } catch (err) {
      throw networkError(err);
    }
    const data = parseBody(response.body);
    if (response.status === 401 && !retried) {
      this.accessToken = null;
      return this.api(method, path, { query, json, retried: true });
    }
    if (response.status < 200 || response.status >= 300 || data?.type === 'NoRemoteManagement') {
      throw apiError(response.status, data);
    }
    return data;
  }

  async authCheck() {
    const data = await this.api('GET', 'api/authCheck');
    const userId = data?.userId;
    if (userId === undefined || userId === null || userId === '') {
      throw new SimpliSafeError(ERROR_KINDS.API, 'authCheck: no user id');
    }
    const changed = String(userId) !== this.userId;
    this.userId = String(userId);
    if (changed) {
      await this.onTokens({ refreshToken: this.refreshToken, userId: this.userId });
    }
    return this.userId;
  }

  async requireUser() {
    if (!this.userId) await this.authCheck();
    return this.userId;
  }

  async subscriptions() {
    const userId = await this.requireUser();
    return this.api('GET', `users/${encodeURIComponent(userId)}/subscriptions`, {
      query: { activeOnly: 'true' },
    });
  }

  /**
   * The sensors and locks. `force` makes the cloud ask the base station for
   * fresh values instead of its cache (what Home Assistant does at every
   * read of a SimpliSafe 3 system).
   */
  sensors(sid, force = true) {
    return this.api('GET', `ss3/subscriptions/${encodeURIComponent(sid)}/sensors`, {
      query: { forceUpdate: force ? 'true' : 'false' },
    });
  }

  settings(sid) {
    return this.api('GET', `ss3/subscriptions/${encodeURIComponent(sid)}/settings/normal`, {
      query: { forceUpdate: 'false' },
    });
  }

  /** Arm (home, away) or disarm (off) a SimpliSafe 3 system. */
  setState(sid, mode) {
    return this.api('POST', `ss3/subscriptions/${encodeURIComponent(sid)}/state/${mode}`);
  }

  /** Lock or unlock a Smart Lock (`state`: 'lock' | 'unlock'). */
  setLock(sid, serial, state) {
    return this.api(
      'POST',
      `doorlock/${encodeURIComponent(sid)}/${encodeURIComponent(serial)}/state`,
      { json: { state } },
    );
  }

  /** A picture of the media servers (a snapshot address, a live view). */
  async media(url, { firstJpeg = false } = {}) {
    const token = await this.token();
    let response;
    try {
      response = await this.request({
        method: 'GET',
        url,
        headers: { 'User-Agent': USER_AGENT, Authorization: `Bearer ${token}` },
        firstJpeg,
        timeoutMs: 12_000,
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status < 200 || response.status >= 300) {
      throw apiError(response.status, {});
    }
    return response.body;
  }
}
