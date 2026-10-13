// -----------------------------------------------------------------------------
// /data/robots.json: persistence, merge rules, file mode, bad entries.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RobotStore } from '../src/store.js';

test('robots survive a restart; empty values keep the stored ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roomba-store-'));
  try {
    const store = await new RobotStore(dir).load();
    assert.deepEqual(store.list(), []);
    await store.upsert('ABC', { name: 'Kitchen', password: 'secret', ip: '192.0.2.5', ignored: 1 });
    await store.upsert('ABC', { ip: '192.0.2.6', name: null, password: '' });
    await store.upsert('DEF', { sku: 'i755840' });

    const reloaded = await new RobotStore(dir).load();
    assert.deepEqual(reloaded.get('ABC'), {
      blid: 'ABC',
      name: 'Kitchen',
      password: 'secret',
      ip: '192.0.2.6',
    });
    assert.deepEqual(
      reloaded.list().map((robot) => robot.blid),
      ['DEF', 'ABC'], // "DEF" (no name) sorts before "Kitchen"
    );
    assert.equal(await reloaded.remove('DEF'), true);
    assert.equal(await reloaded.remove('DEF'), false);
    assert.equal((await new RobotStore(dir).load()).get('DEF'), null);

    const mode = (await stat(join(dir, 'robots.json'))).mode & 0o777;
    assert.equal(mode, 0o600, 'only the container user reads the passwords');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid entries are skipped, a missing file is an empty store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roomba-store-'));
  try {
    await writeFile(
      join(dir, 'robots.json'),
      JSON.stringify({ robots: { 'bad id!': { name: 'x' }, GOOD: { name: 'ok' }, NULL: null } }),
    );
    const store = await new RobotStore(dir).load();
    assert.deepEqual(
      store.list().map((robot) => robot.blid),
      ['GOOD'],
    );
    assert.equal((await new RobotStore(join(dir, 'missing')).load()).list().length, 0);
    // Concurrent writes end in a valid file.
    await Promise.all([store.upsert('A', { name: 'a' }), store.upsert('B', { name: 'b' })]);
    const saved = JSON.parse(await readFile(join(dir, 'robots.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved.robots).sort(), ['A', 'B', 'GOOD']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
