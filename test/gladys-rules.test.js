// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// records: a 980 found on the network, an i7 known from the cloud and located
// by a scan, a Braava added by hand without model — in every feature-name
// language. Adapted from guim31/gladys-wled.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorld, fixture } from './helpers/world.js';
import { parseAnnouncement } from '../src/roomba/discovery.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const announced = (name) =>
  parseAnnouncement(Buffer.from(JSON.stringify(fixture(`discovery/${name}.json`))));

const RECORDS = {
  [announced('roomba-980').blid]: { ...announced('roomba-980'), password: 'x', source: 'local' },
  [announced('roomba-i7').blid]: {
    ...announced('roomba-i7'),
    name: 'Kitchen',
    password: 'y',
    source: 'cloud',
  },
  BRAAVA000001: { ip: '192.0.2.23', password: 'z', source: 'manual' },
};

for (const language of ['fr', 'en', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language})`, async () => {
    const world = await createWorld({ config: { language }, stored: false, created: false });
    try {
      await writeFile(
        join(world.dataDir, 'robots.json'),
        JSON.stringify({ version: 1, robots: RECORDS }),
      );
      await world.app.store.load();
      await world.connect();
      const devices = world.gladys.fake.discoveredDevices;
      assert.equal(devices.length, 3);

      for (const device of devices) {
        const where = device.name;

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
        const externalIds = new Set();
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

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await world.stop();
    }
  });
}
