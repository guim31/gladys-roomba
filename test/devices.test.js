// -----------------------------------------------------------------------------
// The Gladys device of a robot: identifiers, features, states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FEATURE, blidOf, buildDevice, robotName, statesOf } from '../src/devices.js';
import { interpret } from '../src/roomba/state.js';
import { fixture } from './helpers/world.js';

const gladys = createFakeGladys();
const robot = { blid: '3115C00000000001', name: 'Dorita', sku: 'R980020', ip: '192.0.2.21' };

test('external ids are built on the BLID, never on a name', () => {
  const device = buildDevice(gladys, robot, 'fr');
  assert.equal(device.external_id, 'ext:test-integration:robot:3115C00000000001');
  const renamed = buildDevice(gladys, { ...robot, name: 'Other', ip: '192.0.2.99' }, 'en');
  assert.deepEqual(
    renamed.features.map((feature) => feature.external_id),
    device.features.map((feature) => feature.external_id),
  );
  assert.equal(blidOf(gladys, device.features[0].external_id), robot.blid);
  assert.equal(blidOf(gladys, 'ext:other:robot:X'), null);
});

test('the feature codes are the published ones', () => {
  const device = buildDevice(gladys, robot, 'fr');
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').at(-1)),
    Object.values(FEATURE),
  );
  assert.deepEqual(
    device.features.map((feature) => feature.name),
    [
      'État',
      'Nettoyage',
      'Retour à la base',
      'Pause',
      'Localiser',
      'Batterie',
      'En charge',
      'Bac plein',
      'Durée de la mission',
      'Surface de la mission',
      'Erreur',
    ],
  );
});

test('a robot without name is named after its model', () => {
  assert.equal(robotName({ blid: 'ABCDEF1234', sku: 'i755840' }), 'Roomba i755840');
  assert.equal(robotName({ blid: 'ABCDEF1234' }), 'Roomba 1234');
});

test('states from a real reported state', () => {
  const view = interpret(fixture('reported/roomba-980.json'));
  const ids = gladys.externalIds('robot', robot.blid);
  const states = Object.fromEntries(
    statesOf(gladys, robot.blid, view, 'de').map((state) => [
      state.device_feature_external_id.slice(ids.device.length + 1),
      state.text ?? state.state,
    ]),
  );
  assert.deepEqual(states, {
    state: 6,
    'run-mode': 0,
    battery: 100,
    charging: 0,
    'bin-full': 0,
    'mission-duration': 2,
    'mission-area': 2.7,
    error: 'Kein Fehler',
  });
});

test('a Braava without bin sensor publishes no bin state', () => {
  const view = interpret(fixture('reported/braava-m6.json'));
  const states = statesOf(gladys, robot.blid, view, 'en');
  assert.ok(!states.some((state) => state.device_feature_external_id.endsWith(':bin-full')));
  assert.ok(!states.some((state) => state.device_feature_external_id.endsWith(':mission-area')));
});
