// -----------------------------------------------------------------------------
// The HOME button method: the 7-byte request, the length-prefixed answer, the
// "cloud only" answer, a robot that does not listen.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  CLOUD_ONLY_ANSWER,
  CloudOnlyError,
  PASSWORD_REQUEST,
  decodePassword,
  requestPassword,
  waitForPassword,
} from '../src/roomba/password.js';

const PASSWORD = ':1:1486937829:EXAMPLEpassword0';

function answer(password) {
  const body = Buffer.concat([
    Buffer.from('efcc3b2900', 'hex'),
    Buffer.from(password),
    Buffer.from([0]),
  ]);
  return Buffer.concat([Buffer.from([0xf0, body.length]), body]);
}

/** A robot answering the request with `chunks` (several writes). */
async function fakeListeningRobot(respond) {
  const requests = [];
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      requests.push(data);
      respond(socket);
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const open = () =>
    new Promise((resolve, reject) => {
      const socket = net.connect(server.address().port, '127.0.0.1');
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });
  return { open, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('the password is read from the answer, after the 7-byte header', () => {
  assert.equal(decodePassword(answer(PASSWORD)), PASSWORD);
  assert.equal(decodePassword(Buffer.from('f005efcc3b29', 'hex')), null);
});

test('one request, one answer (even in several pieces)', async () => {
  const robot = await fakeListeningRobot((socket) => {
    const data = answer(PASSWORD);
    socket.write(data.subarray(0, 2));
    setTimeout(() => socket.write(data.subarray(2)), 20);
  });
  try {
    assert.equal(await requestPassword({ host: 'robot', open: robot.open }), PASSWORD);
    assert.deepEqual(robot.requests[0], PASSWORD_REQUEST);
  } finally {
    await robot.close();
  }
});

test('a robot serving its password from the cloud only says so', async () => {
  const robot = await fakeListeningRobot((socket) => socket.write(CLOUD_ONLY_ANSWER));
  try {
    await assert.rejects(requestPassword({ host: 'robot', open: robot.open }), CloudOnlyError);
  } finally {
    await robot.close();
  }
});

test('a robot not listening gives nothing, and the wait gives up in time', async () => {
  const refused = async () => {
    throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
  };
  assert.equal(await requestPassword({ host: 'robot', open: refused }), null);
  const started = Date.now();
  assert.equal(
    await waitForPassword({ host: 'robot', open: refused, durationMs: 200, intervalMs: 50 }),
    null,
  );
  assert.ok(Date.now() - started < 1000);
});

test('the wait succeeds once the button is pressed', async () => {
  let pressed = false;
  const robot = await fakeListeningRobot((socket) => socket.write(answer(PASSWORD)));
  const open = async (options) => {
    if (!pressed) {
      pressed = true; // the first attempt comes before the button
      throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    }
    return robot.open(options);
  };
  try {
    assert.equal(
      await waitForPassword({ host: 'robot', open, durationMs: 2000, intervalMs: 20 }),
      PASSWORD,
    );
  } finally {
    await robot.close();
  }
});
