// -----------------------------------------------------------------------------
// A fake Roomba: the robot's MQTT broker, over plain TCP on localhost (the
// TLS layer is replaced by the `open` option of the code under test).
//
// It parses CONNECT itself (so the client's packets are checked, not echoed),
// answers CONNACK, then pushes `state.reported` documents the way a robot
// does: several PUBLISH packets on the shadow topic, some in QoS 1. It records
// the commands received on `cmd`.
//
// Modes: 'ok', 'busy' (hangs up before CONNACK, as when another local client
// holds the robot), 'auth' (CONNACK 5), 'unavailable' (CONNACK 3), 'silent'
// (never answers).
// -----------------------------------------------------------------------------

import net from 'node:net';
import { EventEmitter } from 'node:events';

function remainingLength(length) {
  const bytes = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function str(buffer, offset) {
  const length = buffer.readUInt16BE(offset);
  return { value: buffer.subarray(offset + 2, offset + 2 + length), next: offset + 2 + length };
}

function parseConnect(body) {
  const protocol = str(body, 0);
  let offset = protocol.next;
  const level = body[offset];
  const flags = body[offset + 1];
  const keepalive = body.readUInt16BE(offset + 2);
  offset += 4;
  const clientId = str(body, offset);
  offset = clientId.next;
  let username;
  let password;
  if (flags & 0x80) {
    const field = str(body, offset);
    username = field.value.toString();
    offset = field.next;
  }
  if (flags & 0x40) {
    const field = str(body, offset);
    password = field.value.toString();
  }
  return {
    protocol: protocol.value.toString(),
    level,
    clean: Boolean(flags & 0x02),
    keepalive,
    clientId: clientId.value.toString(),
    username,
    password,
  };
}

export async function startFakeRobot({ blid, password, mode = 'ok', initial = [] } = {}) {
  const robot = new EventEmitter();
  robot.mode = mode;
  robot.initial = initial;
  robot.connects = [];
  robot.commands = [];
  robot.subscriptions = [];
  robot.pubacks = 0;
  robot.pings = 0;
  robot.sockets = new Set();
  let packetId = 1;

  const send = (socket, type, flags, body) =>
    socket.write(
      Buffer.concat([Buffer.from([(type << 4) | flags]), remainingLength(body.length), body]),
    );

  const publish = (socket, reported, qos = 0) => {
    const topic = Buffer.from(`$aws/things/${blid}/shadow/update`);
    const topicLength = Buffer.alloc(2);
    topicLength.writeUInt16BE(topic.length);
    const parts = [topicLength, topic];
    if (qos > 0) {
      const id = Buffer.alloc(2);
      id.writeUInt16BE(packetId++);
      parts.push(id);
    }
    parts.push(Buffer.from(JSON.stringify({ state: { reported } })));
    send(socket, 3, qos << 1, Buffer.concat(parts));
  };

  const server = net.createServer((socket) => {
    robot.sockets.add(socket);
    socket.on('close', () => robot.sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        let length = 0;
        let multiplier = 1;
        let offset = 1;
        let byte;
        do {
          if (offset >= buffer.length) return;
          byte = buffer[offset++];
          length += (byte & 0x7f) * multiplier;
          multiplier *= 128;
        } while (byte & 0x80);
        if (buffer.length < offset + length) return;
        const type = buffer[0] >> 4;
        const body = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);
        robot.onPacket(socket, type, body);
      }
    });
  });

  robot.onPacket = (socket, type, body) => {
    switch (type) {
      case 1: {
        const connect = parseConnect(body);
        robot.connects.push(connect);
        if (robot.mode === 'silent') return;
        if (robot.mode === 'busy') {
          socket.destroy();
          return;
        }
        const refused =
          robot.mode === 'auth' ||
          connect.username !== blid ||
          connect.clientId !== blid ||
          connect.password !== password
            ? 5
            : robot.mode === 'unavailable'
              ? 3
              : 0;
        send(socket, 2, 0, Buffer.from([0, refused]));
        if (refused) {
          socket.end();
          return;
        }
        robot.socket = socket;
        robot.initial.forEach((reported, index) => publish(socket, reported, index % 2));
        robot.emit('connected', connect);
        break;
      }
      case 3: {
        const topicLength = body.readUInt16BE(0);
        const topic = body.subarray(2, 2 + topicLength).toString();
        const payload = JSON.parse(body.subarray(2 + topicLength).toString());
        if (topic === 'cmd') {
          robot.commands.push(payload);
          robot.emit('command', payload);
        }
        break;
      }
      case 4:
        robot.pubacks += 1;
        break;
      case 8: {
        const id = body.readUInt16BE(0);
        const topic = str(body, 2);
        robot.subscriptions.push(topic.value.toString());
        const ack = Buffer.alloc(3);
        ack.writeUInt16BE(id);
        ack[2] = 0;
        send(socket, 9, 0, ack);
        break;
      }
      case 12:
        robot.pings += 1;
        send(socket, 13, 0, Buffer.alloc(0));
        break;
      case 14:
        socket.end();
        break;
      default:
        break;
    }
  };

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  robot.port = server.address().port;

  /** The `open` option of the code under test: plain TCP to this robot. */
  robot.open = () =>
    new Promise((resolve, reject) => {
      const socket = net.connect(robot.port, '127.0.0.1');
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });

  /** Push a reported delta to the connected client. */
  robot.push = (reported, qos = 0) => {
    if (!robot.socket || robot.socket.destroyed) throw new Error('no client connected');
    publish(robot.socket, reported, qos);
  };

  /** Merge a delta into what the robot sends on the next connection too. */
  robot.drop = () => {
    for (const socket of robot.sockets) socket.destroy();
  };

  robot.close = async () => {
    robot.drop();
    await new Promise((resolve) => server.close(resolve));
  };

  /** Resolves on the next event of that name. */
  robot.next = (event) => new Promise((resolve) => robot.once(event, resolve));

  return robot;
}
