// -----------------------------------------------------------------------------
// The robots at runtime: one local connection per robot added to Gladys, the
// states it pushes turned into Gladys states and scene events, and the
// commands sent back.
//
// Refresh. The robot pushes every change over MQTT; the integration publishes
// only what changed (publishChangedStates). An internal timer re-publishes
// every minute what changed meanwhile and re-sends the unchanged values every
// 6 hours (heartbeat: the front shows "no recent value" after 48 h). It does
// not depend on Gladys polling the device: Gladys 5.2 does not reliably poll
// external devices (GladysAssistant/Gladys#3198), and `onPoll` stays as a
// fallback that skips a robot the timer refreshed less than a period ago.
//
// One local client per robot: only the robots the user ADDED to Gladys are
// connected, so a robot merely discovered never keeps the iRobot app off its
// local connection.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { describeError } from './roomba/errors.js';
import { RobotConnection, STATUS, failureReason } from './roomba/robot.js';
import { detectEvents, interpret } from './roomba/state.js';
import { scanThroughGladys } from './roomba/discovery.js';
import { FEATURE, blidOf, buildDevice, idsOf, robotName, statesOf } from './devices.js';
import { createIssueLog } from './issues.js';
import { texts } from './i18n.js';

export const REFRESH_PERIOD_MS = 60 * 1000;
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
export const WIDGET_KEY = 'robot';
// The core accepts one widget refresh per 10 s; a burst of robot messages
// becomes one refresh at the end of it.
const WIDGET_REFRESH_GAP_MS = 10 * 1000;
// Coalesce the burst of messages a robot sends on connection.
const PUBLISH_DEBOUNCE_MS = 500;
// An unreachable robot may have a new address: look for it on the network
// after this long, and not more often than every RESCAN_GAP_MS.
const RESCAN_AFTER_MS = 5 * 60 * 1000;
const RESCAN_GAP_MS = 30 * 60 * 1000;
// Docking from the floor: pause first and wait for the robot (dorita980:
// "before dock you need to pause or stop", Home Assistant does the same).
const PAUSE_WAIT_MS = 10 * 1000;

export const TRIGGERS = ['mission_finished', 'robot_error', 'bin_full'];

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {import('./store.js').RobotStore} options.store
 * @param {() => { language: string }} options.getConfig
 * @param {Function} [options.open] robot socket opener (tests), TLS by default
 * @param {boolean} [options.timers] run the refresh timer (tests may turn it off)
 * @param {Function} [options.now]
 * @param {object} [options.logger]
 */
