// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The sign-in holds no value here: the "Connect" button (account_link) and
// the "Finish the sign-in" action leave the tokens in /data (src/store.js).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of the systems and their sensors. Home Assistant
// reads every 30 s; one minute by default leaves the cloud alone, the
// WebSocket brings arming, alarms, the doorbell and the locks in real time.
export const REFRESH_INTERVALS = ['30', '60', '120', '300'];

// What Gladys may do with the alarm: nothing (it shows the state), arm it
// (home, away), or arm and disarm it. Values stored in the configuration:
// never change one.
export const ALARM_CONTROLS = ['off', 'arm', 'full'];

export const DEFAULT_CONFIG = {
  alarm_control: 'off',
  allow_unlock: false,
  refresh_interval: '60',
  language: 'fr',
};

const pickOption = (value, options, fallback) =>
  options.includes(String(value ?? '')) ? String(value) : fallback;

// A boolean field may arrive as a string from older form engines.
const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const control = pickOption(source.alarm_control, ALARM_CONTROLS, DEFAULT_CONFIG.alarm_control);
  return {
    alarmControl: control,
    canArm: control !== 'off',
    canDisarm: control === 'full',
    allowUnlock: flag(source.allow_unlock, DEFAULT_CONFIG.allow_unlock),
    refreshMs:
      Number(
        pickOption(source.refresh_interval, REFRESH_INTERVALS, DEFAULT_CONFIG.refresh_interval),
      ) * 1000,
    language: pickOption(source.language, LANGUAGES, DEFAULT_CONFIG.language),
  };
}
