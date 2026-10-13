// -----------------------------------------------------------------------------
// Consistency between `gladys-assistant-integration.json` and the code. The
// store indexer validates the manifest, but cannot know which handlers the
// code registers or which keys it fires: these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTION_KEYS } from '../src/actions.js';
import { DEFAULT_CONFIG, LANGUAGES } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { DISCOVERY_PORT } from '../src/roomba/discovery.js';
import { WIDGET_ACTIONS } from '../src/widgets.js';
import { ROBOT, createWorld, waitUntil } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[...(manifest.actions ?? []), ...(manifest.scene_triggers ?? [])].flatMap(
    (item) => item.fields ?? [],
  ),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) return version[i] > required[i];
  }
  return true;
}

test('identity: name, catalog category, local transport only', () => {
  assert.equal(manifest.name, 'iRobot Roomba');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.deepEqual(manifest.categories, ['appliances']);
  // The cloud only serves once, to read the passwords: not a transport.
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.type, 'device');
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-roomba:${manifest.version}`);
});

test('Gladys 5.2.0 at least: secret fields in action forms and action defaults', () => {
  // Typing in a secret action field (#3154) and the defaults of action
  // fields (#3155) were fixed in 5.2.0; widgets, scene triggers and
  // categories need older releases (5.1.0, 4.86.0).
  const secrets = (manifest.actions ?? []).flatMap((action) =>
    (action.fields ?? []).filter((field) => field.type === 'secret'),
  );
  assert.ok(secrets.length > 0);
  assert.ok(isAtLeast(minGladysVersion(), [5, 2, 0]), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), [...ACTION_KEYS].sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...TRIGGERS].sort());
});

test('the widget is declared with a robot setting', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(keysOf(manifest.widgets[0].settings), ['robot']);
  assert.ok(WIDGET_ACTIONS.length <= 5);
});

test('network discovery: the iRobot discovery port, active and passive', () => {
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [DISCOVERY_PORT] },
    { type: 'udp-broadcast', ports: [DISCOVERY_PORT] },
  ]);
});

test('config_schema defaults match DEFAULT_CONFIG, the language select offers four languages', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(language.options.map((option) => option.value).sort(), [...LANGUAGES].sort());
  assert.equal(language.default, 'fr');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    assert.ok(section.description.en.length <= 1000);
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((field) => field.source !== undefined);
  assert.ok(dynamic.length > 0);
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.ok(field.placeholder.en, field.key);
  }
});

test('the scene events carry only declared keys (fields and variables)', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.viewOf(ROBOT.blid));
    const mission = (fields) => ({ cleanMissionStatus: fields });
    world.fake.push({ bin: { full: true } });
    world.fake.push(mission({ cycle: 'clean', phase: 'run', mssnM: 3 }));
    world.fake.push(mission({ cycle: 'clean', phase: 'stuck', error: 9 }));
    world.fake.push(mission({ cycle: 'clean', phase: 'run', error: 0 }));
    world.fake.push(mission({ cycle: 'none', phase: 'stop' }));
    await waitUntil(() => world.gladys.fake.sceneEvents.length >= 3);
    for (const { key, data } of world.gladys.fake.sceneEvents) {
      const trigger = manifest.scene_triggers.find((entry) => entry.key === key);
      const declared = new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)]);
      for (const dataKey of Object.keys(data)) {
        assert.ok(declared.has(dataKey), `${key}: "${dataKey}" is not declared`);
      }
      for (const variable of trigger.variables) {
        assert.ok(variable.key in data, `${key}: variable "${variable.key}" never sent`);
      }
    }
  } finally {
    await world.stop();
  }
});

test('the trigger filters compare with values the code sends', () => {
  const outcome = manifest.scene_triggers
    .find((trigger) => trigger.key === 'mission_finished')
    .fields.find((field) => field.key === 'outcome');
  assert.deepEqual(outcome.options.map((option) => option.value).sort(), ['completed', 'stopped']);
  // The device filter compares with the device external id.
  const gladys = createFakeGladys();
  assert.match(gladys.externalIds('robot', 'X').device, /^ext:test-integration:robot:X$/);
});
