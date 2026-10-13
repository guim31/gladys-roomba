// -----------------------------------------------------------------------------
// One robot's connection: failure classification, retry, reconnection after a
// drop, commands, addresses kept out of the logged reasons, TLS profile.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:crypto';
import { MqttError } from '../src/roomba/mqtt.js';
import { RobotConnection, STATUS, classifyFailure, failureReason } from '../src/roomba/robot.js';
import { ROBOT_TLS_OPTIONS } from '../src/roomba/tls.js';
import { startFakeRobot } from './helpers/fakeRobot.js';
import { waitUntil } from './helpers/world.js';

test('failures are classified: credentials, busy, unreachable', () => {
  assert.equal(classifyFailure(new MqttError('x', 'connack', 4)), STATUS.AUTH);
  assert.equal(classifyFailure(new MqttError('x', 'connack', 5)), STATUS.AUTH);
  assert.equal(classifyFailure(new MqttError('x', 'connack', 3)), STATUS.BUSY);
  assert.equal(classifyFailure(new MqttError('x', 'closed')), STATUS.BUSY);
  assert.equal(classifyFailure(new MqttError('x', 'timeout')), STATUS.UNREACHABLE);
  assert.equal(
    classifyFailure(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    STATUS.BUSY,
  );
  assert.equal(classifyFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' })), STATUS.BUSY);
  assert.equal(
    classifyFailure(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' })),
    STATUS.UNREACHABLE,
  );
  assert.equal(
    classifyFailure(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })),
    STATUS.UNREACHABLE,
  );
});

test('logged reasons never carry an address', () => {
  assert.equal(
    failureReason(new Error('connect ECONNREFUSED 192.0.2.10:8883')),
    'connect ECONNREFUSED <address>',
  );
  assert.equal(
    failureReason(new Error('connect EHOSTUNREACH fe80::1:2:3')),
    'connect EHOSTUNREACH <address>',
  );
  assert.equal(failureReason(null), 'unknown');
});

test('the TLS profile accepts the robots’ legacy TLS', () => {
  assert.equal(ROBOT_TLS_OPTIONS.rejectUnauthorized, false);
  assert.match(ROBOT_TLS_OPTIONS.ciphers, /AES128-SHA256/);
  assert.match(ROBOT_TLS_OPTIONS.ciphers, /!DH/);
  assert.match(ROBOT_TLS_OPTIONS.ciphers, /@SECLEVEL=0/);
  assert.ok(ROBOT_TLS_OPTIONS.secureOptions & constants.SSL_OP_LEGACY_SERVER_CONNECT);
});

test('connects, merges the reported state, sends commands, reconnects after a drop', async () => {
  const robot = await startFakeRobot({
    blid: 'B',
    password: 'P',
    initial: [
      { batPct: 90, cleanMissionStatus: { phase: 'charge', cycle: 'none' } },
      { bin: { full: false } },
    ],
  });
  const connection = new RobotConnection({
    blid: 'B',
    password: 'P',
    host: 'robot',
    open: robot.open,
  });
  try {
    const statuses = [];
    connection.on('status', (status) => statuses.push(status));
    connection.start();
    await waitUntil(() => connection.reported.bin);
    assert.equal(connection.status, STATUS.CONNECTED);
    assert.equal(connection.reported.batPct, 90);
    assert.ok(connection.lastMessageAt > 0);

    connection.command('dock');
    await robot.next('command');
    assert.equal(robot.commands[0].command, 'dock');

    robot.drop();
    await waitUntil(() => connection.status === STATUS.UNREACHABLE);
    connection.retryNow();
    await waitUntil(() => connection.status === STATUS.CONNECTED);
    assert.deepEqual(statuses, [
      'connecting',
      'connected',
      'unreachable',
      'connecting',
      'connected',
    ]);
  } finally {
    connection.stop();
    await robot.close();
  }
});

test('a command to a robot not connected throws', () => {
  const connection = new RobotConnection({ blid: 'B', password: 'P', host: 'robot' });
  assert.throws(() => connection.command('start'), /not connected/);
});

test('an unreachable robot is retried later, a stopped one never', async () => {
  let attempts = 0;
  const open = async () => {
    attempts += 1;
    throw Object.assign(new Error('connect EHOSTUNREACH 192.0.2.9:8883'), { code: 'EHOSTUNREACH' });
  };
  const connection = new RobotConnection({ blid: 'B', password: 'P', host: 'robot', open });
  connection.start();
  await waitUntil(() => connection.status === STATUS.UNREACHABLE);
  assert.equal(attempts, 1);
  assert.ok(connection.timer, 'next attempt scheduled');
  connection.stop();
  assert.equal(connection.timer, null);
  assert.equal(connection.status, STATUS.STOPPED);
});

test('a new address is used at once by a robot that does not answer', async () => {
  const hosts = [];
  const open = async ({ host }) => {
    hosts.push(host);
    throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  };
  const connection = new RobotConnection({ blid: 'B', password: 'P', host: 'old', open });
  connection.start();
  await waitUntil(() => connection.status === STATUS.UNREACHABLE);
  connection.setHost('new');
  await waitUntil(() => hosts.length === 2);
  assert.deepEqual(hosts, ['old', 'new']);
  connection.stop();
});
