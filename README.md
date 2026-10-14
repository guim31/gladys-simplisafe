# SimpliSafe for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **SimpliSafe**
home security systems, through the SimpliSafe cloud: the alarm, its sensors,
the Smart Lock, the SimpliCam cameras and the Video Doorbell Pro, with the
events of the system in real time.

> **Developed without the hardware: feedback welcome.** This integration was
> written from the code and the recorded API answers of simplisafe-python, Home
> Assistant and homebridge-simplisafe3, without a SimpliSafe system or account.
> Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-simplisafe/issues).
>
> Not affiliated with SimpliSafe, Inc. SimpliSafe is a trademark of SimpliSafe,
> Inc.

## Features

- **The system** (one per base station): alarm state (disarmed, armed home,
  armed away, exit delay, entry delay, alarm), base station online, mains
  power, backup battery, alerts of the app.
- **Sensors**: entry (open/closed), motion and glass break (from alarms and
  secret alerts), smoke, CO, smoke and CO, water leak, freeze (temperature and
  alert), keypad, key fob, panic button, sirens; low battery, online, tamper.
- **Smart Lock**: lock, lock state (jammed included), lock and keypad
  batteries. Unlocking from Gladys is **off by default**.
- **Cameras and doorbells**: picture of the last motion or ring, live picture
  of the wired first-generation SimpliCam when its privacy shutter is open,
  motion, doorbell.
- **Real time**: the SimpliSafe WebSocket brings arming, alarms, delays, secret
  alerts, camera motion, the doorbell, the locks, power outages and the base
  station link at once; the integration also reads the cloud on its own timer
  (30 s to 5 min).
- **Scenes**: triggers "SimpliSafe alarm triggered" (with its kind),
  "SimpliSafe armed or disarmed" (with where from and the PIN name),
  "SimpliSafe doorbell pressed"; action "Arm or disarm SimpliSafe".
- **Dashboard widget**: state, base station, power, open entries, batteries,
  alerts, and the arming buttons the configuration allows (disarm with
  confirmation).
- **Arming from Gladys is an option, off by default**: off, arm only, or arm
  and disarm. The alarm state is never a switch: no voice assistant can change
  it.
- Four languages: English, French, German, Spanish.

## Requirements

- A SimpliSafe 3 system and its account, with **two-step verification** on.
- A computer with Chrome or Edge for the one-time sign-in.
- Gladys Assistant **5.1.0** or later.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-simplisafe`
   (or install **SimpliSafe** from the catalog once it is listed).
2. In **Configuration**, click **Connect**, sign in on the SimpliSafe page with
   the developer tools open, copy the `com.simplisafe.mobile://…?code=…`
   address of the console and paste it in **Finish the sign-in**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Sign-in**: OAuth2 authorization code with PKCE, as the SimpliSafe iOS app
  signs in (auth.simplisafe.com). SimpliSafe redirects to an address only the
  app opens, so the user pastes it in an action (the core publishes no port a
  callback could reach). The refresh token, rotated at every renewal, lives in
  `/data`.
- **Reads**: `api.simplisafe.com/v1`, the systems every 30 s to 5 min (1 min by
  default), their sensors and locks with fresh values from the base station,
  their settings every 10 min; only for the systems that have a device in
  Gladys. A 403 pauses the reads (1 min, doubled up to 2 h); no read within
  20 s of an arming when a Smart Lock is there.
- **Events**: `wss://socketlink.prd.aser.simplisafe.com`, kept alive with pings,
  reconnected with backoff and after each token renewal.
- **States**: only the changes, plus a heartbeat every 6 hours; the
  integration refreshes itself (GladysAssistant/Gladys#3198), `onPoll` is a
  fallback.

## What could not be checked

- Everything against a real account: the tests run on the recorded answers of
  simplisafe-python. `scripts/probe.mjs` checks the real cloud (sign-in page,
  refused code, refused token, WebSocket), and with a token file reads an
  account without changing anything.
- The unit of the backup battery value (believed to be millivolts).
- The live picture (`media.simplisafe.com/…/mjpg`) and the event snapshots,
  taken from homebridge-simplisafe3 and simplisafe-python.
- The source of an arming done from Gladys (believed to be "app").

## Limitations

SimpliSafe 2 systems are not supported. No live video, siren, PIN or settings
management. The newest cameras (LiveKit) only show their event pictures.
Motion and glass break sensors only show through events. Events missed while
the WebSocket reconnects do not fire their triggers.

## Development

```bash
npm install
npm test               # node --test, against the fake Gladys of the SDK and a fake cloud
npm run lint
npm run format:check
node scripts/probe.mjs # the real cloud, read-only
```

## Credits

- [bachya/simplisafe-python](https://github.com/bachya/simplisafe-python)
  (MIT, Aaron Bach): the sign-in, the endpoints, the event codes, the
  WebSocket, and the API answers used as test fixtures.
- The Home Assistant
  [`simplisafe`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/simplisafe)
  integration (Apache-2.0): state mapping, polling, what is reliable.
- [homebridge-simplisafe3](https://github.com/homebridge-simplisafe/homebridge-simplisafe3)
  (MIT): rate limits, the lock bug window, the WebSocket messages, camera
  snapshots.
- Built on [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
  from the official template.

## License

[Apache-2.0](LICENSE)
