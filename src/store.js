// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container), in
// /data/simplisafe-state.json, mode 0600:
//   - deviceId: the device id of this installation on the sign-in page, drawn
//     once, as a phone keeps its own;
//   - signIn: the PKCE verifier of the sign-in in progress (between "Connect"
//     and "Finish the sign-in"), with the time it was drawn;
//   - refreshToken, userId: the sign-in of the account. SimpliSafe rotates the
//     refresh token at every renewal: the new one is written at once;
//   - doorbells: the cameras seen ringing (a doorbell model the integration
//     does not know keeps its "doorbell" feature after a restart).
// The access token stays in memory. Nothing of this goes to the Gladys
// configuration, nor to the logs.
// (Adapted from guim31/gladys-ezviz.)
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { newDeviceId } from './simplisafe/auth.js';

const logger = createLogger({ name: 'simplisafe-store' });
const FILE_NAME = 'simplisafe-state.json';

export class Store {
  constructor(directory = process.env.SIMPLISAFE_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.data = {};
    this.pending = null;
    this.writing = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      this.data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      this.data = {};
    }
    if (typeof this.data.deviceId !== 'string' || !/^[0-9A-F-]{36}$/.test(this.data.deviceId)) {
      this.data.deviceId = newDeviceId();
      this.save();
    }
    return this.data;
  }

  get(key) {
    return this.data[key];
  }

  /** Set several keys at once (`undefined` removes one), then write. */
  update(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) {
        delete this.data[key];
      } else {
        this.data[key] = value;
      }
    }
    return this.save();
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save() {
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        this.pending = null;
        const snapshot = JSON.stringify(this.data);
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, snapshot, { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
        } catch (err) {
          logger.warn(`Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
