// -----------------------------------------------------------------------------
// A minimal MQTT 3.1.1 client: just what a Roomba speaks.
//
// The robot runs its own broker on port 8883 (TLS) and accepts ONE local
// client. That client connects with the BLID as client id and username, the
// robot password, and then receives the robot's "shadow" (`state.reported`,
// JSON) as PUBLISH packets; commands are PUBLISH packets on the `cmd` and
// `delta` topics. Nothing else of MQTT is used, so the full `mqtt` package
// (and its dependency tree) would only weigh on the 256 MB sandbox.
//
// The socket is provided by the caller (TLS in production, plain TCP against
// the fake robot of the tests): this module only frames packets.
//
// Protocol: OASIS MQTT 3.1.1. Client options follow dorita980 (MIT, Facu ZAK),
// which has talked to these robots since 2016: protocol level 4, clean session
// off, keepalive 60 s.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const PACKET = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  PUBREC: 5,
  PUBREL: 6,
  PUBCOMP: 7,
  SUBSCRIBE: 8,
  SUBACK: 9,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
};

// CONNACK return codes (MQTT 3.1.1, 3.2.2.3).
export const CONNACK = {
  ACCEPTED: 0,
  BAD_PROTOCOL: 1,
  BAD_CLIENT_ID: 2,
  SERVER_UNAVAILABLE: 3,
  BAD_CREDENTIALS: 4,
  NOT_AUTHORIZED: 5,
};

/** An error of the MQTT session, with a `code` the robot layer classifies. */
export class MqttError extends Error {
  /**
   * @param {string} message
   * @param {string} code 'connack' | 'closed' | 'timeout' | 'protocol'
   * @param {number} [returnCode] the CONNACK return code
   */
  constructor(message, code, returnCode) {
    super(message);
    this.name = 'MqttError';
    this.code = code;
    this.returnCode = returnCode;
  }
}

// --- Encoding -------------------------------------------------------------------

/** @param {number} length @returns {Buffer} the "remaining length" varint */
export function encodeLength(length) {
  const bytes = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

/** @param {string|Buffer} value @returns {Buffer} a 2-byte length-prefixed string */
export function encodeString(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length);
  return Buffer.concat([length, body]);
}

function packet(type, flags, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), encodeLength(body.length), body]);
}

/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {number} [options.keepalive] seconds
 * @param {boolean} [options.clean] clean session
 */
export function encodeConnect({ clientId, username, password, keepalive = 60, clean = false }) {
  let flags = 0;
  if (username !== undefined) flags |= 0x80;
  if (password !== undefined) flags |= 0x40;
  if (clean) flags |= 0x02;
  const keep = Buffer.alloc(2);
  keep.writeUInt16BE(keepalive);
  const parts = [encodeString('MQTT'), Buffer.from([4, flags]), keep, encodeString(clientId)];
  if (username !== undefined) parts.push(encodeString(username));
  if (password !== undefined) parts.push(encodeString(password));
  return packet(PACKET.CONNECT, 0, Buffer.concat(parts));
}

/** QoS 0 publish: what the robot's own clients send. */
export function encodePublish(topic, payload, { qos = 0, packetId = 0 } = {}) {
  const parts = [encodeString(topic)];
  if (qos > 0) {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(packetId);
    parts.push(id);
  }
  parts.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'));
  return packet(PACKET.PUBLISH, qos << 1, Buffer.concat(parts));
}

export function encodeSubscribe(packetId, topic, qos = 0) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId);
  return packet(
    PACKET.SUBSCRIBE,
    0x02,
    Buffer.concat([id, encodeString(topic), Buffer.from([qos])]),
  );
}

function encodeAck(type, packetId, flags = 0) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId);
  return packet(type, flags, id);
}

export const encodePingreq = () => packet(PACKET.PINGREQ, 0);
export const encodeDisconnect = () => packet(PACKET.DISCONNECT, 0);

// --- Decoding -------------------------------------------------------------------

/**
 * Split a byte stream into MQTT packets.
 * @returns {{ push(chunk: Buffer): Array<{ type: number, flags: number, body: Buffer }> }}
 */
export function createParser({ maxPacketBytes = 1024 * 1024 } = {}) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      const packets = [];
      for (;;) {
        if (buffer.length < 2) break;
        let length = 0;
        let multiplier = 1;
        let offset = 1;
        let complete = false;
        while (offset < buffer.length && offset <= 4) {
          const byte = buffer[offset];
          length += (byte & 0x7f) * multiplier;
          multiplier *= 128;
          offset += 1;
          if ((byte & 0x80) === 0) {
            complete = true;
            break;
          }
        }
        if (!complete) {
          if (offset > 4) throw new MqttError('Malformed remaining length', 'protocol');
          break;
        }
        if (length > maxPacketBytes) {
          throw new MqttError(`Packet of ${length} bytes refused`, 'protocol');
        }
        if (buffer.length < offset + length) break;
        packets.push({
          type: buffer[0] >> 4,
          flags: buffer[0] & 0x0f,
          body: buffer.subarray(offset, offset + length),
        });
        buffer = buffer.subarray(offset + length);
      }
      return packets;
    },
  };
}

