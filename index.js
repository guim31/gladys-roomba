// -----------------------------------------------------------------------------
// Entry point: the SDK client, the integration wired to it (src/app.js),
// connect, clean shutdown. No logic here.
//
// The Gladys supervisor provides GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR; the SDK reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = await createApp({ gladys });

gladys.handleShutdown(async () => {
  // Close the robot connections: the iRobot app gets its local link back.
  app.stop();
});

logger.info('iRobot Roomba integration starting');
await gladys.connect();
