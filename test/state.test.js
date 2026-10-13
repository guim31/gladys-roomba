// -----------------------------------------------------------------------------
// What the reported state means: Gladys state and run mode for every phase
// (including the cases Home Assistant's tests pin), mission figures, scene
// event transitions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_MODE,
  VACUUM_STATE as S,
  detectEvents,
  interpret,
  mergeReported,
  reportedOf,
} from '../src/roomba/state.js';
import { fixture } from './helpers/world.js';

const view = (cleanMissionStatus, extra = {}) =>
  interpret({ batPct: 80, bin: { present: true, full: false }, ...extra, cleanMissionStatus });

test('the Gladys state of every phase', () => {
  const cases = [
    // [phase, cycle, expected state, expected run mode]
    ['charge', 'none', S.CHARGING, RUN_MODE.IDLE],
    ['charge', 'clean', S.CHARGING, RUN_MODE.CLEANING], // recharging mid-mission (HA #148287)
    ['hmMidMsn', 'clean', S.RETURNING, RUN_MODE.CLEANING],
    ['hmPostMsn', 'clean', S.RETURNING, RUN_MODE.IDLE],
    ['hmUsrDock', 'clean', S.RETURNING, RUN_MODE.IDLE],
    ['run', 'clean', S.RUNNING, RUN_MODE.CLEANING],
    ['run', 'spot', S.RUNNING, RUN_MODE.CLEANING],
    ['pause', 'clean', S.PAUSED, RUN_MODE.IDLE],
    ['stop', 'clean', S.PAUSED, RUN_MODE.IDLE], // stopped mid-mission = paused (HA)
    ['stop', 'none', S.STOPPED, RUN_MODE.IDLE],
    ['stuck', 'clean', S.ERROR, RUN_MODE.IDLE],
    ['evac', 'none', S.DOCKED, RUN_MODE.IDLE],
    ['chargingerror', 'none', S.ERROR, RUN_MODE.IDLE],
    ['', 'none', S.STOPPED, RUN_MODE.IDLE],
    ['someFutureFirmwarePhase', 'none', S.STOPPED, RUN_MODE.IDLE],
  ];
  for (const [phase, cycle, state, runMode] of cases) {
    const result = view({ phase, cycle, error: 0 });
    assert.equal(result.state, state, `${phase}/${cycle}: state`);
    assert.equal(result.runMode, runMode, `${phase}/${cycle}: run mode`);
  }
});

test('on the base: charging below 100 %, docked when full', () => {
  assert.equal(view({ phase: 'charge', cycle: 'none' }, { batPct: 99 }).state, S.CHARGING);
  assert.equal(view({ phase: 'charge', cycle: 'none' }, { batPct: 100 }).state, S.DOCKED);
  assert.equal(view({ phase: 'charge', cycle: 'none' }, { batPct: 100 }).charging, false);
});

test('a fault that stops the robot is an error state', () => {
  assert.equal(view({ phase: 'stop', cycle: 'none', error: 17 }).state, S.ERROR);
  assert.equal(view({ phase: 'stop', cycle: 'none', error: 17 }).inError, true);
  // A charging error code while on the base keeps the base state.
  assert.equal(view({ phase: 'charge', cycle: 'none', error: 102 }).state, S.CHARGING);
});

test('mission figures: minutes, and square feet in square meters', () => {
  const result = interpret(fixture('reported/roomba-980.json'));
  assert.equal(result.minutes, 2);
  assert.equal(result.area, 2.7);
  assert.equal(result.battery, 100);
  assert.equal(result.binKnown, true);
  assert.equal(result.binFull, false);
  assert.equal(result.state, S.DOCKED);
});

test('every fixture is understood', () => {
  for (const name of ['roomba-980', 'roomba-i7', 'braava-m6']) {
    const result = interpret(fixture(`reported/${name}.json`));
    assert.ok(result, name);
    assert.equal(typeof result.state, 'number', name);
  }
  // The Braava has no bin sensor: the bin stays unknown.
  assert.equal(interpret(fixture('reported/braava-m6.json')).binKnown, false);
  assert.equal(interpret(fixture('reported/braava-m6.json')).state, S.CHARGING);
});

test('nothing is known before the robot reports its mission', () => {
  assert.equal(interpret({ batPct: 50 }), null);
  assert.equal(interpret({}), null);
});

test('deltas are merged deeply, arrays and scalars replaced', () => {
  const state = {};
  mergeReported(state, fixture('reported/roomba-980.json'));
  mergeReported(state, { cleanMissionStatus: { phase: 'run' }, langs: [1] });
  assert.equal(state.cleanMissionStatus.phase, 'run');
  assert.equal(state.cleanMissionStatus.nMssn, 324, 'siblings kept');
  assert.deepEqual(state.langs, [1]);
});

