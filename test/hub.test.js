// -----------------------------------------------------------------------------
// End to end: the integration, the SDK's fake Gladys and a fake robot over
// MQTT. States, refresh without onPoll, re-publication on device creation,
// commands, scene events, a robot held by another client, quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROBOT, createWorld, fixture, waitUntil } from './helpers/world.js';
import { REFRESH_PERIOD_MS } from '../src/hub.js';

const mission = (fields) => ({ cleanMissionStatus: fields });

test('a robot added to Gladys is connected and its states are published', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const connect = await waitUntil(() => world.fake.connects[0]);
    assert.deepEqual(
      { ...connect },
      {
        protocol: 'MQTT',
        level: 4,
        clean: false,
        keepalive: 60,
        clientId: ROBOT.blid,
        username: ROBOT.blid,
        password: ROBOT.password,
      },
    );
    const { ids, gladys } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('battery')) !== undefined);
    assert.equal(gladys.fake.lastState(ids.feature('battery')), 100);
    assert.equal(gladys.fake.lastState(ids.feature('state')), 6); // docked, full
    assert.equal(gladys.fake.lastState(ids.feature('run-mode')), 0);
    assert.equal(gladys.fake.lastState(ids.feature('bin-full')), 0);
    assert.equal(gladys.fake.lastState(ids.feature('charging')), 0);
    assert.equal(gladys.fake.lastState(ids.feature('mission-duration')), 2);
    assert.equal(gladys.fake.lastState(ids.feature('mission-area')), 2.7); // 29 ft²
    assert.equal(gladys.fake.lastState(ids.feature('error')), 'Aucune erreur');
    assert.deepEqual(world.fake.subscriptions, ['#']);
    assert.deepEqual(gladys.fake.transports.at(-1), {
      device_external_id: ids.device,
      transport: 'local',
    });
  } finally {
    await world.stop();
  }
});

test('the states follow the robot without any onPoll from Gladys', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const { ids, gladys, fake } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 6);
    fake.push({
      batPct: 97,
      cleanMissionStatus: { cycle: 'clean', phase: 'run', mssnM: 3, sqft: 40 },
    });
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 1);
    assert.equal(gladys.fake.lastState(ids.feature('battery')), 97);
    assert.equal(gladys.fake.lastState(ids.feature('run-mode')), 1);
    assert.equal(gladys.fake.lastState(ids.feature('mission-area')), 3.7);
    const polls = gladys.fake.wsMessages.filter((message) => message.type === 'device.poll');
    assert.equal(polls.length, 0, 'no onPoll involved');
  } finally {
    await world.stop();
  }
});

test('the internal timer re-publishes and onPoll is only a fallback', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const { ids, gladys, app } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 6);
    const published = gladys.fake.states.length;
    // Nothing changed: the timer cycle sends nothing (deduplicated).
    const entry = app.hub.robots.get(ROBOT.blid);
    entry.lastRefreshAt = Date.now() - REFRESH_PERIOD_MS;
    await app.hub.cycle();
    assert.equal(gladys.fake.states.length, published);
    // The core's poll right after the timer is skipped.
    const before = entry.lastRefreshAt;
    await gladys.fake.poll({ external_id: ids.device });
    assert.equal(entry.lastRefreshAt, before);
  } finally {
    await world.stop();
  }
});

test('adding the robot in Gladys sends every state again, then refreshes the widget', async () => {
  const world = await createWorld({ created: false });
  try {
    await world.connect();
    const { ids, gladys, fake } = world;
    assert.equal(fake.connects.length, 0, 'a robot not added is never connected');
    assert.equal(gladys.fake.discoveredDevices.length, 1);
    await gladys.fake.deviceCreated({ external_id: ids.device, name: ROBOT.name, features: [] });
    await waitUntil(() => gladys.fake.lastState(ids.feature('battery')) === 100);
    const count = gladys.fake.states.length;
    // Created again (updated): the SDK forgot the values, they are re-sent.
    await gladys.fake.deviceUpdated({ external_id: ids.device, name: ROBOT.name, features: [] });
    await waitUntil(() => gladys.fake.states.length > count);
    await waitUntil(() => gladys.fake.widgetRefreshes.length > 0, { timeoutMs: 12000 });
    assert.equal(gladys.fake.widgetRefreshes[0], 'robot');
  } finally {
    await world.stop();
  }
});

