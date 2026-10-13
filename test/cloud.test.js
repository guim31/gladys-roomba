// -----------------------------------------------------------------------------
// The iRobot cloud login (dorita980's flow), against a fake fetch: endpoint
// discovery, Gigya login, iRobot login, and the failures a user can meet.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudError, fetchCloudRobots } from '../src/roomba/cloud.js';

const ROBOTS = {
  '3115C00000000001': {
    password: ':1:1486937829:EXAMPLEpassword0',
    name: 'Dorita',
    sku: 'R98----',
    softwareVer: 'v2.4.16-126',
  },
  '7C4E000000000002': { password: 'EXAMPLEpassword2', name: 'Kitchen', sku: 'i755840' },
  NOPASSWORD000: { name: 'Mower' },
};

function fakeCloud({ gigya = {}, robots = ROBOTS, discovery = {}, fail } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (fail === url.split('?')[0]) throw new Error('getaddrinfo ENOTFOUND');
    const json = (body, status = 200) => ({ status, json: async () => body });
    if (url.startsWith('https://disc-prod.iot.irobotapi.com/v1/discover/endpoints')) {
      return json({
        gigya: { api_key: 'EXAMPLE_API_KEY', datacenter_domain: 'eu1.gigya.com' },
        deployments: { v005: { httpBase: 'https://unauth5.example.irobotapi.com' } },
        ...discovery,
      });
    }
    if (url === 'https://accounts.eu1.gigya.com/accounts.login') {
      return json({
        statusCode: 200,
        errorCode: 0,
        UID: 'uid',
        UIDSignature: 'sig',
        signatureTimestamp: '1700000000',
        sessionInfo: { sessionToken: 'token' },
        ...gigya,
      });
    }
    if (url === 'https://unauth5.example.irobotapi.com/v2/login') {
      return json({ robots });
    }
    return json({}, 404);
  };
  return { fetch, calls };
}

test('the account robots, with their BLID and local password', async () => {
  const cloud = fakeCloud();
  const robots = await fetchCloudRobots({
    email: 'name@example.com',
    password: 'account-secret',
    country: 'fr',
    fetch: cloud.fetch,
  });
  assert.deepEqual(robots, [
    {
      blid: '3115C00000000001',
      password: ':1:1486937829:EXAMPLEpassword0',
      name: 'Dorita',
      sku: 'R98----',
      firmware: 'v2.4.16-126',
    },
    {
      blid: '7C4E000000000002',
      password: 'EXAMPLEpassword2',
      name: 'Kitchen',
      sku: 'i755840',
      firmware: null,
    },
  ]);
  assert.match(cloud.calls[0].url, /country_code=FR$/);
  const login = new URLSearchParams(cloud.calls[1].init.body);
  assert.equal(login.get('loginID'), 'name@example.com');
  assert.equal(login.get('apiKey'), 'EXAMPLE_API_KEY');
  const irobot = JSON.parse(cloud.calls[2].init.body);
  assert.deepEqual(irobot.gigya, { signature: 'sig', timestamp: '1700000000', uid: 'uid' });
  assert.ok(
    !cloud.calls[2].init.body.includes('account-secret'),
    'the password goes to Gigya only',
  );
});

test('a wrong email or password is a credentials error', async () => {
  const cloud = fakeCloud({ gigya: { statusCode: 403, errorCode: 403042, UID: undefined } });
  await assert.rejects(
    fetchCloudRobots({ email: 'a', password: 'b', fetch: cloud.fetch }),
    (error) => error instanceof CloudError && error.reason === 'credentials',
  );
});

test('a network failure, an unexpected answer and an empty account are told apart', async () => {
  await assert.rejects(
    fetchCloudRobots({
      email: 'a',
      password: 'b',
      fetch: fakeCloud({ fail: 'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints' }).fetch,
    }),
    (error) => error.reason === 'network',
  );
  await assert.rejects(
    fetchCloudRobots({
      email: 'a',
      password: 'b',
      fetch: fakeCloud({ discovery: { gigya: {} } }).fetch,
    }),
    (error) => error.reason === 'unexpected',
  );
  await assert.rejects(
    fetchCloudRobots({ email: 'a', password: 'b', fetch: fakeCloud({ robots: {} }).fetch }),
    (error) => error.reason === 'no_robot',
  );
});

test('an invalid country falls back to FR', async () => {
  const cloud = fakeCloud();
  await fetchCloudRobots({ email: 'a', password: 'b', country: 'France', fetch: cloud.fetch });
  assert.match(cloud.calls[0].url, /country_code=FR$/);
});
