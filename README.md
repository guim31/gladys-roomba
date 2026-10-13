# iRobot Roomba for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **iRobot Roomba and Braava
robots, on the local network**: state, battery, bin, mission duration and area, Start / Pause /
Stop / Return to dock / Locate, three scene triggers and a dashboard widget. The integration talks
to each robot over its local MQTT connection (TLS, port 8883); the iRobot cloud is only used once,
if you choose, to read the robot passwords.

> **Developed without the hardware: feedback welcome.** The author has no iRobot robot. The
> protocol follows dorita980 and roombapy, and the integration is tested against a simulated robot.
> Please report what works and what does not on the Gladys forum, with the output of the
> **Diagnostic** action.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Features

- **One Gladys device per robot**, keyed on its BLID: state (stopped, running, paused, error,
  returning, charging, docked), cleaning (start or resume / stop), return to dock (pausing first
  when the robot is cleaning), pause, locate, battery, charging, bin full, mission duration and area,
  error text.
- **Two ways to get the robot password**: the iRobot account (email and password used once, never
  stored), or the HOME button of the robot. A password can also be typed by hand.
- **Discovery** of the robots on the network through the Gladys core (UDP 5678, `irobotmcs`), and a
  direct query of a robot by its IP address.
- **Scene triggers**: mission finished (completed or stopped, with duration and area), robot stuck
  or in error (with the error text, in four languages), bin full (once until emptied).
- **Dashboard widget**: live battery, state, bin, mission, error, connection, and buttons that
  follow the situation.
- **Live and quiet**: the robot pushes its changes, only the changed values reach Gladys, a 6-hour
  heartbeat, no log line at info level for a normal cycle.
- Texts in English, French, German and Spanish.

Supported robots: Wi-Fi Roomba 600, 800, 900 series, e, i, s, j series and Combo of the same
generations, Braava jet m6. The newest "Matter-first" models (Combo Max 705…) use another protocol
and are not supported.

## Requirements

- Gladys **5.2.0** or later (secret fields and defaults in action forms).
- The robot set up with the iRobot app, on the same local network as Gladys, and its IP address.

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-roomba`. On the Configuration page, run **Get the passwords from
the iRobot cloud** or **Add a robot**, then add the robots from the **Discovery** tab.

## How it works

- **Local protocol.** Each robot runs an MQTT broker on port 8883 (TLS, self-signed certificate)
  that accepts one client: the BLID as client id and username, the robot password. The robot sends
  its "shadow" (`state.reported`, JSON) in pieces; commands are published on `cmd`
  (`start`, `pause`, `resume`, `stop`, `dock`, `find`). The integration speaks this subset of
  MQTT 3.1.1 itself (`src/roomba/mqtt.js`): no `mqtt` package, a light container.
- **TLS of old firmware.** The robots offer TLS 1.2 with AES128-SHA256 and need the legacy
  renegotiation that OpenSSL 3 (Node 22 and 24) refuses by default. The robot connection enables
  `SSL_OP_LEGACY_SERVER_CONNECT`, OpenSSL's default ciphers without DH plus AES128-SHA256, at
  security level 0, and no certificate check (`src/roomba/tls.js`), as roombapy and dorita980 do.
  Checked in development against an OpenSSL server limited to TLS 1.2 / AES128-SHA256 with a
  1024-bit SHA-1 certificate; not against a robot.
- **One local client.** Only the robots added to Gladys are connected. A robot held by the iRobot
  app (or Home Assistant…) turns the integration away: shown as "busy" (transport badge and
  widget), retried every 30 s to 2 min, one warning in the log and one line when it comes back.
- **Refresh.** The robot pushes every change; an internal timer re-publishes every minute what
  changed and re-sends everything every 6 hours. The devices are published with `should_poll` and a
  valid `poll_frequency`, but the integration does not depend on Gladys polling them
  (GladysAssistant/Gladys#3198); `onPoll` is a fallback.
- **Discovery.** The container is on a bridge network: the `irobotmcs` broadcast goes through the
  Gladys core (`udp-active-broadcast` on port 5678), with a passive capture of port 5678 in parallel
  for the robots that answer to that port rather than to the sender's.
- **Storage.** `/data/robots.json` (mode 600): name, model, firmware, IP, MAC, BLID and local
  password of each robot. The iRobot account password is never stored, and no password, BLID or
  address is logged.

## Limitations

- No room cleaning: room names and maps live in the iRobot cloud, and the local map identifiers
  change when the map is edited.
- No map, position, schedule, suction or mopping settings.
- Developed and tested without a robot: how each model turns away a second local client, the
  local password method on recent firmware and some phases are taken from dorita980, roombapy and
  Home Assistant, not observed. `scripts/probe.mjs` checks a real robot (and, optionally, the cloud
  login) in read-only mode from a machine on the same network.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests, fake Gladys, simulated robot
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/app.js              handlers, start on every (re)connection
src/hub.js              robot connections, states, scene events, commands, refresh timer
src/devices.js          robot -> Gladys device and states
src/actions.js          Configuration actions (add, cloud, forget, diagnostic)
src/widgets.js          "Roomba" dashboard widget
src/store.js            /data/robots.json
src/i18n.js             texts in four languages
src/roomba/mqtt.js      minimal MQTT 3.1.1 client
src/roomba/tls.js       TLS profile of the robots
src/roomba/robot.js     one robot's connection: retries, failure classification
src/roomba/state.js     reported state -> Gladys state, mission, scene events
src/roomba/errors.js    error codes in four languages
src/roomba/discovery.js UDP 5678 discovery (through Gladys, or unicast)
src/roomba/password.js  HOME button password method
src/roomba/cloud.js     iRobot cloud login (passwords)
scripts/probe.mjs       read-only check of a real robot and of the cloud login
test/                   node --test; fake Gladys of the SDK, fake robot (MQTT over TCP)
```

`test/gladys-rules.test.js` checks every discovered device against the category/type table
extracted from the Gladys core.

Checking a real robot (from a machine on the robot's network; prints no secret):

```bash
ROOMBA_HOST=192.0.2.50 node scripts/probe.mjs                      # discovery + TLS handshake
ROOMBA_HOST=192.0.2.50 ROOMBA_BLID=... ROOMBA_PASSWORD=... node scripts/probe.mjs   # + MQTT state
IROBOT_EMAIL=... IROBOT_PASSWORD=... node scripts/probe.mjs          # cloud login only
```

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by
hand. A hand-pushed `vX.Y.Z` tag also builds the image and the GitHub Release, but then `version`
in `package.json` and in the manifest (with the `docker_image` tag) must be bumped and committed
before tagging. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [dorita980](https://github.com/koalazak/dorita980) by Facu ZAK and contributors (MIT): the local
  protocol, the MQTT client options, the TLS settings, the local and cloud password methods
  (endpoints, app id), and the full reported state used as a test fixture.
- [roombapy](https://github.com/pschmitt/roombapy) by Nick Waterton, Philipp Schmitt and
  contributors (MIT): the phases, the error code table, the TLS context, the discovery and
  password wire formats, the discovery answer used as a test fixture.
- Home Assistant's
  [`roomba`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/roomba)
  integration (Apache-2.0): the state mapping (including "stopped mid-mission is paused"), the
  pause-then-dock sequence, the Braava keys, its test fixture.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by iRobot Corporation. "iRobot",
"Roomba" and "Braava" are trademarks of iRobot Corporation.

## License

Apache-2.0, see [LICENSE](LICENSE).
