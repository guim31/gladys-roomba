// -----------------------------------------------------------------------------
// What a Roomba's reported state means, without any I/O.
//
// The robot pushes its "shadow" in pieces (`state.reported`, deep-merged
// here). The mission lives in `cleanMissionStatus`:
//   - `cycle`: the mission kind, 'none' between missions ('clean', 'spot',
//     'quick', 'dock', 'evac', 'train'...);
//   - `phase`: what the robot is doing ('charge', 'run', 'hmMidMsn' = going
//     back to recharge mid-mission, 'hmPostMsn' = going back, mission over,
//     'hmUsrDock' = sent back by the user, 'stuck', 'stop', 'pause',
//     'evac' = the Clean Base empties the bin...);
//   - `error`: 0, or the error code (see errors.js);
//   - `mssnM` / `sqft`: minutes and square feet of the current (or last)
//     mission.
// The phase list and their meaning come from roombapy (MIT) and the Home
// Assistant `roomba` integration (Apache-2.0), including its tested rule
// "stopped on the floor in the middle of a mission is paused".
// -----------------------------------------------------------------------------

// Gladys vacuum-cleaner/state values (server/utils/constants.js).
export const VACUUM_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING: 4,
  CHARGING: 5,
  DOCKED: 6,
};

// Gladys vacuum-cleaner/run-mode values. MAPPING (2) is never offered: a
// training run is started from the iRobot app only.
export const RUN_MODE = { IDLE: 0, CLEANING: 1 };

const PHASE_STATE = {
  '': VACUUM_STATE.STOPPED,
  run: VACUUM_STATE.RUNNING,
  new: VACUUM_STATE.RUNNING,
  resume: VACUUM_STATE.RUNNING,
  spot: VACUUM_STATE.RUNNING,
  train: VACUUM_STATE.RUNNING,
  pause: VACUUM_STATE.PAUSED,
  stop: VACUUM_STATE.STOPPED,
  stuck: VACUUM_STATE.ERROR,
  chargingerror: VACUUM_STATE.ERROR,
  hmMidMsn: VACUUM_STATE.RETURNING,
  hmPostMsn: VACUUM_STATE.RETURNING,
  hmUsrDock: VACUUM_STATE.RETURNING,
  dock: VACUUM_STATE.RETURNING,
  dockend: VACUUM_STATE.RETURNING,
  charge: VACUUM_STATE.CHARGING,
  recharge: VACUUM_STATE.CHARGING,
  evac: VACUUM_STATE.DOCKED,
  refill: VACUUM_STATE.DOCKED,
  completed: VACUUM_STATE.DOCKED,
};

// Phases of a robot on the floor that may be resumed or sent home.
const MISSION_PHASES = new Set(['run', 'new', 'resume', 'spot', 'train', 'hmMidMsn']);

const SQUARE_FOOT_IN_SQUARE_METERS = 0.09290304;

/** Deep merge of a reported delta into the accumulated state (in place). */
export function mergeReported(target, delta) {
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      mergeReported(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/**
 * The `state.reported` object of an MQTT payload, or null.
 * @param {Buffer|string} payload
 */
export function reportedOf(payload) {
  try {
    const message = JSON.parse(payload.toString());
    const reported = message?.state?.reported;
    return reported && typeof reported === 'object' && !Array.isArray(reported) ? reported : null;
  } catch {
    return null;
  }
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Everything the integration reads from the reported state.
 * @param {object} reported the accumulated `state.reported`
 * @returns {object|null} null until the robot said what it is doing
 */
export function interpret(reported) {
  const mission = reported?.cleanMissionStatus;
  if (!mission || typeof mission !== 'object') {
    return null;
  }
  const phase = typeof mission.phase === 'string' ? mission.phase : '';
  const cycle = typeof mission.cycle === 'string' ? mission.cycle : 'none';
  const error = finite(mission.error) ?? 0;
  const battery = finite(reported.batPct);
  const inMission = cycle !== 'none' && cycle !== '';

  let state = PHASE_STATE[phase] ?? VACUUM_STATE.STOPPED;
  if (phase === 'stop' && inMission) {
    // Home Assistant: stopped in the middle of a mission is a pause.
    state = VACUUM_STATE.PAUSED;
  }
  if (state === VACUUM_STATE.CHARGING && battery !== null && battery >= 100) {
    state = VACUUM_STATE.DOCKED;
  }
  if (error !== 0 && (phase === 'stop' || phase === 'pause' || phase === '')) {
    // Stopped by a fault: the robot waits for someone.
    state = VACUUM_STATE.ERROR;
  }

  const minutes = finite(mission.mssnM);
  const squareFeet = finite(mission.sqft);
  const bin = reported.bin && typeof reported.bin === 'object' ? reported.bin : {};

  return {
    phase,
    cycle,
    state,
    inMission,
    // A mission is running unless it waits for the user (pause, stop, fault).
    runMode:
      inMission && (MISSION_PHASES.has(phase) || phase === 'charge')
        ? RUN_MODE.CLEANING
        : RUN_MODE.IDLE,
    paused: state === VACUUM_STATE.PAUSED,
    onFloor: MISSION_PHASES.has(phase),
    charging: state === VACUUM_STATE.CHARGING,
    docked: phase === 'charge' || phase === 'evac' || phase === 'refill',
    error,
    inError: phase === 'stuck' || state === VACUUM_STATE.ERROR,
    battery,
    binFull: bin.full === true,
    binKnown: typeof bin.full === 'boolean',
    minutes,
    area:
      squareFeet === null ? null : Math.round(squareFeet * SQUARE_FOOT_IN_SQUARE_METERS * 10) / 10,
    initiator: typeof mission.initiator === 'string' ? mission.initiator : null,
  };
}

/**
 * The scene events of a transition between two interpretations.
 *
 * - `mission_finished`: a mission ended (cycle back to 'none') without the
 *   robot being stuck. `outcome` is 'completed' when the robot went home by
 *   itself ('hmPostMsn' seen during the mission), 'stopped' otherwise
 *   (stopped or sent home by someone).
 * - `robot_error`: the robot entered a fault, or switched to another fault.
 * - `bin_full`: the bin became full, once until it is seen not full on the
 *   dock again (the sensor may flicker while cleaning; see `binArmed`).
 *
 * @param {object|null} previous interpret() before, null after a (re)connection
 * @param {object} next interpret() now
 * @param {{ binArmed: boolean, wentHome: boolean }} memory per robot,
 *   updated in place
 * @returns {Array<{ key: string, data: object }>}
 */
export function detectEvents(previous, next, memory) {
  const events = [];
  if (next.inMission && next.phase === 'hmPostMsn') {
    memory.wentHome = true;
  }
  if (!next.binFull && (next.docked || !next.binKnown)) {
    memory.binArmed = true;
  }
  if (!previous) {
    if (next.binFull) memory.binArmed = false;
    return events;
  }

  if (previous.inMission && !next.inMission && !next.inError) {
    events.push({
      key: 'mission_finished',
      data: {
        outcome: memory.wentHome || next.phase === 'hmPostMsn' ? 'completed' : 'stopped',
        duration_minutes: next.minutes ?? previous.minutes,
        area_m2: next.area ?? previous.area,
      },
    });
  }
  if (!next.inMission) {
    memory.wentHome = false;
  }

  if (next.inError && (!previous.inError || (next.error !== previous.error && next.error !== 0))) {
    events.push({ key: 'robot_error', data: { error_code: next.error } });
  }

  if (next.binFull && memory.binArmed) {
    memory.binArmed = false;
    events.push({ key: 'bin_full', data: {} });
  }
  return events;
}
