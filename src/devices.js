// -----------------------------------------------------------------------------
// A Roomba seen from Gladys: one device per robot, keyed on its BLID.
//
// Features (external id `<device>:<code>`; codes are forever):
//   - state            vacuum-cleaner / state       <- phase, cycle, error, battery
//   - run-mode         vacuum-cleaner / run-mode    -> start or resume (1) / stop (0)
//   - dock             vacuum-cleaner / dock        -> pause if needed, then dock
//   - pause            button / push                -> pause
//   - locate           button / push                -> find (the robot plays a sound)
//   - battery          battery / integer (%)        <- batPct
//   - charging         battery / charging           <- charging on the base
//   - bin-full         input / binary               <- bin.full
//   - mission-duration duration / integer (min)     <- cleanMissionStatus.mssnM
//   - mission-area     surface / decimal (m²)       <- cleanMissionStatus.sqft
//   - error            text / text                  <- cleanMissionStatus.error, described
//
// The device is published with `should_poll` and a poll frequency Gladys
// accepts (1 min), but the container refreshes the robots itself (see
// hub.js): Gladys 5.2 does not reliably poll external devices (#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { describeError } from './roomba/errors.js';
import { RUN_MODE, VACUUM_STATE } from './roomba/state.js';
import { texts } from './i18n.js';

export const DEVICE_TYPE = 'robot';
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

export const FEATURE = {
  STATE: 'state',
  RUN_MODE: 'run-mode',
  DOCK: 'dock',
  PAUSE: 'pause',
  LOCATE: 'locate',
  BATTERY: 'battery',
  CHARGING: 'charging',
  BIN_FULL: 'bin-full',
  MISSION_DURATION: 'mission-duration',
  MISSION_AREA: 'mission-area',
  ERROR: 'error',
};

// Display bounds (the core never enforces them on writes).
const BOUNDS = {
  BATTERY: [0, 100],
  MISSION_MINUTES: [0, 1440],
  MISSION_AREA: [0, 1000],
};

/** @returns {{ device: string, feature: (code: string) => string }} */
export function idsOf(gladys, blid) {
  return gladys.externalIds(DEVICE_TYPE, blid);
}

/** The BLID of one of the integration's device external ids, or null. */
export function blidOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const blid = externalId.slice(prefix.length).split(':')[0];
  return blid || null;
}

/** The name shown for a robot: its own, or its model. */
export function robotName(robot) {
  return robot.name || (robot.sku ? `Roomba ${robot.sku}` : `Roomba ${robot.blid.slice(-4)}`);
}

/**
 * The Gladys device of a robot.
 * @param {object} gladys GladysIntegration
 * @param {object} robot a store record (blid, name, sku, ip...)
 * @param {string} language language of the feature names
 */
export function buildDevice(gladys, robot, language) {
  const t = texts(language);
  const ids = idsOf(gladys, robot.blid);
  const feature = (code, fields) => ({
    name: t.features[code],
    external_id: ids.feature(code),
    keep_history: false,
    ...fields,
  });
  const sensor = { read_only: true, has_feedback: false };
  const pushButton = {
    category: CATEGORIES.BUTTON,
    type: TYPES.BUTTON.PUSH,
    read_only: false,
    has_feedback: false,
    min: 0,
    max: 1,
  };

  return {
    name: robotName(robot),
    external_id: ids.device,
    model: robot.sku ?? undefined,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    params: robot.ip ? [{ name: 'IP_ADDRESS', value: robot.ip }] : [],
    features: [
      feature(FEATURE.STATE, {
        ...sensor,
        category: CATEGORIES.VACUUM_CLEANER,
        type: TYPES.VACUUM_CLEANER.STATE,
        keep_history: true,
        min: VACUUM_STATE.STOPPED,
        max: VACUUM_STATE.DOCKED,
      }),
      feature(FEATURE.RUN_MODE, {
        category: CATEGORIES.VACUUM_CLEANER,
        type: TYPES.VACUUM_CLEANER.RUN_MODE,
        read_only: false,
        has_feedback: true,
        min: RUN_MODE.IDLE,
        max: RUN_MODE.CLEANING,
        supported_options: [
          { value: RUN_MODE.IDLE, label: t.runModes.idle, sort_order: 0 },
          { value: RUN_MODE.CLEANING, label: t.runModes.cleaning, sort_order: 1 },
        ],
      }),
      feature(FEATURE.DOCK, {
        category: CATEGORIES.VACUUM_CLEANER,
        type: TYPES.VACUUM_CLEANER.DOCK,
        read_only: false,
        has_feedback: false,
        min: 0,
        max: 1,
      }),
      feature(FEATURE.PAUSE, pushButton),
      feature(FEATURE.LOCATE, pushButton),
      feature(FEATURE.BATTERY, {
        ...sensor,
        category: CATEGORIES.BATTERY,
        type: TYPES.BATTERY.INTEGER,
        unit: UNITS.PERCENT,
        keep_history: true,
        min: BOUNDS.BATTERY[0],
        max: BOUNDS.BATTERY[1],
      }),
      feature(FEATURE.CHARGING, {
        ...sensor,
        category: CATEGORIES.BATTERY,
        type: TYPES.BATTERY.CHARGING,
        min: 0,
        max: 1,
      }),
      feature(FEATURE.BIN_FULL, {
        ...sensor,
        category: CATEGORIES.INPUT,
        type: TYPES.INPUT.BINARY,
        keep_history: true,
        min: 0,
        max: 1,
      }),
      feature(FEATURE.MISSION_DURATION, {
        ...sensor,
        category: CATEGORIES.DURATION,
        type: TYPES.DURATION.INTEGER,
        unit: UNITS.MINUTES,
        keep_history: true,
        min: BOUNDS.MISSION_MINUTES[0],
        max: BOUNDS.MISSION_MINUTES[1],
      }),
      feature(FEATURE.MISSION_AREA, {
        ...sensor,
        category: CATEGORIES.SURFACE,
        type: TYPES.SURFACE.DECIMAL,
        unit: UNITS.SQUARE_METER,
        keep_history: true,
        min: BOUNDS.MISSION_AREA[0],
        max: BOUNDS.MISSION_AREA[1],
      }),
      feature(FEATURE.ERROR, {
        ...sensor,
        category: CATEGORIES.TEXT,
        type: TYPES.TEXT.TEXT,
        // NOT NULL in t_device_feature, even on a text feature.
        min: 0,
        max: 0,
      }),
    ],
  };
}

/**
 * The states of a robot, from interpret().
 * @param {object} gladys
 * @param {string} blid
 * @param {object} view interpret() of the reported state
 * @param {string} language language of the error text
 * @returns {Array} publishStates entries
 */
export function statesOf(gladys, blid, view, language) {
  const ids = idsOf(gladys, blid);
  const states = [];
  const number = (code, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(code), state: value });
    }
  };
  number(FEATURE.STATE, view.state);
  number(FEATURE.RUN_MODE, view.runMode);
  number(FEATURE.BATTERY, view.battery);
  number(FEATURE.CHARGING, view.charging ? 1 : 0);
  if (view.binKnown) {
    number(FEATURE.BIN_FULL, view.binFull ? 1 : 0);
  }
  number(FEATURE.MISSION_DURATION, view.minutes);
  number(FEATURE.MISSION_AREA, view.area);
  states.push({
    device_feature_external_id: ids.feature(FEATURE.ERROR),
    text: describeError(view.error, language),
  });
  return states;
}
