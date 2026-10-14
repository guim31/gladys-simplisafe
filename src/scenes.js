// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`), registered per key by src/app.js.
// Scene triggers need no handler: the hub fires them (src/hub.js TRIGGERS).
//
//   set_alarm_mode — arm (home, away) or disarm a SimpliSafe system, as far
//   as the configuration allows ("Arming from Gladys"). Output: the state
//   the system went to (an exit delay when the system has one).
// -----------------------------------------------------------------------------

import { ARM_MODES } from './simplisafe/model.js';
import { UserError } from './hub.js';
import { MESSAGES } from './texts.js';

export const SCENE_ACTIONS = {
  async set_alarm_mode(hub, { fields = {} }) {
    const mode = String(fields.mode ?? '');
    if (!ARM_MODES.includes(mode)) throw new UserError(MESSAGES.failed);
    const { state } = await hub.setArmMode(fields.system || null, mode, 'scene');
    return { state };
  },
};