export function createHub({
  gladys,
  store,
  getConfig,
  open,
  timers = true,
  now = () => Date.now(),
  logger = createLogger({ name: 'roomba' }),
}) {
  const issues = createIssueLog(logger);
  /** blid → runtime entry */
  const robots = new Map();
  let timer = null;
  let stopped = true;
  let lastRescanAt = 0;
  let widgetTimer = null;
  let lastWidgetRefreshAt = 0;

  const language = () => getConfig().language;

  /** BLIDs of the robots the user added to Gladys. */
  function createdBlids() {
    return new Set(
      (gladys.devices ?? []).map((device) => blidOf(gladys, device.external_id)).filter(Boolean),
    );
  }

  function nameOf(blid) {
    const record = store.get(blid);
    return record ? robotName(record) : `Roomba ${blid.slice(-4)}`;
  }

  // --- Connections --------------------------------------------------------------

  function attach(record) {
    const connection = new RobotConnection({
      blid: record.blid,
      password: record.password,
      host: record.ip,
      ...(open ? { open } : {}),
      now,
    });
    const entry = {
      blid: record.blid,
      connection,
      view: null,
      previous: null,
      memory: { binArmed: true, wentHome: false },
      lastRefreshAt: 0,
      unreachableSince: null,
      everConnected: false,
      publishTimer: null,
    };
    connection.on('status', (status) => onStatus(entry, status));
    connection.on('reported', () => onReported(entry));
    robots.set(record.blid, entry);
    connection.start();
    return entry;
  }

  function detach(blid) {
    const entry = robots.get(blid);
    if (!entry) return;
    clearTimeout(entry.publishTimer);
    entry.connection.removeAllListeners();
    entry.connection.stop();
    robots.delete(blid);
  }

  /** Connect the added robots that have credentials, drop the others. */
  function sync() {
    if (stopped) return;
    const created = createdBlids();
    for (const blid of [...robots.keys()]) {
      const record = store.get(blid);
      if (!created.has(blid) || !record?.password || !record?.ip) {
        detach(blid);
      }
    }
    for (const blid of created) {
      const record = store.get(blid);
      if (!record?.password || !record?.ip) continue;
      const entry = robots.get(blid);
      if (!entry) {
        attach(record);
      } else if (entry.connection.password !== record.password) {
        detach(blid);
        attach(record);
      } else {
        entry.connection.setHost(record.ip);
      }
    }
  }

  function onStatus(entry, status) {
    const name = nameOf(entry.blid);
    if (status === STATUS.CONNECTING) {
      // A new session: the robot re-sends its whole state (its first
      // messages may arrive before the CONNECTED status), and nothing seen
      // before the gap may count as a transition.
      entry.previous = null;
      return;
    }
    if (status === STATUS.STOPPED) {
      return;
    }
    if (status === STATUS.CONNECTED) {
      entry.unreachableSince = null;
      if (!entry.everConnected) {
        entry.everConnected = true;
        if (!issues.isFailing(entry.blid)) {
          logger.info(`${name}: connected`);
        }
      }
      issues.ok(entry.blid, `${name}: connected again`);
    } else {
      if (status === STATUS.UNREACHABLE && entry.unreachableSince === null) {
        entry.unreachableSince = now();
      }
      const reason = failureReason(entry.connection.lastError);
      const what = {
        [STATUS.BUSY]: 'the robot turns the connection away (iRobot app or another local client?)',
        [STATUS.AUTH]: 'the robot refused its password',
        [STATUS.UNREACHABLE]: 'no answer from the robot',
      }[status];
      issues.fail(entry.blid, `${name}: ${what} (${reason}), retrying`);
    }
    publishTransport(entry).catch((error) =>
      logger.debug(`${name}: transport not published (${error.message})`),
    );
    requestWidgetRefresh();
  }

  function transportOf(entry) {
    const ids = idsOf(gladys, entry.blid);
    const status = entry.connection.status;
    if (status === STATUS.CONNECTED) {
      return { external_id: ids.device, transport: DEVICE_TRANSPORTS.LOCAL };
    }
    const key = status === STATUS.BUSY || status === STATUS.AUTH ? status : 'unreachable';
    return {
      external_id: ids.device,
      transport: DEVICE_TRANSPORTS.UNREACHABLE,
      degraded: true,
      message: Object.fromEntries(
        ['en', 'fr', 'de', 'es'].map((lang) => [lang, texts(lang).transport[key]]),
      ),
    };
  }

  async function publishTransport(entry) {
    if (!gladys.connected) return;
    await gladys.publishTransports([transportOf(entry)]);
  }

  // --- States and events --------------------------------------------------------

  function onReported(entry) {
    const view = interpret(entry.connection.reported);
    if (!view) return;
    entry.view = view;
    const events = detectEvents(entry.previous, view, entry.memory);
    entry.previous = view;
    for (const event of events) {
      fire(entry, event).catch((error) =>
        logger.warn(`${nameOf(entry.blid)}: scene event ${event.key} refused (${error.message})`),
      );
    }
    clearTimeout(entry.publishTimer);
    entry.publishTimer = setTimeout(() => {
      entry.publishTimer = null;
      refresh(entry.blid).catch(() => {});
    }, PUBLISH_DEBOUNCE_MS);
    entry.publishTimer.unref?.();
    requestWidgetRefresh();
  }

  async function fire(entry, { key, data }) {
    if (!createdBlids().has(entry.blid)) return;
    const name = nameOf(entry.blid);
    const payload = { device: idsOf(gladys, entry.blid).device, robot: name, ...data };
    if (key === 'robot_error') {
      payload.error = describeError(data.error_code, language());
    }
    logger.debug(`${name}: scene event ${key}`);
    await gladys.publishSceneEvent(key, payload);
  }

  /**
   * Publish what changed for one robot (and the heartbeat when due).
   * @returns {Promise<boolean>} whether there was something to publish
   */
  async function refresh(blid) {
    const entry = robots.get(blid);
    if (!entry || !gladys.connected) return false;
    entry.lastRefreshAt = now();
    if (!entry.view) return false;
    const states = statesOf(gladys, blid, entry.view, language());
    try {
      const result = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      issues.ok(`states:${blid}`, `${nameOf(blid)}: Gladys accepts the states again`);
      if (result?.count) {
        logger.debug(`${nameOf(blid)}: ${result.count} state(s) published`);
      }
      return true;
    } catch (error) {
      issues.fail(`states:${blid}`, `${nameOf(blid)}: states refused by Gladys (${error.message})`);
      return false;
    }
  }

  function requestWidgetRefresh() {
    if (widgetTimer || stopped) return;
    const wait = Math.max(0, lastWidgetRefreshAt + WIDGET_REFRESH_GAP_MS - now());
    widgetTimer = setTimeout(() => {
      widgetTimer = null;
      lastWidgetRefreshAt = now();
      if (!gladys.connected) return;
      try {
        gladys.requestWidgetRefresh(WIDGET_KEY); // fire and forget (WebSocket message)
      } catch (error) {
        logger.debug(`Widget refresh not requested (${error.message})`);
      }
    }, wait);
    widgetTimer.unref?.();
  }

  // --- Timer --------------------------------------------------------------------

  async function cycle() {
    if (!gladys.connected) {
      logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    for (const entry of robots.values()) {
      if (now() - entry.lastRefreshAt >= REFRESH_PERIOD_MS / 2) {
        await refresh(entry.blid);
      }
    }
    const lost = [...robots.values()].some(
      (entry) =>
        entry.unreachableSince !== null && now() - entry.unreachableSince >= RESCAN_AFTER_MS,
    );
    if (lost && now() - lastRescanAt >= RESCAN_GAP_MS) {
      lastRescanAt = now();
      await rescan().catch((error) => logger.debug(`Network scan failed (${error.message})`));
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } catch (error) {
        logger.error(`Refresh cycle failed (${error.message})`);
      } finally {
        schedule();
      }
    }, REFRESH_PERIOD_MS);
    timer.unref?.();
  }

  // --- Discovery ----------------------------------------------------------------

  /** The robots offered in the Discovery tab: every robot with a password. */
  function discoveredDevices() {
    return store
      .list()
      .filter((robot) => robot.password && robot.ip)
      .map((robot) => buildDevice(gladys, robot, language()));
  }

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(discoveredDevices());
  }

  /**
   * Look for the robots on the network (through the Gladys core) and record
   * their addresses. Robots found without a password are remembered, so that
   * "Add a robot" or the cloud action can complete them.
   * @returns {Promise<object[]>} the robots that answered
   */
  async function rescan() {
    const found = await scanThroughGladys(gladys);
    for (const robot of found) {
      await store.upsert(robot.blid, robot);
    }
    if (found.length > 0) {
      logger.debug(`Network scan: ${found.length} robot(s) answered`);
      sync();
      await publishDevices();
    }
    return found;
  }

  // --- Commands -----------------------------------------------------------------

  function connectionOf(blid) {
    const entry = robots.get(blid);
    if (!entry || !entry.connection.connected) {
      throw new Error(
        `${nameOf(blid)} is not connected (${entry?.connection.status ?? 'unknown'})`,
      );
    }
    return entry;
  }

  async function waitFor(entry, predicate, timeoutMs) {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (entry.view && predicate(entry.view)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  /**
   * Run a user command: 'start' (start or resume), 'pause', 'resume', 'stop',
   * 'dock' (pause first when on the floor), 'locate'.
   * @returns {Promise<string>} the command sent last
   */
  async function command(blid, what, origin = 'Gladys') {
    const entry = connectionOf(blid);
    const view = entry.view;
    let sent;
    switch (what) {
      case 'start':
        sent = view?.paused ? 'resume' : 'start';
        entry.connection.command(sent);
        break;
      case 'dock':
        if (view?.onFloor) {
          // Gladys acks a command within 5 s: the dock follows in the
          // background once the robot has stopped.
          entry.connection.command('pause');
          sent = 'pause, then dock';
          waitFor(entry, (current) => !current.onFloor, PAUSE_WAIT_MS)
            .then(() => connectionOf(blid).connection.command('dock'))
            .catch((error) =>
              logger.warn(`${nameOf(blid)}: dock not sent (${failureReason(error)})`),
            );
        } else {
          sent = 'dock';
          entry.connection.command(sent);
        }
        break;
      case 'locate':
        sent = 'find';
        entry.connection.command(sent);
        break;
      case 'pause':
      case 'resume':
      case 'stop':
        sent = what;
        entry.connection.command(sent);
        break;
      default:
        throw new Error(`Unknown command ${what}`);
    }
    logger.info(`${nameOf(blid)}: ${sent} (${origin})`);
    return sent;
  }

  /** Gladys onSetValue. */
  async function setValue(device, feature, value) {
    const blid = blidOf(gladys, device.external_id);
    if (!blid) {
      throw new Error(`Unknown device ${device.external_id}`);
    }
    const code = feature.external_id.slice(idsOf(gladys, blid).device.length + 1);
    switch (code) {
      case FEATURE.RUN_MODE:
        return command(blid, Number(value) >= 1 ? 'start' : 'stop');
      case FEATURE.DOCK:
        return command(blid, 'dock');
      case FEATURE.PAUSE:
        return command(blid, 'pause');
      case FEATURE.LOCATE:
        return command(blid, 'locate');
      default:
        throw new Error(`The feature ${code} is read-only`);
    }
  }

  // --- Lifecycle ----------------------------------------------------------------

  return {
    robots,
    sync,
    refresh,
    rescan,
    command,
    setValue,
    publishDevices,
    discoveredDevices,
    nameOf,
    language,

    /** Start (or restart after a new config): connect, publish, refresh. */
    async start() {
      stopped = false;
      sync();
      await publishDevices();
      await Promise.all(
        [...robots.values()].map((entry) => publishTransport(entry).catch(() => {})),
      );
      schedule();
    },

    /** Gladys onPoll (fallback): refresh unless the timer just did. */
    async pollFromCore(device) {
      const blid = blidOf(gladys, device.external_id);
      const entry = blid && robots.get(blid);
      if (!entry) return;
      if (now() - entry.lastRefreshAt < REFRESH_PERIOD_MS * 0.9) {
        logger.debug(
          `${nameOf(blid)}: refreshed ${now() - entry.lastRefreshAt} ms ago, poll skipped`,
        );
        return;
      }
      await refresh(blid);
    },

    /**
     * The user added (or updated) a robot in Gladys: connect it, and send
     * every state again now (the core dropped those sent before the device
     * existed; the SDK already forgot them).
     */
    async deviceChanged(device) {
      sync();
      const blid = blidOf(gladys, device.external_id);
      const entry = blid && robots.get(blid);
      if (entry) {
        await refresh(blid);
        await publishTransport(entry).catch(() => {});
      }
      requestWidgetRefresh();
    },

    /** A device was deleted in Gladys: free the robot for the iRobot app. */
    deviceDeleted() {
      sync();
    },

    /** Connection state of a robot, for the widget and the diagnostic. */
    statusOf(blid) {
      return robots.get(blid)?.connection.status ?? STATUS.STOPPED;
    },

    viewOf(blid) {
      return robots.get(blid)?.view ?? null;
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(widgetTimer);
      timer = null;
      widgetTimer = null;
      for (const blid of [...robots.keys()]) detach(blid);
    },

    /** One refresh cycle now (tests). */
    cycle,
  };
}
