// -----------------------------------------------------------------------------
// A test world: the SDK's fake Gladys, a temporary /data, fake robots, the
// integration wired to them, and a logger that records every line.
// -----------------------------------------------------------------------------

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { startFakeRobot } from './fakeRobot.js';

export const fixture = (path) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'));

export const ROBOT = {
  blid: '3115C00000000001',
  password: ':1:1486937829:EXAMPLEpassword0',
  name: 'Dorita',
  sku: 'R980020',
};

/** A logger recording every line, by level. */
export function recordingLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push({ level, text: args.map(String).join(' ') });
  const logger = {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: () => logger,
    at: (level) => lines.filter((line) => line.level === level).map((line) => line.text),
  };
  return logger;
}

export const waitUntil = async (predicate, { timeoutMs = 3000, stepMs = 10 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitUntil: timed out');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

/**
 * @param {object} [options]
 * @param {object} [options.config] integration config
 * @param {boolean} [options.created] the robot is added in Gladys
 * @param {object[]} [options.initial] reported documents sent on connection
 * @param {string} [options.mode] fake robot mode
 * @param {object} [options.deps] action network functions
 * @param {object} [options.robot] the stored robot (ROBOT by default)
 * @param {boolean} [options.stored] write the robot in /data first
 */
export async function createWorld({
  config = {},
  created = true,
  initial = [fixture('reported/roomba-980.json')],
  mode = 'ok',
  deps,
  robot = ROBOT,
  stored = true,
  scanResults = {},
} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gladys-roomba-'));
  const fake = await startFakeRobot({ blid: robot.blid, password: robot.password, mode, initial });
  if (stored) {
    await writeFile(
      join(dataDir, 'robots.json'),
      JSON.stringify({
        version: 1,
        robots: { [robot.blid]: { ...robot, ip: '192.0.2.21', source: 'cloud' } },
      }),
    );
  }
  const gladys = createFakeGladys({ config, scanResults });
  const ids = gladys.externalIds('robot', robot.blid);
  if (created) {
    gladys.fake.devices = [{ external_id: ids.device, name: robot.name, features: [] }];
  }
  const logger = recordingLogger();
  const app = await createApp({
    gladys,
    dataDir,
    open: fake.open,
    deps,
    timers: false,
    logger,
  });
  return {
    gladys,
    fake,
    app,
    ids,
    logger,
    dataDir,
    async connect() {
      await gladys.connect();
    },
    async stop() {
      app.stop();
      await gladys.disconnect().catch(() => {});
      await fake.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
