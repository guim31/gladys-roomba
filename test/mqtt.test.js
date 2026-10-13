// -----------------------------------------------------------------------------
// The minimal MQTT 3.1.1 client: framing, and the session against a fake
// broker (QoS 1 acknowledgements, keepalive, refusals, silence).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Duplex } from 'node:stream';
import {
  CONNACK,
  MqttError,
  MqttSession,
  createParser,
  decodePublish,
  encodeConnect,
  encodeLength,
  encodePublish,
} from '../src/roomba/mqtt.js';
import { startFakeRobot } from './helpers/fakeRobot.js';

test('remaining length is a base-128 varint', () => {
  assert.deepEqual([...encodeLength(0)], [0]);
  assert.deepEqual([...encodeLength(127)], [127]);
  assert.deepEqual([...encodeLength(128)], [0x80, 0x01]);
  assert.deepEqual([...encodeLength(16383)], [0xff, 0x7f]);
  assert.deepEqual([...encodeLength(2097152)], [0x80, 0x80, 0x80, 0x01]);
});

test('CONNECT carries the MQTT 3.1.1 header, client id, username and password', () => {
  const packet = encodeConnect({
    clientId: 'BLID',
    username: 'BLID',
    password: 'pw',
    keepalive: 60,
  });
  assert.equal(packet[0], 0x10);
  const body = packet.subarray(2);
  assert.equal(body.subarray(2, 6).toString(), 'MQTT');
  assert.equal(body[6], 4); // protocol level
  assert.equal(body[7], 0xc0); // username + password, clean session off
  assert.equal(body.readUInt16BE(8), 60);
  assert.ok(body.includes(Buffer.from('pw')));
});

test('the parser splits a stream cut anywhere, including inside the length', () => {
  const big = 'x'.repeat(300); // two-byte remaining length
  const stream = Buffer.concat([
    encodePublish('a', '{"state":{"reported":{"batPct":1}}}'),
    encodePublish('$aws/things/B/shadow/update', big, { qos: 1, packetId: 7 }),
  ]);
  for (let cut = 1; cut < stream.length; cut += 1) {
    const parser = createParser();
    const packets = [...parser.push(stream.subarray(0, cut)), ...parser.push(stream.subarray(cut))];
    assert.equal(packets.length, 2, `cut at ${cut}`);
    const second = decodePublish(packets[1].flags, packets[1].body);
    assert.equal(second.topic, '$aws/things/B/shadow/update');
    assert.equal(second.qos, 1);
    assert.equal(second.packetId, 7);
    assert.equal(second.payload.toString(), big);
  }
});

test('the parser refuses an oversized or malformed packet', () => {
  assert.throws(
    () => createParser({ maxPacketBytes: 10 }).push(encodePublish('t', 'x'.repeat(20))),
    MqttError,
  );
  assert.throws(
    () => createParser().push(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x01])),
    MqttError,
  );
});

test('a session receives the robot messages and acknowledges QoS 1', async () => {
  const reported = [{ batPct: 50 }, { bin: { full: false } }, { signal: { rssi: -40 } }];
  const robot = await startFakeRobot({ blid: 'B', password: 'P', initial: reported });
  try {
    const session = new MqttSession(await robot.open(), {
      clientId: 'B',
      username: 'B',
      password: 'P',
      subscribe: '#',
    });
    const messages = [];
    session.on('message', (topic, payload) => messages.push([topic, JSON.parse(payload)]));
    await session.connect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(
      messages.map(([, payload]) => payload.state.reported),
      reported,
    );
    assert.equal(messages[0][0], '$aws/things/B/shadow/update');
    assert.equal(robot.pubacks, 1, 'the QoS 1 message is acknowledged');
    assert.deepEqual(robot.subscriptions, ['#']);
    session.publish('cmd', { command: 'start' });
    await robot.next('command');
    assert.deepEqual(robot.commands, [{ command: 'start' }]);
    session.close();
  } finally {
    await robot.close();
  }
});

test('refusals: bad credentials and server unavailable are CONNACK errors', async () => {
  for (const [mode, code] of [
    ['auth', CONNACK.NOT_AUTHORIZED],
    ['unavailable', CONNACK.SERVER_UNAVAILABLE],
  ]) {
    const robot = await startFakeRobot({ blid: 'B', password: 'P', mode });
    try {
      const session = new MqttSession(await robot.open(), {
        clientId: 'B',
        username: 'B',
        password: 'P',
      });
      await assert.rejects(
        session.connect(),
        (error) => error.code === 'connack' && error.returnCode === code,
      );
    } finally {
      await robot.close();
    }
  }
});

test('a robot hanging up before CONNACK is a closed connection', async () => {
  const robot = await startFakeRobot({ blid: 'B', password: 'P', mode: 'busy' });
  try {
    const session = new MqttSession(await robot.open(), {
      clientId: 'B',
      username: 'B',
      password: 'P',
    });
    await assert.rejects(session.connect(), (error) => error.code === 'closed');
  } finally {
    await robot.close();
  }
});

test('a silent robot times out', async () => {
  const robot = await startFakeRobot({ blid: 'B', password: 'P', mode: 'silent' });
  try {
    const session = new MqttSession(await robot.open(), {
      clientId: 'B',
      username: 'B',
      password: 'P',
      connackTimeoutMs: 50,
    });
    await assert.rejects(session.connect(), (error) => error.code === 'timeout');
  } finally {
    await robot.close();
  }
});

test('keepalive: a ping when idle, and a robot that stops answering closes the session', async () => {
  const robot = await startFakeRobot({ blid: 'B', password: 'P' });
  try {
    const session = new MqttSession(await robot.open(), {
      clientId: 'B',
      username: 'B',
      password: 'P',
      keepalive: 0.1, // 100 ms
    });
    await session.connect();
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.ok(robot.pings >= 1, 'PINGREQ sent');
    assert.equal(session.closed, false, 'answered pings keep the session open');
    session.close();
  } finally {
    await robot.close();
  }

  // A peer that accepts the connection then never answers a ping.
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      if (chunk[0] === 0x10) this.push(Buffer.from([0x20, 2, 0, 0])); // CONNACK
      callback();
    },
  });
  const session = new MqttSession(socket, { clientId: 'B', keepalive: 0.1 });
  await session.connect();
  // The session timers do not hold the process: hold it while waiting.
  const hold = setInterval(() => {}, 1000);
  const error = await new Promise((resolve) => session.once('close', resolve));
  clearInterval(hold);
  assert.equal(error.code, 'timeout');
});

test('publishing on a closed session throws', async () => {
  const session = new MqttSession(new PassThrough(), { clientId: 'B' });
  assert.throws(() => session.publish('cmd', {}), MqttError);
});