test('commands: start, resume when paused, pause, stop, locate, dock', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const { ids, gladys, fake } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 6);
    const device = { external_id: ids.device };
    const feature = (code) => ({ external_id: ids.feature(code) });
    const sent = async (code, value) => {
      const before = fake.commands.length;
      const ack = await gladys.fake.setValue(device, feature(code), value);
      assert.equal(ack.success, true, JSON.stringify(ack));
      await waitUntil(() => fake.commands.length > before);
      return fake.commands.at(-1);
    };

    const start = await sent('run-mode', 1);
    assert.equal(start.command, 'start');
    assert.equal(start.initiator, 'localApp');
    assert.equal(typeof start.time, 'number');
    assert.equal((await sent('pause', 1)).command, 'pause');
    fake.push(mission({ cycle: 'clean', phase: 'stop' }));
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 2);
    assert.equal((await sent('run-mode', 1)).command, 'resume');
    assert.equal((await sent('run-mode', 0)).command, 'stop');
    assert.equal((await sent('locate', 1)).command, 'find');
    fake.push(mission({ cycle: 'none', phase: 'stop' }));
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 0);
    assert.equal((await sent('dock', 1)).command, 'dock');

    const readOnly = await gladys.fake.setValue(device, feature('battery'), 1);
    assert.equal(readOnly.success, false);
  } finally {
    await world.stop();
  }
});

test('dock while cleaning pauses first, then docks once the robot stopped', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const { ids, gladys, fake } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 6);
    fake.push(mission({ cycle: 'clean', phase: 'run' }));
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 1);
    const ack = await gladys.fake.setValue(
      { external_id: ids.device },
      { external_id: ids.feature('dock') },
      1,
    );
    assert.equal(ack.success, true);
    await waitUntil(() => fake.commands.length === 1);
    assert.equal(fake.commands[0].command, 'pause');
    fake.push(mission({ cycle: 'clean', phase: 'stop' }));
    await waitUntil(() => fake.commands.length === 2);
    assert.equal(fake.commands[1].command, 'dock');
  } finally {
    await world.stop();
  }
});

test('scene events: mission finished, stuck, bin full', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const { ids, gladys, fake } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 6);
    fake.push(mission({ cycle: 'clean', phase: 'run', mssnM: 1, sqft: 10 }));
    fake.push(mission({ cycle: 'clean', phase: 'run', mssnM: 30, sqft: 300 }));
    fake.push({ bin: { full: true } });
    fake.push({ bin: { full: false } }); // flicker while cleaning
    fake.push({ bin: { full: true } });
    fake.push(mission({ cycle: 'clean', phase: 'stuck', error: 17 }));
    fake.push(mission({ cycle: 'clean', phase: 'run', error: 0 }));
    fake.push(mission({ cycle: 'clean', phase: 'hmPostMsn', mssnM: 42, sqft: 400 }));
    fake.push(mission({ cycle: 'none', phase: 'charge', mssnM: 42, sqft: 400 }));
    await waitUntil(() => gladys.fake.sceneEvents.length >= 3);
    const events = gladys.fake.sceneEvents.map(({ key, data }) => ({ key, data }));
    assert.deepEqual(events, [
      { key: 'bin_full', data: { device: ids.device, robot: ROBOT.name } },
      {
        key: 'robot_error',
        data: {
          device: ids.device,
          robot: ROBOT.name,
          error_code: 17,
          error: 'Chemin bloqué (erreur 17)',
        },
      },
      {
        key: 'mission_finished',
        data: {
          device: ids.device,
          robot: ROBOT.name,
          outcome: 'completed',
          duration_minutes: 42,
          area_m2: 37.2,
        },
      },
    ]);
  } finally {
    await world.stop();
  }
});

