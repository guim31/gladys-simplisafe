// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/app.js';
import { ALARM_CONTROLS, DEFAULT_CONFIG, LANGUAGES, REFRESH_INTERVALS } from '../src/config.js';
import { TRIGGERS } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { ALARM_KINDS, ARM_MODES, SOURCES } from '../src/simplisafe/model.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const valuesOf = (field) => field.options.map((option) => option.value);
const configField = (key) => manifest.config_schema.find((field) => field.key === key);
const trigger = (key) => manifest.scene_triggers.find((entry) => entry.key === key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the identity of the integration', () => {
  assert.equal(manifest.name, 'SimpliSafe');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.categories, ['security']);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-simplisafe:${manifest.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-simplisafe/main/cover.png',
  );
});

test('every manifest action has a handler, and every handler an action', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
  // An action applies no default and cannot fill a secret (Gladys#3154, #3155).
  for (const action of manifest.actions) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `action ${action.key}: secret field`);
      assert.equal(field.default, undefined, `action ${action.key}: default ignored by the core`);
    }
  }
});

test('the sign-in is an account_link field (no redirect comes back to Gladys)', () => {
  const link = manifest.config_schema.filter((field) => field.type === 'account_link');
  assert.deepEqual(keysOf(link), ['simplisafe_account']);
  assert.equal(
    manifest.config_schema.filter((field) => ['secret', 'oauth2'].includes(field.type)).length,
    0,
  );
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a content and an action handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of Object.values(WIDGETS)) {
    assert.equal(typeof widget.get, 'function');
    assert.equal(typeof widget.action, 'function');
  }
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('the filter values of the triggers are the values the code sends', () => {
  const field = (key, name) => trigger(key).fields.find((entry) => entry.key === name);
  assert.deepEqual(valuesOf(field(TRIGGERS.ALARM, 'kind')), [...ALARM_KINDS]);
  assert.deepEqual(valuesOf(field(TRIGGERS.MODE, 'mode')), [...ARM_MODES]);
  assert.deepEqual(valuesOf(field(TRIGGERS.MODE, 'source')), [...SOURCES]);
  const action = manifest.scene_actions.find((entry) => entry.key === 'set_alarm_mode');
  assert.deepEqual(valuesOf(action.fields.find((entry) => entry.key === 'mode')), [...ARM_MODES]);
});

test('the select options of the configuration are the values the code knows', () => {
  assert.deepEqual(valuesOf(configField('alarm_control')), ALARM_CONTROLS);
  assert.deepEqual(valuesOf(configField('refresh_interval')), REFRESH_INTERVALS);
  assert.deepEqual(valuesOf(configField('language')), LANGUAGES);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  // The safe choices: no arming nor unlocking from Gladys until the user says so.
  assert.equal(configField('alarm_control').default, 'off');
  assert.equal(configField('allow_unlock').default, false);
  assert.equal(configField('language').default, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}": placeholder`);
    assert.ok(!(section.key in DEFAULT_CONFIG), `section "${section.key}" stores no value`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
