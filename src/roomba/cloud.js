// -----------------------------------------------------------------------------
// The robot credentials, read once from the iRobot cloud.
//
// The iRobot app account knows, for each robot, its BLID and its local MQTT
// password. Three requests, as dorita980's `get-roomba-password-cloud` does
// (MIT, Facu ZAK and contributors; endpoints and app id from it):
//   1. GET  disc-prod.iot.irobotapi.com/v1/discover/endpoints?country_code=XX
//      → the Gigya API key and data center, the iRobot HTTP base;
//   2. POST accounts.<data center>/accounts.login (Gigya, form encoded)
//      → UID, UIDSignature, signatureTimestamp;
//   3. POST <http base>/v2/login with that Gigya signature
//      → { robots: { <BLID>: { name, sku, softwareVer, password, ... } } }.
// The account password is only sent there and never stored; the robot
// passwords it returns are kept in /data like the ones read locally.
// -----------------------------------------------------------------------------

export const DISCOVERY_URL = 'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints';
const APP_ID = 'ANDROID-C7FB240E-DF34-42D7-AE4E-A8C17079A294';
const DEFAULT_HTTP_BASE = 'https://unauth2.prod.iot.irobotapi.com';
const TIMEOUT_MS = 15000;

/** A failure of the cloud login, with a `reason` the action translates. */
export class CloudError extends Error {
  /** @param {'credentials'|'network'|'unexpected'|'no_robot'} reason */
  constructor(reason, message) {
    super(message);
    this.name = 'CloudError';
    this.reason = reason;
  }
}

async function call(fetchFn, url, init, step) {
  let response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new CloudError('network', `${step}: ${error.message}`);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON answer: handled below with the status.
  }
  return { status: response.status, body };
}

function pickHttpBase(deployments) {
  for (const key of Object.keys(deployments ?? {})
    .sort()
    .reverse()) {
    if (deployments[key]?.httpBase) {
      return deployments[key].httpBase;
    }
  }
  return null;
}

/**
 * Log in and list the robots of the account.
 * @param {object} options
 * @param {string} options.email
 * @param {string} options.password
 * @param {string} [options.country] two-letter country code of the account
 * @param {typeof fetch} [options.fetch]
 * @returns {Promise<Array<{ blid, password, name, sku, firmware }>>}
 */
export async function fetchCloudRobots({
  email,
  password,
  country = 'FR',
  fetch: fetchFn = fetch,
}) {
  const code = /^[A-Za-z]{2}$/.test(String(country ?? '').trim())
    ? String(country).trim().toUpperCase()
    : 'FR';

  const discovery = await call(
    fetchFn,
    `${DISCOVERY_URL}?country_code=${code}`,
    { method: 'GET' },
    'endpoint discovery',
  );
  const apiKey = discovery.body?.gigya?.api_key;
  if (discovery.status >= 400 || !apiKey) {
    throw new CloudError('unexpected', `endpoint discovery answered ${discovery.status}`);
  }
  const dataCenter = discovery.body.gigya.datacenter_domain;
  const gigyaBase = dataCenter
    ? `https://accounts.${dataCenter}`
    : 'https://accounts.us1.gigya.com';
  const httpBase =
    pickHttpBase(discovery.body.deployments) || discovery.body.httpBase || DEFAULT_HTTP_BASE;

  const login = await call(
    fetchFn,
    `${gigyaBase}/accounts.login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apiKey,
        targetenv: 'mobile',
        loginID: email,
        password,
        format: 'json',
        targetEnv: 'mobile',
      }).toString(),
    },
    'account login',
  );
  const gigya = login.body ?? {};
  if (
    login.status === 401 ||
    login.status === 403 ||
    gigya.statusCode === 403 ||
    gigya.errorCode === 403042
  ) {
    throw new CloudError('credentials', 'the iRobot account refused the email or the password');
  }
  if (gigya.errorCode !== 0 || !gigya.UID || !gigya.UIDSignature || !gigya.signatureTimestamp) {
    throw new CloudError(
      'unexpected',
      `account login answered ${login.status} (error ${gigya.errorCode ?? '?'})`,
    );
  }

  const robots = await call(
    fetchFn,
    `${httpBase}/v2/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: APP_ID,
        assume_robot_ownership: 0,
        gigya: {
          signature: gigya.UIDSignature,
          timestamp: gigya.signatureTimestamp,
          uid: gigya.UID,
        },
      }),
    },
    'iRobot login',
  );
  if (robots.status >= 400 || !robots.body || typeof robots.body.robots !== 'object') {
    throw new CloudError('unexpected', `iRobot login answered ${robots.status}`);
  }
  const list = Object.entries(robots.body.robots ?? {})
    .filter(([, robot]) => robot && typeof robot.password === 'string' && robot.password)
    .map(([blid, robot]) => ({
      blid,
      password: robot.password,
      name: typeof robot.name === 'string' && robot.name.trim() ? robot.name.trim() : null,
      sku: typeof robot.sku === 'string' ? robot.sku : null,
      firmware: typeof robot.softwareVer === 'string' ? robot.softwareVer : null,
    }));
  if (list.length === 0) {
    throw new CloudError('no_robot', 'the iRobot account has no robot');
  }
  return list;
}
