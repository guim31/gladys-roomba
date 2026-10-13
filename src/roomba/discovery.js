// -----------------------------------------------------------------------------
// Finding robots: the `irobotmcs` UDP query on port 5678.
//
// A robot answering the query sends a JSON document (roombapy, dorita980):
//   { "ver": "3", "hostname": "Roomba-<BLID>", "robotname": "Kitchen",
//     "ip": "...", "mac": "...", "sw": "v2.4.16-126", "sku": "R98----",
//     "nc": 0, "proto": "mqtt", "cap": { "pose": 1, ... } }
// The BLID, the robot's MQTT username, is the part of the hostname after the
// dash ("iRobot-<BLID>" on recent models).
//
// The integration container sits on a bridge network: a broadcast it sends
// never reaches the LAN. So the network scan goes through the Gladys core
// (mediated discovery): the core broadcasts the query on port 5678 and relays
// the answers. The core sends from an ephemeral port, and roombapy notes that
// some robots answer to port 5678 rather than to the sender's port: a passive
// capture of port 5678 runs during the active scan to catch those.
//
// A unicast query to a known address, however, crosses the bridge: the
// "add a robot" action asks the robot directly, from port 5678 when it can.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';

export const DISCOVERY_PORT = 5678;
export const DISCOVERY_QUERY = Buffer.from('irobotmcs');

/**
 * Parse one discovery answer.
 * @param {Buffer|string} payload
 * @param {string} [sourceIp] the address the answer came from
 * @returns {object|null} `{ blid, name, ip, mac, sku, firmware, cap }`
 */
export function parseAnnouncement(payload, sourceIp) {
  let data;
  try {
    const text = payload.toString('utf8');
    if (text === DISCOVERY_QUERY.toString()) {
      return null; // our own query, echoed by the broadcast
    }
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data.hostname !== 'string') {
    return null;
  }
  const match = data.hostname.match(/^(roomba|irobot)-([A-Za-z0-9]+)$/i);
  if (!match) {
    return null;
  }
  const ip = typeof data.ip === 'string' && data.ip ? data.ip : sourceIp;
  return {
    blid: match[2],
    name:
      typeof data.robotname === 'string' && data.robotname.trim() ? data.robotname.trim() : null,
    ip: ip ?? null,
    mac: typeof data.mac === 'string' ? data.mac : null,
    sku: typeof data.sku === 'string' ? data.sku : null,
    firmware: typeof data.sw === 'string' ? data.sw : null,
    cap: data.cap && typeof data.cap === 'object' ? data.cap : null,
  };
}

/**
 * Network scan through the Gladys core (bridge network: no broadcast).
 * @param {object} gladys GladysIntegration
 * @param {{ timeoutSeconds?: number }} [options]
 * @returns {Promise<object[]>} parsed announcements, one per robot
 */
export async function scanThroughGladys(gladys, { timeoutSeconds = 5 } = {}) {
  const [active, passive] = await Promise.allSettled([
    gladys.scanNetwork('udp-active-broadcast', {
      port: DISCOVERY_PORT,
      payload: DISCOVERY_QUERY,
      timeoutSeconds,
    }),
    gladys.scanNetwork('udp-broadcast', { timeoutSeconds: timeoutSeconds + 1 }),
  ]);
  if (active.status === 'rejected' && passive.status === 'rejected') {
    throw active.reason;
  }
  const replies = [
    ...(active.status === 'fulfilled' ? active.value : []),
    ...(passive.status === 'fulfilled' ? passive.value : []),
  ];
  const robots = new Map();
  for (const { source_ip: sourceIp, payload_base64: payload } of replies) {
    const robot = parseAnnouncement(Buffer.from(payload ?? '', 'base64'), sourceIp);
    if (robot && !robots.has(robot.blid)) {
      robots.set(robot.blid, robot);
    }
  }
  return [...robots.values()];
}

/**
 * Ask one robot directly (unicast, crosses the bridge network).
 * @param {string} host
 * @param {{ timeoutMs?: number, port?: number, attempts?: number }} [options]
 * @returns {Promise<object|null>} the announcement, or null when nothing answered
 */
export async function queryRobot(
  host,
  { timeoutMs = 3000, port = DISCOVERY_PORT, attempts = 3 } = {},
) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  try {
    // From port 5678 when free: some robots answer to it, not to the sender.
    await bind(socket, port).catch(() => bind(socket, 0));
    return await new Promise((resolve) => {
      const timers = [];
      const done = (value) => {
        timers.forEach(clearTimeout);
        resolve(value);
      };
      socket.on('message', (payload, remote) => {
        const robot = parseAnnouncement(payload, remote.address);
        if (robot && (remote.address === host || robot.ip === host)) {
          done(robot);
        }
      });
      socket.on('error', () => done(null));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        timers.push(
          setTimeout(
            () => socket.send(DISCOVERY_QUERY, port, host, () => {}),
            (attempt * timeoutMs) / attempts,
          ),
        );
      }
      timers.push(setTimeout(() => done(null), timeoutMs));
    });
  } finally {
    socket.close();
  }
}

function bind(socket, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    socket.once('error', onError);
    socket.bind(port, () => {
      socket.off('error', onError);
      resolve();
    });
  });
}