/** @returns {{ topic: string, payload: Buffer, qos: number, packetId: number }} */
export function decodePublish(flags, body) {
  const qos = (flags >> 1) & 0x03;
  const topicLength = body.readUInt16BE(0);
  const topic = body.subarray(2, 2 + topicLength).toString('utf8');
  let offset = 2 + topicLength;
  let packetId = 0;
  if (qos > 0) {
    packetId = body.readUInt16BE(offset);
    offset += 2;
  }
  return { topic, payload: body.subarray(offset), qos, packetId };
}

// --- Session --------------------------------------------------------------------

/**
 * One MQTT session over an already opened socket.
 *
 * Events: `message` (topic, payload Buffer), `close` (MqttError|undefined).
 *
 * @param {import('node:stream').Duplex} socket
 * @param {object} options encodeConnect options, plus:
 * @param {number} [options.connackTimeoutMs] how long to wait for CONNACK
 * @param {string} [options.subscribe] topic filter to subscribe to once connected
 */
export class MqttSession extends EventEmitter {
  constructor(socket, options) {
    super();
    this.socket = socket;
    this.options = { keepalive: 60, connackTimeoutMs: 10000, ...options };
    this.parser = createParser();
    this.connected = false;
    this.closed = false;
    this.nextPacketId = 1;
    this.lastSentAt = 0;
    this.awaitingPing = false;
    this.timers = new Set();
  }

  /** Send CONNECT and resolve on an accepted CONNACK. */
  connect() {
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        if (!this.connected) reject(error);
      };
      this.once('close', (error) => fail(error ?? new MqttError('Connection closed', 'closed')));
      this.once('connack', (returnCode) => {
        if (returnCode === CONNACK.ACCEPTED) {
          this.connected = true;
          this.startKeepalive();
          if (this.options.subscribe) {
            this.send(encodeSubscribe(this.packetId(), this.options.subscribe));
          }
          resolve();
        } else {
          const error = new MqttError(
            `Connection refused (CONNACK ${returnCode})`,
            'connack',
            returnCode,
          );
          this.close(error);
        }
      });
      this.later(() => {
        if (!this.connected) {
          this.close(new MqttError('No CONNACK from the robot', 'timeout'));
        }
      }, this.options.connackTimeoutMs);

      this.socket.on('data', (chunk) => this.onData(chunk));
      this.socket.on('error', (error) =>
        this.close(new MqttError(error.message, error.code === 'ETIMEDOUT' ? 'timeout' : 'closed')),
      );
      this.socket.on('close', () => this.close());
      this.send(encodeConnect(this.options));
    });
  }

  onData(chunk) {
    let packets;
    try {
      packets = this.parser.push(chunk);
    } catch (error) {
      this.close(error);
      return;
    }
    for (const { type, flags, body } of packets) {
      switch (type) {
        case PACKET.CONNACK:
          this.emit('connack', body.length >= 2 ? body[1] : CONNACK.BAD_PROTOCOL);
          break;
        case PACKET.PUBLISH: {
          const message = decodePublish(flags, body);
          if (message.qos === 1) {
            this.send(encodeAck(PACKET.PUBACK, message.packetId));
          } else if (message.qos === 2) {
            this.send(encodeAck(PACKET.PUBREC, message.packetId));
          }
          this.emit('message', message.topic, message.payload);
          break;
        }
        case PACKET.PUBREL:
          this.send(encodeAck(PACKET.PUBCOMP, body.readUInt16BE(0)));
          break;
        case PACKET.PINGRESP:
          this.awaitingPing = false;
          break;
        default:
          // SUBACK, PUBACK...: nothing to do.
          break;
      }
    }
  }

  packetId() {
    const id = this.nextPacketId;
    this.nextPacketId = id >= 0xffff ? 1 : id + 1;
    return id;
  }

  send(buffer) {
    if (this.closed) {
      throw new MqttError('Connection closed', 'closed');
    }
    this.lastSentAt = Date.now();
    this.socket.write(buffer);
  }

  /** @param {string} topic @param {string|object} payload */
  publish(topic, payload) {
    if (!this.connected) {
      throw new MqttError('Not connected', 'closed');
    }
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.send(encodePublish(topic, text));
  }

  // PINGREQ when nothing was sent for a keepalive period; a robot that does
  // not answer within half a period is gone (Wi-Fi lost, robot switched off).
  startKeepalive() {
    const periodMs = this.options.keepalive * 1000;
    if (periodMs <= 0) return;
    const tick = () => {
      if (this.closed) return;
      if (this.awaitingPing) {
        this.close(new MqttError('The robot stopped answering', 'timeout'));
        return;
      }
      if (Date.now() - this.lastSentAt >= periodMs / 2) {
        this.awaitingPing = true;
        this.send(encodePingreq());
      }
      this.later(tick, periodMs / 2);
    };
    this.later(tick, periodMs / 2);
  }

  later(fn, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** Close the session (DISCONNECT first when it was open). */
  close(error) {
    if (this.closed) return;
    if (this.connected && !error) {
      try {
        this.socket.write(encodeDisconnect());
      } catch {
        // The socket is already gone: nothing to tell the robot.
      }
    }
    this.closed = true;
    this.connected = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.socket.destroy();
    this.emit('close', error);
  }
}
