// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client: handlers registered before
// connect(), started on every (re)connection. index.js passes the real SDK
// client; the tests pass the SDK's fake Gladys and a fake robot.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { createActions } from './actions.js';
import { normalizeConfig } from './config.js';
import { WIDGET_KEY, createHub } from './hub.js';
import { RobotStore } from './store.js';
import { createRobotWidget } from './widgets.js';

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {string} [options.dataDir] the writable volume (/data)
 * @param {Function} [options.open] robot socket opener (tests)
 * @param {object} [options.deps] network functions of the actions (tests)
 * @param {boolean} [options.timers] run the refresh timer (tests may turn it off)
 * @param {object} [options.logger]
 */
export async function createApp({
  gladys,
  dataDir = process.env.DATA_DIR || '/data',
  open,
  deps,
  timers = true,
  logger = createLogger({ name: 'roomba' }),
}) {
  const store = await new RobotStore(dataDir).load();
  let config = normalizeConfig(gladys.config);
  const hub = createHub({ gladys, store, getConfig: () => config, open, timers, logger });
  const actions = createActions({ gladys, store, hub, deps, logger });
  const widget = createRobotWidget({ gladys, store, hub });

  gladys.onScanRequest(async () => {
    try {
      await hub.rescan();
    } catch (error) {
      logger.debug(`Network scan failed (${error.message})`);
    }
    await hub.publishDevices();
  });
  gladys.onSetValue((device, feature, value) => hub.setValue(device, feature, value));
  gladys.onPoll((device) => hub.pollFromCore(device));
  gladys.onDeviceCreated((device) => hub.deviceChanged(device));
  gladys.onDeviceUpdated((device) => hub.deviceChanged(device));
  gladys.onDeviceDeleted(() => hub.deviceDeleted());
  gladys.onConfigUpdated(async (raw) => {
    const next = normalizeConfig(raw);
    const languageChanged = next.language !== config.language;
    config = next;
    if (languageChanged) {
      // Error texts are in the configured language: send them again.
      gladys.forgetPublishedStates();
      await hub.publishDevices();
      for (const blid of hub.robots.keys()) await hub.refresh(blid);
    }
  });
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, (fields) => handler(fields ?? {}));
  }
  gladys.onWidgetGet(WIDGET_KEY, (request) => widget.get(request));
  gladys.onWidgetAction(WIDGET_KEY, (actionKey, params, context) =>
    widget.action(actionKey, params, context ?? {}),
  );

  // Every (re)connection: the SDK has refreshed gladys.devices and the config.
  gladys.on('connected', async () => {
    config = normalizeConfig(gladys.config);
    try {
      await hub.start();
    } catch (error) {
      logger.error(`Start failed (${error.message})`);
    }
  });

  return { store, hub, actions, widget, stop: () => hub.stop() };
}
