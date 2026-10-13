# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per iRobot Roomba or Braava robot, driven on the local
  network (MQTT over TLS, port 8883): state, cleaning (start or resume / stop),
  return to dock, pause, locate, battery, charging, bin full, mission duration
  and area, error text.
- Robot passwords from the iRobot account (used once, never stored) or from the
  robot's HOME button, or typed by hand; robots found on the network through
  Gladys (UDP 5678) or added by IP address.
- Scene triggers: mission finished (completed or stopped, with duration and
  area), robot stuck or in error (with the error text), bin full.
- "Roomba" dashboard widget: live battery, state, bin, mission, error,
  connection, and Start / Pause / Resume / Stop / Dock buttons.
- "Forget a robot" and "Diagnostic" actions.
- A robot held by the iRobot app is shown as busy and retried until it is free.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-roomba/commits/main
