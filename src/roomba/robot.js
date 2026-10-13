// -----------------------------------------------------------------------------
// One robot's local connection: MQTT over TLS, kept open, re-opened when lost.
//
// A Roomba accepts a single local MQTT client. While the integration holds
// the connection, the iRobot app still works through the cloud; but when the
// app (or Home Assistant, or another script) holds it first, the robot turns
// the integration away. That is a normal situation, not a fault: the
// connection is retried at a slow pace and the status says why.
//
// How a robot turns a second client away is not documented and could not be
// observed here (no robot in the development session). Classification:
//   - CONNACK 4 or 5 (bad username or password, not authorised) → 'auth';
//   - the robot answered then refused or hung up (TCP refused, connection
//     reset or closed before CONNACK, CONNACK 3 "server unavailable")
//     → 'busy': another local client, or the robot restarting;
//   - nothing answered (timeout, host unreachable) → 'unreachable'.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { CONNACK, MqttError, MqttSession } from './mqtt.js';
import { mergeReported, reportedOf } from './state.js';
import { connectTls } from './tls.js';

export const STATUS = {
  STOPPED: 'stopped',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  BUSY: 'busy',
  AUTH: 'auth',
  UNREACHABLE: 'unreachable',
};

// Pause before the next attempt, by failure kind and attempt number (ms).
export const RETRY_DELAYS = {
  [STATUS.UNREACHABLE]: [10000, 30000, 60000, 120000],
  [STATUS.BUSY]: [30000, 60000, 120000],
  [STATUS.AUTH]: [15 * 60000],
  lost: [5000],
};

const UNREACHABLE_CODES = new Set([
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * @param {Error} error a connection failure
 * @returns {'auth'|'busy'|'unreachable'}
 */
export function classifyFailure(error) {
  if (error instanceof MqttError) {
    if (error.code === 'connack') {
      return error.returnCode === CONNACK.BAD_CREDENTIALS ||
        error.returnCode === CONNACK.NOT_AUTHORIZED
        ? STATUS.AUTH
        : STATUS.BUSY;
    }
    return error.code === 'timeout' ? STATUS.UNREACHABLE : STATUS.BUSY;
  }
  return UNREACHABLE_CODES.has(error?.code) ? STATUS.UNREACHABLE : STATUS.BUSY;
}

/**
 * A failure as it may be logged: Node's socket errors embed the address
 * ("connect ECONNREFUSED 192.0.2.10:8883"), which stays out of the logs.
 * @param {Error|null|undefined} error
 */
export function failureReason(error) {
  if (!error) return 'unknown';
  const message = String(error.message ?? error)
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<address>')
    .replace(/\[?[0-9a-f]*:[0-9a-f:]+\]?(:\d+)?/gi, (match) =>
      match.split(':').length > 3 ? '<address>' : match,
    );
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function delayFor(kind, attempt) {
  const delays = RETRY_DELAYS[kind] ?? RETRY_DELAYS[STATUS.UNREACHABLE];
  return delays[Math.min(attempt, delays.length - 1)];
}

export class RobotConnection extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.blid MQTT client id and username
   * @param {string} options.password
   * @param {string} options.host
   * @param {Function} [options.open] `({ host }) => Promise<Duplex>`, TLS by default
   * @param {number} [options.keepalive] seconds
   * @param {Function} [options.now]
   */
  constructor({ blid, password, host, open = connectTls, keepalive = 60, now = Date.now }) {
    super();
    this.blid = blid;
    this.password = password;
    this.host = host;
    this.open = open;
    this.keepalive = keepalive;
    this.now = now;
    this.status = STATUS.STOPPED;
    this.reported = {};
    this.session = null;
    this.timer = null;
    this.attempt = 0;
    this.lastMessageAt = null;
    this.lastError = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    const session = this.session;
    this.session = null;
    session?.close();
    this.setStatus(STATUS.STOPPED);
  }

  /** Point to a new address (DHCP lease changed): reconnect there. */
  setHost(host) {
    if (host === this.host) return;
    this.host = host;
    if (this.running && this.status !== STATUS.CONNECTED) {
      this.retryNow();
    }
  }

  /** Try again now instead of waiting for the next attempt. */
  retryNow() {
    if (!this.running || this.status === STATUS.CONNECTED || this.status === STATUS.CONNECTING) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
    this.connect();
  }

  get connected() {
    return this.status === STATUS.CONNECTED;
  }

  setStatus(status) {
    if (status === this.status) return;
    const previous = this.status;
    this.status = status;
    this.emit('status', status, previous);
  }

  async connect() {
    if (!this.running) return;
    this.setStatus(STATUS.CONNECTING);
    let session;
    try {
      const socket = await this.open({ host: this.host });
      if (!this.running) {
        socket.destroy();
        return;
      }
      session = new MqttSession(socket, {
        clientId: this.blid,
        username: this.blid,
        password: this.password,
        keepalive: this.keepalive,
        clean: false,
        subscribe: '#',
      });
      session.on('message', (topic, payload) => this.onMessage(topic, payload));
      await session.connect();
    } catch (error) {
      session?.close(error);
      this.fail(error);
      return;
    }
    if (!this.running) {
      session.close();
      return;
    }
    this.session = session;
    this.attempt = 0;
    this.lastError = null;
    session.once('close', (error) => this.onClose(session, error));
    this.setStatus(STATUS.CONNECTED);
  }

  fail(error) {
    if (!this.running) return;
    const kind = classifyFailure(error);
    this.lastError = error;
    this.setStatus(kind);
    this.schedule(delayFor(kind, this.attempt));
    this.attempt += 1;
  }

  onClose(session, error) {
    if (session !== this.session) return;
    this.session = null;
    if (!this.running) return;
    this.lastError = error ?? new MqttError('The robot closed the connection', 'closed');
    // Connected until now: one quick attempt, then the usual pace.
    this.setStatus(STATUS.UNREACHABLE);
    this.attempt = 1;
    this.schedule(delayFor('lost', 0));
  }

  schedule(delayMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delayMs);
    this.timer.unref?.();
  }

  onMessage(topic, payload) {
    const delta = reportedOf(payload);
    if (!delta) return;
    this.lastMessageAt = this.now();
    mergeReported(this.reported, delta);
    this.emit('reported', delta, topic);
  }

  /**
   * Send a command (`start`, `pause`, `resume`, `stop`, `dock`, `find`).
   * @param {string} command
   * @throws {Error} when the robot is not connected
   */
  command(command) {
    if (!this.session || !this.connected) {
      throw new Error('The robot is not connected');
    }
    this.session.publish('cmd', {
      command,
      time: Math.floor(this.now() / 1000),
      initiator: 'localApp',
    });
  }
}
