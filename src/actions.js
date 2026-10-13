// -----------------------------------------------------------------------------
// The buttons of the Configuration screen (manifest `actions`).
//
//   - add_robot          an IP address, and optionally the password and the
//                        BLID: asks the robot who it is (unicast UDP 5678),
//                        reads its password with the HOME button method when
//                        none is known, checks it with an MQTT connection;
//   - cloud_credentials  the iRobot account email and password, used once to
//                        read the BLID and password of every robot of the
//                        account (never stored), then a network scan;
//   - forget_robot       deletes a robot's credentials and closes its link;
//   - diagnostic         what a tester pastes on the forum: no BLID, address,
//                        MAC or password.
// Secret fields in action forms can be typed since Gladys 5.2.0 (#3154).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CloudError, fetchCloudRobots } from './roomba/cloud.js';
import { queryRobot } from './roomba/discovery.js';
import { MqttSession } from './roomba/mqtt.js';
import { CloudOnlyError, waitForPassword } from './roomba/password.js';
import { STATUS, classifyFailure, failureReason } from './roomba/robot.js';
import { connectTls } from './roomba/tls.js';
import { interpret } from './roomba/state.js';
import { blidOf, robotName } from './devices.js';
import { allLanguages, texts } from './i18n.js';

export const ACTION_KEYS = ['add_robot', 'cloud_credentials', 'forget_robot', 'diagnostic'];

const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;

/**
 * Check credentials with one MQTT connection.
 * @returns {Promise<'connected'|'auth'|'busy'|'unreachable'>}
 */
export async function verifyCredentials({ blid, password, host, open = connectTls }) {
  let session;
  try {
    const socket = await open({ host });
    session = new MqttSession(socket, {
      clientId: blid,
      username: blid,
      password,
      keepalive: 0,
      clean: false,
    });
    await session.connect();
    return STATUS.CONNECTED;
  } catch (error) {
    return classifyFailure(error);
  } finally {
    session?.close();
  }
}

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {import('./store.js').RobotStore} options.store
 * @param {ReturnType<import('./hub.js').createHub>} options.hub
 * @param {object} [options.deps] network functions, replaced in the tests
 */
