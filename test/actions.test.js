// -----------------------------------------------------------------------------
// The Configuration actions: add a robot (password typed, from the cloud, from
// the HOME button), the cloud login, forget a robot, the diagnostic.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CloudError } from '../src/roomba/cloud.js';
import { CloudOnlyError } from '../src/roomba/password.js';
import { ROBOT, createWorld, fixture, waitUntil } from './helpers/world.js';

const I7 = { ...fixture('discovery/roomba-i7.json') };
const i7Info = {
  blid: '7C4E000000000002',
  name: 'Kitchen',
  ip: '192.0.2.22',
  mac: '02:00:00:00:00:03',
  sku: 'i755840',
  firmware: I7.sw,
  cap: I7.cap,
};

function deps(overrides = {}) {
  const calls = { query: [], wait: [], verify: [], cloud: [] };
  return {
    calls,
    deps: {
      queryRobot: async (host) => {
        calls.query.push(host);
        return host === '192.0.2.22' ? i7Info : null;
      },
      waitForPassword: async (options) => {
        calls.wait.push(options);
        return 'PASSWORD-FROM-BUTTON';
      },
      verifyCredentials: async (options) => {
        calls.verify.push(options);
        return 'connected';
      },
      fetchCloudRobots: async (options) => {
        calls.cloud.push(options);
        return [
          {
            blid: i7Info.blid,
            password: 'CLOUD-PASSWORD',
            name: 'Kitchen',
            sku: 'i755840',
            firmware: null,
          },
        ];
      },
      ...overrides,
    },
  };
}

test('add a robot with the HOME button: asks who it is, reads, checks, stores, publishes', async () => {
  const { calls, deps: net } = deps();
  const world = await createWorld({ deps: net, stored: false, created: false });
  try {
    await world.connect();
    const ack = await world.gladys.fake.action('add_robot', { ip: ' 192.0.2.22 ' });
    assert.equal(ack.success, true, JSON.stringify(ack));
    assert.match(ack.data.message.fr, /^Kitchen ajouté et connecté/);
    assert.deepEqual(Object.keys(ack.data.message).sort(), ['de', 'en', 'es', 'fr']);
    assert.deepEqual(calls.query, ['192.0.2.22']);
    assert.equal(calls.wait[0].host, '192.0.2.22');
    assert.deepEqual(calls.verify[0], {
      blid: i7Info.blid,
      password: 'PASSWORD-FROM-BUTTON',
      host: '192.0.2.22',
    });
    const saved = JSON.parse(await readFile(join(world.dataDir, 'robots.json'), 'utf8'));
    assert.equal(saved.robots[i7Info.blid].password, 'PASSWORD-FROM-BUTTON');
    assert.equal(saved.robots[i7Info.blid].source, 'local');
    const devices = world.gladys.fake.discoveredDevices;
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'Kitchen');
    assert.deepEqual(devices[0].params, [{ name: 'IP_ADDRESS', value: '192.0.2.22' }]);
    // One info line, without the password.
    const info = world.logger.at('info');
    assert.deepEqual(info, ['Action add_robot: Kitchen added (password: local, check: connected)']);
  } finally {
    await world.stop();
  }
});

test('add a robot whose password came from the cloud: no button needed', async () => {
  const { calls, deps: net } = deps();
  const world = await createWorld({ deps: net, stored: false, created: false });
  try {
    await world.connect();
    await world.gladys.fake.action('cloud_credentials', { email: 'a@example.com', password: 'x' });
    const ack = await world.gladys.fake.action('add_robot', { ip: '192.0.2.22' });
    assert.equal(ack.success, true);
    assert.equal(calls.wait.length, 0);
    assert.equal(calls.verify[0].password, 'CLOUD-PASSWORD');
  } finally {
    await world.stop();
  }
});

test('add a robot: the failures a user meets', async () => {
  const cases = [
    [{ ip: '' }, {}, /adresse IP/],
    [{ ip: '192.0.2.99' }, {}, /Rien n’a répondu/],
    [{ ip: '192.0.2.22' }, { waitForPassword: async () => null }, /maintenez HOME/],
    [
      { ip: '192.0.2.22' },
      {
        waitForPassword: async () => {
          throw new CloudOnlyError();
        },
      },
      /cloud iRobot/,
    ],
    [
      { ip: '192.0.2.22', password: 'wrong' },
      { verifyCredentials: async () => 'auth' },
      /refusé ce mot de passe/,
    ],
  ];
  for (const [fields, overrides, message] of cases) {
    const world = await createWorld({ deps: deps(overrides).deps, stored: false, created: false });
    try {
      await world.connect();
      const ack = await world.gladys.fake.action('add_robot', fields);
      assert.equal(ack.success, false, JSON.stringify(fields));
      assert.match(ack.error, message);
      assert.equal(world.gladys.fake.discoveredDevices.length, 0);
      assert.ok(!world.logger.lines.some((line) => line.text.includes('wrong')));
    } finally {
      await world.stop();
    }
  }
});

