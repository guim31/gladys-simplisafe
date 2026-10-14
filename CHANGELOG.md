# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- Sign-in to the SimpliSafe account from the Configuration screen: "Connect"
  opens the SimpliSafe page, "Finish the sign-in" takes the address copied from
  the browser. "Test the connection" and "Sign out" actions.
- One device per SimpliSafe 3 system: alarm state (disarmed, armed home, armed
  away, exit delay, entry delay, alarm), base station online, mains power,
  backup battery, alerts.
- One device per sensor: entry, motion, glass break, smoke, CO, smoke and CO,
  water, freeze (temperature and alert), keypad, key fob, panic button, sirens,
  with low battery, online and tamper.
- Smart Lock: lock, lock state, lock and keypad batteries, online. Unlocking
  from Gladys is an option, off by default.
- Cameras and Video Doorbell: picture of the last motion or ring, live picture
  of the wired first-generation SimpliCam when its privacy shutter is open,
  motion, doorbell.
- Real-time events through the SimpliSafe WebSocket, and reads of the cloud on
  the integration's own timer (30 s to 5 min, 1 min by default).
- Scene triggers "SimpliSafe alarm triggered", "SimpliSafe armed or disarmed"
  and "SimpliSafe doorbell pressed"; scene action "Arm or disarm SimpliSafe".
- The "SimpliSafe alarm" dashboard widget, with the arming buttons the
  configuration allows.
- "Arming from Gladys": off (default), arm only, or arm and disarm.
- English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-simplisafe/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-simplisafe/releases/tag/v1.0.1
