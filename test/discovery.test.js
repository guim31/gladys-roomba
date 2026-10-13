// -----------------------------------------------------------------------------
// Robot discovery: the UDP 5678 answer, the scan mediated by the Gladys core
// (active broadcast + passive capture), and the direct unicast query.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DISCOVERY_QUERY,
  parseAnnouncement,
  queryRobot,
  scanThroughGladys,
} from '../src/roomba/discovery.js';
import { fixture } from './helpers/world.js';

const raw = (name) => Buffer.from(JSON.stringify(fixture(`discovery/${name}.json`)));
const reply = (name, sourceIp) => ({
  source_ip: sourceIp,
  source_port: 5678,
  payload_base64: raw(name).toString('base64'),
});

test('a discovery answer gives the BLID, name, model and address', () => {
  assert.deepEqual(parseAnnouncement(raw('roomba-980')), {
    blid: '3115C00000000001',
    name: 'Roomba',
    ip: '192.0.2.21',
    mac: '02:00:00:00:00:02',
    sku: 'R980020',
    firmware: '2.4.17-138',
    cap: { pose: 1 },
  });
  // Recent models: "iRobot-<BLID>".
  assert.equal(parseAnnouncement(raw('roomba-i7')).blid, '7C4E000000000002');
  assert.equal(parseAnnouncement(raw('roomba-i7')).name, 'Kitchen');
});

test('anything else is ignored: our own query, other devices, broken JSON', () => {
  assert.equal(parseAnnouncement(DISCOVERY_QUERY), null);
  assert.equal(parseAnnouncement(Buffer.from('{"hostname":"printer-1"}')), null);
  assert.equal(parseAnnouncement(Buffer.from('{"hostname":"Roomba-"}')), null);
  assert.equal(parseAnnouncement(Buffer.from('not json')), null);
  assert.equal(parseAnnouncement(Buffer.from([0xff, 0xfe])), null);
});

test('without an ip field, the source address is used', () => {
  const answer = Buffer.from(JSON.stringify({ hostname: 'Roomba-ABC123', robotname: ' ' }));
  assert.deepEqual(parseAnnouncement(answer, '192.0.2.40'), {
    blid: 'ABC123',
    name: null,
    ip: '192.0.2.40',
    mac: null,
    sku: null,
    firmware: null,
    cap: null,
  });
});

test('the core scan: active broadcast on 5678 and passive capture, merged', async () => {
  const gladys = createFakeGladys({
    scanResults: {
      'udp-active-broadcast': [reply('roomba-980', '192.0.2.21')],
      'udp-broadcast': [
        {
          source_ip: '192.0.2.1',
          source_port: 5678,
          payload_base64: DISCOVERY_QUERY.toString('base64'),
        },
        reply('roomba-980', '192.0.2.21'),
        reply('roomba-i7', '192.0.2.22'),
      ],
    },
  });
  await gladys.connect();
  const robots = await scanThroughGladys(gladys);
  assert.deepEqual(
    robots.map((robot) => robot.blid),
    ['3115C00000000001', '7C4E000000000002'],
  );
  const scans = gladys.fake.scans;
  const active = scans.find((scan) => scan.type === 'udp-active-broadcast');
  assert.equal(active.port, 5678);
  assert.equal(Buffer.from(active.payload_base64, 'base64').toString(), 'irobotmcs');
  assert.ok(scans.some((scan) => scan.type === 'udp-broadcast'));
  await gladys.disconnect();
});

test('the core scan survives one of its two captures failing', async () => {
  const gladys = createFakeGladys();
  gladys.scanNetwork = async (type) => {
    if (type === 'udp-active-broadcast') throw new Error('429 RATE_LIMIT_EXCEEDED');
    return [reply('roomba-i7', '192.0.2.22')];
  };
  assert.equal((await scanThroughGladys(gladys)).length, 1);
  gladys.scanNetwork = async () => {
    throw new Error('403');
  };
  await assert.rejects(scanThroughGladys(gladys), /403/);
});

test('the direct query asks the robot at its address', async () => {
  const robot = dgram.createSocket('udp4');
  await new Promise((resolve) => robot.bind(0, '127.0.0.1', resolve));
  const port = robot.address().port;
  const queries = [];
  robot.on('message', (message, remote) => {
    queries.push(message.toString());
    const answer = { ...fixture('discovery/roomba-980.json'), ip: '127.0.0.1' };
    robot.send(Buffer.from(JSON.stringify(answer)), remote.port, remote.address);
  });
  try {
    const found = await queryRobot('127.0.0.1', { port, timeoutMs: 1000 });
    assert.equal(found.blid, '3115C00000000001');
    assert.equal(queries[0], 'irobotmcs');
    assert.equal(await queryRobot('127.0.0.1', { port: port + 1, timeoutMs: 200 }), null);
  } finally {
    robot.close();
  }
});