test('a robot held by another local client: one warning, retries, one line when back', async () => {
  const world = await createWorld({ mode: 'busy' });
  try {
    await world.connect();
    const { ids, gladys, fake, app, logger } = world;
    await waitUntil(() => app.hub.statusOf(ROBOT.blid) === 'busy');
    await waitUntil(() => gladys.fake.transports.length > 0);
    const transport = gladys.fake.transports.at(-1);
    assert.equal(transport.transport, 'unreachable');
    assert.equal(transport.degraded, true);
    assert.match(transport.message.fr, /appli iRobot/);
    for (const lang of ['en', 'fr', 'de', 'es']) {
      assert.ok(transport.message[lang].length <= 200, lang);
    }
    // Further attempts stay out of the warnings.
    const connection = app.hub.robots.get(ROBOT.blid).connection;
    connection.retryNow();
    await waitUntil(() => fake.connects.length >= 2);
    await waitUntil(() => connection.status === 'busy');
    assert.equal(logger.at('warn').length, 1, logger.at('warn').join('\n'));
    // The app is closed: the next attempt connects.
    fake.mode = 'ok';
    connection.retryNow();
    await waitUntil(() => app.hub.statusOf(ROBOT.blid) === 'connected');
    await waitUntil(() => gladys.fake.lastState(ids.feature('battery')) === 100);
    assert.deepEqual(logger.at('info'), ['Dorita: connected again']);
    assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  } finally {
    await world.stop();
  }
});

test('a refused password is reported, and never logged', async () => {
  const world = await createWorld({ mode: 'auth' });
  try {
    await world.connect();
    await waitUntil(() => world.app.hub.statusOf(ROBOT.blid) === 'auth');
    const all = world.logger.lines.map((line) => line.text).join('\n');
    assert.match(all, /refused its password/);
    assert.ok(!all.includes(ROBOT.password));
    assert.ok(!all.includes(ROBOT.blid));
    assert.ok(!all.includes('192.0.2.21'));
  } finally {
    await world.stop();
  }
});

test('a normal cycle writes nothing at info level, and no secret anywhere', async () => {
  const world = await createWorld({
    initial: [fixture('reported/roomba-980.json'), fixture('reported/roomba-i7.json')],
  });
  try {
    await world.connect();
    const { ids, gladys, fake, app, logger } = world;
    await waitUntil(() => gladys.fake.lastState(ids.feature('battery')) === 100);
    const startup = logger.at('info');
    assert.deepEqual(startup, ['Dorita: connected']);
    fake.push({ batPct: 99, signal: { rssi: -50 } });
    fake.push(mission({ cycle: 'clean', phase: 'run', mssnM: 4 }));
    await waitUntil(() => gladys.fake.lastState(ids.feature('state')) === 1);
    app.hub.robots.get(ROBOT.blid).lastRefreshAt = 0;
    await app.hub.cycle();
    await gladys.fake.poll({ external_id: ids.device });
    await gladys.fake.widgetGet('robot', { settings: { robot: ids.device }, language: 'fr' });
    assert.deepEqual(logger.at('info'), startup, 'nothing more at info level');
    assert.deepEqual(logger.at('warn'), []);
    const all = logger.lines.map((line) => line.text).join('\n');
    assert.ok(!all.includes(ROBOT.password));
    assert.ok(!all.includes('192.0.2.21'));
  } finally {
    await world.stop();
  }
});

test('a robot deleted from Gladys is disconnected (the iRobot app gets it back)', async () => {
  const world = await createWorld();
  try {
    await world.connect();
    const { ids, gladys, app } = world;
    await waitUntil(() => app.hub.statusOf(ROBOT.blid) === 'connected');
    await gladys.fake.deviceDeleted({ external_id: ids.device });
    assert.equal(app.hub.robots.size, 0);
    await waitUntil(() => world.fake.sockets.size === 0);
  } finally {
    await world.stop();
  }
});