test('only `state.reported` documents are read', () => {
  assert.deepEqual(reportedOf('{"state":{"reported":{"batPct":42}}}'), { batPct: 42 });
  assert.equal(reportedOf('{"state":{"desired":{}}}'), null);
  assert.equal(reportedOf('{"reqId":"x","data":[]}'), null);
  assert.equal(reportedOf('not json'), null);
  assert.equal(reportedOf('{"state":{"reported":[1]}}'), null);
});

// --- Scene events ------------------------------------------------------------------

function run(sequence) {
  const memory = { binArmed: true, wentHome: false };
  let previous = null;
  const events = [];
  for (const [mission, extra] of sequence) {
    const next = view(mission, extra);
    events.push(...detectEvents(previous, next, memory));
    previous = next;
  }
  return events;
}

test('a mission that ends with the robot going home by itself is completed', () => {
  const events = run([
    [{ cycle: 'none', phase: 'charge' }],
    [{ cycle: 'clean', phase: 'run', mssnM: 10, sqft: 100 }],
    [{ cycle: 'clean', phase: 'hmMidMsn' }],
    [{ cycle: 'clean', phase: 'charge' }], // recharge in the middle: no event
    [{ cycle: 'clean', phase: 'run' }],
    [{ cycle: 'clean', phase: 'hmPostMsn', mssnM: 50, sqft: 500 }],
    [{ cycle: 'clean', phase: 'charge', mssnM: 50, sqft: 500 }], // home, cycle not reset yet
    [{ cycle: 'none', phase: 'charge', mssnM: 50, sqft: 500 }],
  ]);
  assert.deepEqual(events, [
    {
      key: 'mission_finished',
      data: { outcome: 'completed', duration_minutes: 50, area_m2: 46.5 },
    },
  ]);
});

test('a mission stopped or sent home by someone is "stopped"', () => {
  assert.deepEqual(
    run([
      [{ cycle: 'clean', phase: 'run', mssnM: 5 }],
      [{ cycle: 'none', phase: 'stop', mssnM: 5 }],
    ]).map((event) => event.data.outcome),
    ['stopped'],
  );
  assert.deepEqual(
    run([
      [{ cycle: 'clean', phase: 'run', mssnM: 5 }],
      [{ cycle: 'clean', phase: 'hmUsrDock', mssnM: 5 }],
      [{ cycle: 'none', phase: 'charge', mssnM: 5 }],
    ]).map((event) => event.data.outcome),
    ['stopped'],
  );
});

test('a mission ending on a fault fires the error, not "finished"', () => {
  const events = run([
    [{ cycle: 'clean', phase: 'run' }],
    [{ cycle: 'clean', phase: 'stuck', error: 6 }],
    [{ cycle: 'none', phase: 'stuck', error: 6 }],
  ]);
  assert.deepEqual(events, [{ key: 'robot_error', data: { error_code: 6 } }]);
});

test('an error fires once, and again on another error code', () => {
  const events = run([
    [{ cycle: 'clean', phase: 'run' }],
    [{ cycle: 'clean', phase: 'stuck', error: 6 }],
    [{ cycle: 'clean', phase: 'stuck', error: 6 }],
    [{ cycle: 'clean', phase: 'stuck', error: 2 }],
  ]);
  assert.deepEqual(
    events.map((event) => event.data.error_code),
    [6, 2],
  );
});

test('bin full fires once until the bin is seen not full on the base', () => {
  const full = { bin: { present: true, full: true } };
  const ok = { bin: { present: true, full: false } };
  const events = run([
    [{ cycle: 'clean', phase: 'run' }, ok],
    [{ cycle: 'clean', phase: 'run' }, full],
    [{ cycle: 'clean', phase: 'run' }, ok], // flicker on the floor
    [{ cycle: 'clean', phase: 'run' }, full],
    [{ cycle: 'none', phase: 'charge' }, full],
    [{ cycle: 'none', phase: 'charge' }, ok], // emptied, on the base: armed again
    [{ cycle: 'clean', phase: 'run' }, full],
  ]);
  assert.deepEqual(events.filter((event) => event.key === 'bin_full').length, 2);
});

test('the first state after a (re)connection fires nothing', () => {
  const memory = { binArmed: true, wentHome: false };
  const events = detectEvents(
    null,
    view({ cycle: 'clean', phase: 'stuck', error: 6 }, { bin: { full: true } }),
    memory,
  );
  assert.deepEqual(events, []);
  assert.equal(memory.binArmed, false, 'a bin already full does not fire later');
});
