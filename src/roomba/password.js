// -----------------------------------------------------------------------------
// The robot password, read from the robot itself ("HOME button" method).
//
// With the robot on its home base, holding HOME (DOCK + SPOT on some 600s)
// for about two seconds, until it plays a series of tones, makes the robot
// answer one request on its TLS port 8883 for a short while: the 7 bytes
// f0 05 ef cc 3b 29 00. The answer is f0 <length> ef cc 3b 29 00 followed by
// the password, NUL-terminated. A robot that only serves its password through
// the cloud answers f0 05 ef cc 3b 29 03.
// Wire format from roombapy (MIT) and dorita980 (MIT), which also warn that
// the most recent firmware no longer answers: the cloud method is the fallback.
// -----------------------------------------------------------------------------

import { connectTls } from './tls.js';

export const PASSWORD_REQUEST = Buffer.from('f005efcc3b2900', 'hex');
export const CLOUD_ONLY_ANSWER = Buffer.from('f005efcc3b2903', 'hex');
const HEADER_BYTES = 2;
const PASSWORD_OFFSET = 7;

/** Raised when the robot says its password comes from the cloud only. */
export class CloudOnlyError extends Error {
  constructor() {
    super('This robot only gives its password through the iRobot cloud');
    this.name = 'CloudOnlyError';
  }
}

/** @param {Buffer} data the complete answer @returns {string|null} */
export function decodePassword(data) {
  if (data.length <= PASSWORD_OFFSET) {
    return null;
  }
  const password = data.subarray(PASSWORD_OFFSET).toString('utf8').replace(/\0.*$/s, '');
  return password || null;
}

/**
 * One attempt: connect, ask, read the answer.
 * @param {object} options
 * @param {string} options.host
 * @param {Function} [options.open] socket opener (tests), connectTls by default
 * @param {number} [options.timeoutMs]
 * @returns {Promise<string|null>} the password, null when the robot did not give it
 * @throws {CloudOnlyError}
 */
export async function requestPassword({ host, open = connectTls, timeoutMs = 5000 }) {
  let socket;
  try {
    socket = await open({ host, timeoutMs });
  } catch {
    return null; // not listening (button not pressed) or unreachable
  }
  try {
    return await new Promise((resolve, reject) => {
      let data = Buffer.alloc(0);
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const finish = (fn, value) => {
        clearTimeout(timer);
        fn(value);
      };
      socket.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
        if (data.equals(CLOUD_ONLY_ANSWER)) {
          finish(reject, new CloudOnlyError());
          return;
        }
        if (data.length >= HEADER_BYTES && data.length >= data[1] + HEADER_BYTES) {
          finish(resolve, decodePassword(data));
        }
      });
      socket.on('error', () => finish(resolve, null));
      socket.on('close', () => finish(resolve, data.length > 0 ? decodePassword(data) : null));
      socket.write(PASSWORD_REQUEST);
    });
  } finally {
    socket.destroy();
  }
}

/**
 * Retry until the robot answers or the delay runs out (the user may press
 * the button a few seconds after starting the action).
 * @param {object} options requestPassword options, plus:
 * @param {number} [options.durationMs] total time to keep trying
 * @param {number} [options.intervalMs] pause between attempts
 * @returns {Promise<string|null>}
 */
export async function waitForPassword({ durationMs = 45000, intervalMs = 2000, ...options }) {
  const deadline = Date.now() + durationMs;
  for (;;) {
    const password = await requestPassword(options);
    if (password) {
      return password;
    }
    if (Date.now() + intervalMs >= deadline) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
