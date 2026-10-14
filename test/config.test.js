// -----------------------------------------------------------------------------
// The configuration, normalized: safe defaults (no arming, no unlocking from
// Gladys), what each level of "Arming from Gladys" allows, and forgiving
// parsing of what older form engines send.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';

test('the defaults: nothing driven from Gladys, a read every minute, French names', () => {
  assert.deepEqual(normalizeConfig(), {
    alarmControl: 'off',
    canArm: false,
    canDisarm: false,
    allowUnlock: false,
    refreshMs: 60_000,
    language: 'fr',
  });
});

test('"Arming from Gladys": off, arm only, arm and disarm', () => {
  const of = (alarm_control) => {
    const { canArm, canDisarm } = normalizeConfig({ alarm_control });
    return [canArm, canDisarm];
  };
  assert.deepEqual(of('off'), [false, false]);
  assert.deepEqual(of('arm'), [true, false]);
  assert.deepEqual(of('full'), [true, true]);
  assert.deepEqual(of('everything'), [false, false], 'an unknown value is off');
});

test('values from older form engines, and unknown ones', () => {
  const config = normalizeConfig({
    allow_unlock: 'true',
    refresh_interval: 300,
    language: 'it',
  });
  assert.equal(config.allowUnlock, true);
  assert.equal(config.refreshMs, 300_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ refresh_interval: '5' }).refreshMs, 60_000);
  assert.equal(normalizeConfig({ allow_unlock: 'false' }).allowUnlock, false);
  assert.equal(normalizeConfig(null).alarmControl, 'off');
});
