// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of simplisafe-python (test/fixtures/simplisafe): the system, every
// kind of sensor (entry, motion, glass break, smoke, smoke and CO, water,
// freeze, keypad, panic button, siren), three Smart Locks, three cameras
// (SimpliCam, Video Doorbell, an unknown model that rang) — in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eventData } from './helpers/fakeCloud.js';
import { BASE_CONFIG, createWorld, settle } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', config: { ...BASE_CONFIG, language: 'en' } },
  { label: 'French names', config: { ...BASE_CONFIG, language: 'fr' } },
  { label: 'German names', config: { ...BASE_CONFIG, language: 'de' } },
  { label: 'Spanish names', config: { ...BASE_CONFIG, language: 'es' } },
  { label: 'a camera seen ringing', config: BASE_CONFIG, ring: true },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const w = await createWorld({ config: scenario.config });
    try {
      if (scenario.ring) {
        w.socket.push(eventData({ eventCid: 1458, sensorSerial: '1234567891' }));
        await new Promise((resolve) => setTimeout(resolve, 30));
        await settle();
      }
      const devices = w.fake.discoveredDevices;
      assert.ok(devices.length >= 29, `expected the fixture devices, got ${devices.length}`);

      const allExternalIds = new Set();
      for (const device of devices) {
        const where = device.name;
        assert.ok(!allExternalIds.has(device.external_id), `${where}: duplicate device id`);
        allExternalIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!allExternalIds.has(feature.external_id), `${at}: duplicate external_id`);
          allExternalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await w.app.stop();
    }
  });
}