export function createActions({
  gladys,
  store,
  hub,
  deps = {},
  logger = createLogger({ name: 'roomba' }),
}) {
  const net = {
    queryRobot,
    waitForPassword,
    fetchCloudRobots,
    verifyCredentials,
    ...deps,
  };
  const t = () => texts(hub.language());
  const fail = (message) => {
    throw new Error(message);
  };

  async function addRobot(fields) {
    const ip = String(fields.ip ?? '').trim();
    if (!ip || !HOST_PATTERN.test(ip)) {
      fail(t().actions.missingIp);
    }
    const info = await net.queryRobot(ip);
    const blid = String(fields.blid ?? '').trim() || info?.blid;
    if (!blid || !/^[A-Za-z0-9]+$/.test(blid)) {
      fail(t().actions.noAnswer(ip));
    }
    const known = store.get(blid);
    const name = robotName({ ...known, ...info, blid });

    let password = String(fields.password ?? '');
    let source = 'manual';
    if (!password && known?.password) {
      password = known.password;
      source = known.source ?? 'manual';
    }
    if (!password) {
      try {
        password = await net.waitForPassword({ host: ip });
      } catch (error) {
        if (error instanceof CloudOnlyError) fail(t().actions.cloudOnly);
        throw error;
      }
      if (!password) fail(t().actions.noPassword);
      source = 'local';
    }

    // The integration may hold the robot already: then it is the connection.
    const alreadyConnected =
      hub.statusOf(blid) === STATUS.CONNECTED && known?.password === password && known?.ip === ip;
    const result = alreadyConnected
      ? STATUS.CONNECTED
      : await net.verifyCredentials({ blid, password, host: ip });
    if (result === STATUS.AUTH) {
      logger.info(`Action add_robot: ${name} refused the password`);
      fail(t().actions.authFailed(name));
    }

    await store.upsert(blid, { ...info, ip, password, source });
    hub.sync();
    await hub.publishDevices();
    logger.info(`Action add_robot: ${name} added (password: ${source}, check: ${result})`);
    return allLanguages((table) => table.actions.added(name, result === STATUS.CONNECTED));
  }

  async function cloudCredentials(fields) {
    let robots;
    try {
      robots = await net.fetchCloudRobots({
        email: String(fields.email ?? '').trim(),
        password: String(fields.password ?? ''),
        country: fields.country,
      });
    } catch (error) {
      const reason = error instanceof CloudError ? error.reason : 'network';
      logger.info(`Action cloud_credentials: failed (${reason})`);
      const key = {
        credentials: 'cloudCredentials',
        network: 'cloudNetwork',
        no_robot: 'cloudNoRobot',
      }[reason];
      fail(t().actions[key ?? 'cloudUnexpected']);
    }
    for (const robot of robots) {
      await store.upsert(robot.blid, { ...robot, source: 'cloud' });
    }
    try {
      await hub.rescan();
    } catch (error) {
      logger.debug(`Network scan after the cloud login failed (${error.message})`);
    }
    hub.sync();
    await hub.publishDevices();
    const located = robots.filter((robot) => store.get(robot.blid)?.ip).length;
    const names = robots.map((robot) => robotName(store.get(robot.blid))).join(', ');
    logger.info(`Action cloud_credentials: ${robots.length} robot(s), ${located} located`);
    return allLanguages((table) => table.actions.cloudDone(robots.length, located, names));
  }

  async function forgetRobot(fields) {
    const blid = blidOf(gladys, fields.device);
    const record = blid && store.get(blid);
    if (!record) {
      fail(t().actions.unknownDevice);
    }
    const name = robotName(record);
    await store.remove(blid);
    hub.sync();
    await hub.publishDevices();
    logger.info(`Action forget_robot: ${name} forgotten`);
    return allLanguages((table) => table.actions.forgotten(name));
  }

  async function diagnostic() {
    const created = new Set(
      (gladys.devices ?? []).map((device) => blidOf(gladys, device.external_id)).filter(Boolean),
    );
    const robots = store.list();
    if (robots.length === 0) {
      return allLanguages((table) => table.actions.noRobot);
    }
    const lines = [`Roomba integration diagnostic: ${robots.length} robot(s)`];
    robots.forEach((robot, index) => {
      const entry = hub.robots.get(robot.blid);
      const reported = entry?.connection.reported ?? {};
      const view = interpret(reported);
      lines.push('');
      lines.push(
        `Robot ${index + 1}: ${robot.sku ?? 'model unknown'}, firmware ${robot.firmware ?? reported.softwareVer ?? '?'}`,
      );
      lines.push(
        `  credentials: ${robot.password ? `yes (${robot.source ?? '?'})` : 'no'}, address: ${robot.ip ? 'known' : 'unknown'}, added in Gladys: ${created.has(robot.blid) ? 'yes' : 'no'}`,
      );
      lines.push(
        `  connection: ${hub.statusOf(robot.blid)}${entry?.connection.lastError ? ` (last error: ${failureReason(entry.connection.lastError)})` : ''}`,
      );
      if (entry?.connection.lastMessageAt) {
        lines.push(
          `  last message: ${Math.round((Date.now() - entry.connection.lastMessageAt) / 1000)} s ago`,
        );
      }
      if (view) {
        lines.push(
          `  mission: cycle ${view.cycle}, phase ${view.phase || '-'}, state ${view.state}, error ${view.error}, battery ${view.battery ?? '?'} %, bin ${view.binKnown ? (view.binFull ? 'full' : 'ok') : '?'}`,
        );
      }
      const cap = reported.cap ?? robot.cap;
      if (cap && typeof cap === 'object') {
        lines.push(`  capabilities: ${Object.keys(cap).sort().join(', ')}`);
      }
      if (Object.keys(reported).length > 0) {
        lines.push(`  reported keys: ${Object.keys(reported).length}`);
      }
    });
    logger.info('Action diagnostic');
    return lines.join('\n');
  }

  return {
    add_robot: addRobot,
    cloud_credentials: cloudCredentials,
    forget_robot: forgetRobot,
    diagnostic,
  };
}
