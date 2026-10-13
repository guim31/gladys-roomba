// -----------------------------------------------------------------------------
// The "Roomba" widget: content valid for the core (vocabulary and budget),
// bound to features that exist, buttons by situation, actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buttonsFor, missionText } from '../src/widgets.js';
import { buildDevice } from '../src/devices.js';
import { interpret } from '../src/roomba/state.js';
import { ROBOT, createWorld, waitUntil } from './helpers/world.js';

const mission = (fields) => ({ cleanMissionStatus: fields });

async function content(world, language = 'fr') {
  const ack = await world.gladys.fake.widgetGet('robot', {
    settings: { robot: world.ids.device },
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
  return ack.data.content;
}

test('the content fits the core vocabulary and budget, in every language', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.viewOf(ROBOT.blid));
    const featureIds = new Set(
      buildDevice(world.gladys, { ...ROBOT, ip: '192.0.2.21' }, 'fr').features.map(
        (f) => f.external_id,
      ),
    );
    for (const language of ['en', 'fr', 'de', 'es', 'it']) {
      const data = await content(world, language);
      assert.deepEqual(validateWidgetContent(data), [], language);
      for (const component of data.components) {
        if (component.device_feature) {
          assert.ok(featureIds.has(component.device_feature), `${component.device_feature} exists`);
        }
        assert.notEqual(component.style, 'primary', 'invisible in dark mode (#3153)');
      }
    }
    const fr = await content(world, 'fr');
    const status = fr.components.find((component) => component.type === 'status');
    assert.deepEqual(
      status.items.map((item) => [item.label, item.value]),
      [
        ['État', 'Sur la base'],
        ['Bac', 'OK'],
        ['Dernière mission', '2 min · 2,7 m²'],
      ],
    );
    const buttons = fr.components.filter((component) => component.type === 'button');
    assert.deepEqual(
      buttons.map((button) => [button.label, button.action.key]),
      [['Démarrer', 'start']],
    );
  } finally {
    await world.stop();
  }
});

test('buttons follow the situation', () => {
  const view = (fields) => interpret({ batPct: 50, cleanMissionStatus: fields });
  assert.deepEqual(buttonsFor(view({ cycle: 'none', phase: 'charge' })), ['start']);
  assert.deepEqual(buttonsFor(view({ cycle: 'none', phase: 'stop' })), ['start', 'dock']);
  assert.deepEqual(buttonsFor(view({ cycle: 'clean', phase: 'run' })), ['pause', 'dock']);
  assert.deepEqual(buttonsFor(view({ cycle: 'clean', phase: 'stop' })), ['resume', 'stop', 'dock']);
  assert.deepEqual(buttonsFor(view({ cycle: 'clean', phase: 'charge' })), ['pause', 'stop']);
  assert.deepEqual(buttonsFor(null), []);
});

test('the mission line is localized', () => {
  const view = { minutes: 75, area: 12.5 };
  assert.equal(missionText(view, 'fr'), '75 min · 12,5 m²');
  assert.equal(missionText(view, 'en'), '75 min · 12.5 m²');
  assert.equal(missionText({ minutes: null, area: 0 }, 'en'), null);
});

test('an error and a lost connection show in the list, without buttons', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.viewOf(ROBOT.blid));
    world.fake.push(mission({ cycle: 'clean', phase: 'stuck', error: 6 }));
    await waitUntil(() => world.app.hub.viewOf(ROBOT.blid).error === 6);
    let data = await content(world, 'en');
    let status = data.components.find((component) => component.type === 'status');
    assert.ok(
      status.items.some((item) => item.label === 'Error' && /Stuck near a drop/.test(item.value)),
    );

    world.fake.mode = 'busy';
    world.fake.drop();
    await waitUntil(() => world.app.hub.statusOf(ROBOT.blid) !== 'connected');
    data = await content(world, 'en');
    status = data.components.find((component) => component.type === 'status');
    assert.equal(status.items.at(-1).label, 'Connection');
    assert.equal(data.components.filter((component) => component.type === 'button').length, 0);
  } finally {
    await world.stop();
  }
});

test('the buttons send the command and answer with a toast', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.viewOf(ROBOT.blid));
    const ack = await world.gladys.fake.widgetAction(
      'robot',
      'start',
      {},
      {
        settings: { robot: world.ids.device },
      },
    );
    assert.equal(ack.success, true, JSON.stringify(ack));
    assert.equal(ack.data.message.fr, 'Nettoyage lancé');
    await waitUntil(() => world.fake.commands.length === 1);
    assert.equal(world.fake.commands[0].command, 'start');
    assert.deepEqual(world.logger.at('info').at(-1), 'Dorita: start (widget)');

    const unknown = await world.gladys.fake.widgetAction(
      'robot',
      'format',
      {},
      {
        settings: { robot: world.ids.device },
      },
    );
    assert.equal(unknown.success, false);
  } finally {
    await world.stop();
  }
});

test('without a robot chosen, or an unknown one, the widget says what to do', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const empty = await world.gladys.fake.widgetGet('robot', { settings: {}, language: 'de' });
    assert.match(empty.data.content.components[0].text, /Wähle/);
    const unknown = await world.gladys.fake.widgetGet('robot', {
      settings: { robot: world.gladys.externalIds('robot', 'UNKNOWN').device },
      language: 'es',
    });
    assert.match(unknown.data.content.components[0].text, /añádalo de nuevo/);
  } finally {
    await world.stop();
  }
});
