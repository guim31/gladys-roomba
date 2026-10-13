// -----------------------------------------------------------------------------
// The "Roomba" dashboard widget: one robot, its state at a glance and the two
// buttons used every day.
//
//   - a live battery tile (bound to the battery feature: follows the states
//     without any widget refresh);
//   - one status list: state, bin, current or last mission, error (when
//     there is one), connection (when the robot is not connected);
//   - buttons by situation: Start + Dock at rest, Pause + Dock while
//     cleaning, Resume + Stop + Dock when paused.
// Budget of the core: 8 components, 1 status, 4 buttons at most. No button in
// the `primary` style: it does not show in dark mode (Gladys#3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { describeError } from './roomba/errors.js';
import { STATUS } from './roomba/robot.js';
import { VACUUM_STATE } from './roomba/state.js';
import { FEATURE, blidOf, idsOf } from './devices.js';
import { allLanguages, texts } from './i18n.js';
import { pickLanguage } from './config.js';

export const WIDGET_ACTIONS = ['start', 'pause', 'resume', 'stop', 'dock'];

const STATE_COLORS = {
  [VACUUM_STATE.STOPPED]: WIDGET_COLORS.NEUTRAL,
  [VACUUM_STATE.RUNNING]: WIDGET_COLORS.SUCCESS,
  [VACUUM_STATE.PAUSED]: WIDGET_COLORS.WARNING,
  [VACUUM_STATE.ERROR]: WIDGET_COLORS.DANGER,
  [VACUUM_STATE.RETURNING]: WIDGET_COLORS.INFO,
  [VACUUM_STATE.CHARGING]: WIDGET_COLORS.INFO,
  [VACUUM_STATE.DOCKED]: WIDGET_COLORS.NEUTRAL,
};

const ICONS = { start: 'play', pause: 'pause', resume: 'play', stop: 'square', dock: 'home' };

function formatNumber(value, language) {
  return new Intl.NumberFormat({ fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-GB', {
    maximumFractionDigits: 1,
  }).format(value);
}

const fit = (text, shorter) => (text.length <= 40 ? text : shorter.slice(0, 40));

/** "12 min · 8.5 m²", or null when the robot reports neither. */
export function missionText(view, language) {
  const parts = [];
  if (view.minutes !== null) parts.push(`${formatNumber(view.minutes, language)} min`);
  if (view.area !== null && view.area > 0) parts.push(`${formatNumber(view.area, language)} m²`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The buttons for the robot's situation. */
export function buttonsFor(view) {
  if (!view) return [];
  if (view.paused) return ['resume', 'stop', 'dock'];
  if (view.runMode === 1 && view.onFloor) return ['pause', 'dock'];
  if (view.runMode === 1) return ['pause', 'stop'];
  return view.docked ? ['start'] : ['start', 'dock'];
}

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {import('./store.js').RobotStore} options.store
 * @param {ReturnType<import('./hub.js').createHub>} options.hub
 */
export function createRobotWidget({ gladys, store, hub }) {
  return {
    async get({ settings, language }) {
      const lang = pickLanguage(language);
      const t = texts(lang);
      const blid = blidOf(gladys, settings?.robot);
      if (!blid) {
        return { ttl_seconds: 300, components: [{ type: 'text', text: t.widget.pickRobot }] };
      }
      const record = store.get(blid);
      if (!record) {
        return { ttl_seconds: 300, components: [{ type: 'text', text: t.widget.unknownRobot }] };
      }
      const ids = idsOf(gladys, blid);
      const status = hub.statusOf(blid);
      const view = hub.viewOf(blid);
      const items = [];

      if (view) {
        items.push({
          label: t.widget.state,
          value: t.states[view.state] ?? t.states[0],
          color: STATE_COLORS[view.state] ?? WIDGET_COLORS.NEUTRAL,
        });
        if (view.binKnown) {
          items.push({
            label: t.widget.bin,
            value: view.binFull ? t.widget.binFull : t.widget.binOk,
            color: view.binFull ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
            icon: 'trash-2',
          });
        }
        const mission = missionText(view, lang);
        if (mission) {
          items.push({
            label: view.inMission ? t.widget.mission : t.widget.lastMission,
            value: mission,
            icon: 'clock',
          });
        }
        if (view.error !== 0) {
          items.push({
            label: t.widget.error,
            // A status value holds 40 characters: the code goes first.
            value: fit(
              describeError(view.error, lang),
              describeError(view.error, lang, { withCode: false }),
            ),
            color: WIDGET_COLORS.DANGER,
            icon: 'alert-triangle',
          });
        }
      }
      if (status !== STATUS.CONNECTED) {
        items.push({
          label: t.widget.connection,
          value: t.status[status] ?? t.status.stopped,
          color: status === STATUS.AUTH ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
          icon: 'wifi-off',
        });
      }

      const components = [
        { type: 'value', label: t.widget.battery, device_feature: ids.feature(FEATURE.BATTERY) },
      ];
      if (items.length > 0) {
        components.push({ type: 'status', items });
      }
      if (status === STATUS.CONNECTED) {
        for (const action of buttonsFor(view)) {
          components.push({
            type: 'button',
            label: t.widget[action],
            icon: ICONS[action],
            action: { key: action },
          });
        }
      }
      return { ttl_seconds: 60, components };
    },

    async action(actionKey, _params, { settings }) {
      const blid = blidOf(gladys, settings?.robot);
      if (!blid || !store.get(blid) || !WIDGET_ACTIONS.includes(actionKey)) {
        throw new Error(texts(hub.language()).widget.unknownRobot);
      }
      if (hub.statusOf(blid) !== STATUS.CONNECTED) {
        throw new Error(texts(hub.language()).toast.notConnected);
      }
      await hub.command(blid, actionKey, 'widget');
      return allLanguages((table) => table.toast[actionKey]);
    },
  };
}
