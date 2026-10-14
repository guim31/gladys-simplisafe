// -----------------------------------------------------------------------------
// The `alarm` widget: a content the core renders exactly as sent (the SDK
// validator, the budget of 8 components and 2 texts), the buttons the
// configuration allows, the current mode marked by its icon, and the
// confirmation before disarming.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { TEXT } from '../src/widgets.js';
import { eventData } from './helpers/fakeCloud.js';
import { BASE_CONFIG, createAll, createWorld, settle, systemIds } from './helpers/world.js';

async function content(t, options = {}, settings = {}, language = 'en') {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  const get = async () => {
    const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });
    assert.equal(ack.success, true, JSON.stringify(ack));
    return ack.data.content;
  };
  return { w, get };
}

const buttons = (components) => components.filter((c) => c.type === 'button');

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`the content is valid as sent, in ${language}`, async (t) => {
    const { get } = await content(t, {}, {}, language);
    const components = (await get()).components;
    assert.deepEqual(validateWidgetContent({ components }), []);
    assert.ok(components.length <= 8);
    assert.ok(components.filter((c) => c.type === 'text').length <= 2);
  });
}

test('state, base station, power, open entries; three buttons with full control', async (t) => {
  const { w, get } = await content(t);
  w.cloud.sensor('825').status.triggered = true;
  await w.hub.refresh();
  const { components } = await get();
  assert.equal(components[0].text, '1234 Main Street');
  const status = components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.slice(0, 4).map((item) => [item.label, item.value]),
    [
      ['Alarm', 'Disarmed'],
      ['Base station', 'Online'],
      ['Power', 'Mains'],
      ['Open', 'Fire Door'],
    ],
  );
  assert.ok(status.items.some((item) => item.label === 'Alerts' && item.value === 1));
  const [home, away, off] = buttons(components);
  assert.deepEqual(
    [home.action.key, away.action.key, off.action.key],
    ['arm_home', 'arm_away', 'disarm'],
  );
  assert.equal(off.action.confirm, true, 'disarming asks first');
  assert.equal(home.action.params.system, systemIds(w.gladys).device);
  // The current mode (disarmed) is marked by the icon, never by the style.
  assert.equal(off.icon, 'check-circle');
  assert.ok(buttons(components).every((button) => button.style !== 'primary'));
});

test('the icon follows the mode after an arming', async (t) => {
  const { w, get } = await content(t);
  w.socket.push(eventData({ eventCid: 3441, sensorType: 0 }));
  await settle();
  const [home] = buttons((await get()).components);
  assert.equal(home.icon, 'check-circle');
});

test('"arm only": no disarm button; control off: no button, a caption says why', async (t) => {
  const arm = await content(t, { config: { ...BASE_CONFIG, alarm_control: 'arm' } });
  assert.deepEqual(
    buttons((await arm.get()).components).map((b) => b.action.params.mode),
    ['home', 'away'],
  );
  const off = await content(t, { config: { ...BASE_CONFIG, alarm_control: 'off' } }, {}, 'de');
  const components = (await off.get()).components;
  assert.equal(buttons(components).length, 0);
  assert.equal(components.at(-1).text, TEXT.de.controlOff);
});

test('not signed in: one sentence saying what to do', async (t) => {
  const w = await createWorld({ signedIn: false });
  t.after(() => w.app.stop());
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'es', units: 'metric' });
  assert.deepEqual(ack.data.content.components, [
    { type: 'text', variant: 'body', text: TEXT.es.empty },
  ]);
});