test('a BLID typed by hand replaces the discovery answer; a busy robot is stored anyway', async () => {
  const { calls, deps: net } = deps({ verifyCredentials: async () => 'busy' });
  const world = await createWorld({ deps: net, stored: false, created: false });
  try {
    await world.connect();
    const ack = await world.gladys.fake.action('add_robot', {
      ip: '192.0.2.99',
      blid: 'ABCDEF0123',
      password: 'typed',
    });
    assert.equal(ack.success, true);
    assert.match(ack.data.message.en, /could not be checked now/);
    assert.equal(calls.wait.length, 0);
    assert.equal(world.app.store.get('ABCDEF0123').source, 'manual');
  } finally {
    await world.stop();
  }
});

test('cloud credentials: stored per robot, located by a scan, account password never kept', async () => {
  const { deps: net } = deps();
  const scanResults = {
    'udp-active-broadcast': [
      {
        source_ip: '192.0.2.22',
        source_port: 5678,
        payload_base64: Buffer.from(JSON.stringify(I7)).toString('base64'),
      },
    ],
  };
  const world = await createWorld({ deps: net, stored: false, created: false, scanResults });
  try {
    await world.connect();
    const ack = await world.gladys.fake.action('cloud_credentials', {
      email: 'name@example.com',
      password: 'account-secret',
      country: 'FR',
    });
    assert.equal(ack.success, true, JSON.stringify(ack));
    assert.match(ack.data.message.fr, /1 robot trouvé dans le compte \(Kitchen\), 1 localisé/);
    const file = await readFile(join(world.dataDir, 'robots.json'), 'utf8');
    assert.ok(!file.includes('account-secret'));
    assert.ok(!file.includes('name@example.com'));
    assert.equal(JSON.parse(file).robots[i7Info.blid].ip, '192.0.2.22');
    assert.equal(world.gladys.fake.discoveredDevices.length, 1);
    const all = world.logger.lines.map((line) => line.text).join('\n');
    assert.ok(!all.includes('account-secret') && !all.includes('name@example.com'));
  } finally {
    await world.stop();
  }
});

test('cloud credentials: the refusals are explained', async () => {
  for (const [reason, message] of [
    ['credentials', /refusé cet e-mail/],
    ['network', /injoignable/],
    ['unexpected', /réponse inattendue/],
    ['no_robot', /aucun robot/],
  ]) {
    const net = deps({
      fetchCloudRobots: async () => {
        throw new CloudError(reason, 'x');
      },
    }).deps;
    const world = await createWorld({ deps: net, stored: false, created: false });
    try {
      await world.connect();
      const ack = await world.gladys.fake.action('cloud_credentials', {
        email: 'a',
        password: 'b',
      });
      assert.equal(ack.success, false);
      assert.match(ack.error, message);
    } finally {
      await world.stop();
    }
  }
});

test('forget a robot: credentials deleted, connection closed, no longer offered', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.statusOf(ROBOT.blid) === 'connected');
    const ack = await world.gladys.fake.action('forget_robot', { device: world.ids.device });
    assert.equal(ack.success, true);
    assert.equal(world.app.store.get(ROBOT.blid), null);
    assert.equal(world.app.hub.robots.size, 0);
    assert.deepEqual(world.gladys.fake.discoveredDevices, []);
    const unknown = await world.gladys.fake.action('forget_robot', { device: 'ext:other:x' });
    assert.equal(unknown.success, false);
  } finally {
    await world.stop();
  }
});

test('the diagnostic says what matters, without BLID, address or password', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.viewOf(ROBOT.blid));
    const ack = await world.gladys.fake.action('diagnostic', {});
    assert.equal(ack.success, true);
    const text = ack.data.message;
    assert.match(text, /1 robot\(s\)/);
    assert.match(text, /credentials: yes \(cloud\), address: known, added in Gladys: yes/);
    assert.match(text, /connection: connected/);
    assert.match(text, /cycle none, phase charge, state 6, error 0, battery 100 %, bin ok/);
    assert.match(text, /capabilities: carpetBoost, multiPass, ota, pose/);
    for (const secret of [ROBOT.blid, ROBOT.password, '192.0.2.21', '02:00:00:00:00:02']) {
      assert.ok(!text.includes(secret), secret);
    }
  } finally {
    await world.stop();
  }
});

test('the diagnostic without any robot points to the two ways to add one', async () => {
  const world = await createWorld({ stored: false, created: false });
  try {
    await world.connect();
    const ack = await world.gladys.fake.action('diagnostic', {});
    assert.match(ack.data.message.en, /Add a robot/);
  } finally {
    await world.stop();
  }
});
