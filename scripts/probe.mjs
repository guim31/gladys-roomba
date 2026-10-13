#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only check of a real robot, and of the iRobot cloud login, with the
// integration's own code. Run from a machine on the robot's network (the
// development session had neither a robot nor access to the iRobot cloud).
//
//   ROOMBA_HOST=192.0.2.50 node scripts/probe.mjs
//       discovery query (UDP 5678) and TLS handshake on port 8883
//   ROOMBA_HOST=... ROOMBA_BLID=... ROOMBA_PASSWORD=... node scripts/probe.mjs
//       + MQTT connection, 20 s of reported state, interpretation
//   IROBOT_EMAIL=... IROBOT_PASSWORD=... [IROBOT_COUNTRY=FR] node scripts/probe.mjs
//       cloud login: number of robots, models (no BLID, no password)
//
// Nothing is sent to the robot but the discovery query and the MQTT CONNECT /
// SUBSCRIBE: no command. Nothing secret is printed: BLIDs, passwords, MAC and
// IP addresses, Wi-Fi details are masked. Close the iRobot app first: the
// robot accepts a single local client.
// -----------------------------------------------------------------------------

import { fetchCloudRobots } from '../src/roomba/cloud.js';
import { queryRobot } from '../src/roomba/discovery.js';
import { MqttSession } from '../src/roomba/mqtt.js';
import { classifyFailure, failureReason } from '../src/roomba/robot.js';
import { interpret, mergeReported, reportedOf } from '../src/roomba/state.js';
import { connectTls } from '../src/roomba/tls.js';

const env = process.env;
const mask = (value) => (value ? `${String(value).slice(0, 2)}…(${String(value).length})` : value);
const SENSITIVE =
  /^(mac|bssid|ssid|addr|gw|dns1|dns2|mask|wlan0HwAddr|navSerialNo|id|pmap_id|user_pmapv_id|hostname|blid|password|netinfo|wlcfg|svcEndpoints|cloudEnv|pmaps|lastCommand|tz|timezone|name)$/i;

/** The reported state with every identifying value masked. */
function scrub(value, key = '') {
  if (SENSITIVE.test(key)) return '<masked>';
  if (Array.isArray(value)) return value.map((item) => scrub(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  return value;
}

async function probeRobot(host) {
  console.log(`\n== Robot (${mask(host)})`);
  const info = await queryRobot(host, { timeoutMs: 4000 });
  if (info) {
    console.log(
      `discovery: answered — model ${info.sku}, firmware ${info.firmware}, capabilities ${Object.keys(info.cap ?? {}).join(', ') || '-'}, BLID ${mask(info.blid)}`,
    );
  } else {
    console.log('discovery: no answer on UDP 5678 (firewall, other subnet, or robot asleep)');
  }

  let socket;
  try {
    socket = await connectTls({ host });
    const cipher = socket.getCipher();
    console.log(`TLS: OK — ${socket.getProtocol()}, ${cipher?.name}`);
  } catch (error) {
    console.log(`TLS: FAILED — ${failureReason(error)} (${error.code ?? 'no code'})`);
    return;
  }

  const blid = env.ROOMBA_BLID || info?.blid;
  if (!env.ROOMBA_PASSWORD || !blid) {
    socket.destroy();
    console.log('MQTT: skipped (set ROOMBA_PASSWORD, and ROOMBA_BLID if discovery did not answer)');
    return;
  }
  const session = new MqttSession(socket, {
    clientId: blid,
    username: blid,
    password: env.ROOMBA_PASSWORD,
    keepalive: 60,
    clean: false,
    subscribe: '#',
  });
  const reported = {};
  const topics = new Map();
  session.on('message', (topic, payload) => {
    const delta = reportedOf(payload);
    const name = topic.replace(blid, '<blid>');
    topics.set(name, (topics.get(name) ?? 0) + 1);
    if (delta) mergeReported(reported, delta);
  });
  try {
    await session.connect();
    console.log('MQTT: connected, listening 20 s…');
  } catch (error) {
    console.log(`MQTT: REFUSED — ${classifyFailure(error)} (${failureReason(error)})`);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 20000));
  session.close();
  console.log(`topics: ${JSON.stringify(Object.fromEntries(topics))}`);
  console.log(
    `reported keys (${Object.keys(reported).length}): ${Object.keys(reported).sort().join(', ')}`,
  );
  console.log(`interpretation: ${JSON.stringify(interpret(reported))}`);
  console.log(`cleanMissionStatus: ${JSON.stringify(reported.cleanMissionStatus)}`);
  if (env.ROOMBA_DUMP === '1') {
    console.log(`reported (masked): ${JSON.stringify(scrub(reported), null, 2)}`);
  }
}

async function probeCloud() {
  console.log('\n== iRobot cloud');
  try {
    const robots = await fetchCloudRobots({
      email: env.IROBOT_EMAIL,
      password: env.IROBOT_PASSWORD,
      country: env.IROBOT_COUNTRY,
    });
    console.log(`login: OK — ${robots.length} robot(s)`);
    for (const robot of robots) {
      console.log(
        `  model ${robot.sku ?? '?'}, firmware ${robot.firmware ?? '?'}, BLID ${mask(robot.blid)}, password ${robot.password ? `${robot.password.length} characters` : 'missing'}`,
      );
    }
  } catch (error) {
    console.log(`login: FAILED — ${error.reason ?? 'error'} (${failureReason(error)})`);
  }
}

if (!env.ROOMBA_HOST && !env.IROBOT_EMAIL) {
  console.log(
    'Set ROOMBA_HOST (and optionally ROOMBA_BLID, ROOMBA_PASSWORD), or IROBOT_EMAIL and IROBOT_PASSWORD.',
  );
  process.exit(1);
}
if (env.ROOMBA_HOST) await probeRobot(env.ROOMBA_HOST);
if (env.IROBOT_EMAIL) await probeCloud();
