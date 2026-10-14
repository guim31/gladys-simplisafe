# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, codes and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- **Secrets**: no password ever reaches the integration: the user signs in on
  the SimpliSafe page. The integration keeps the **refresh token** of the
  account (SimpliSafe rotates it at every renewal) and its user id in `/data`;
  the access token (one hour) stays in memory. Tokens, the sign-in code and its
  PKCE verifier are never written to the logs nor to the Gladys configuration.
- **`/data`**: one file, `simplisafe-state.json`, mode 0600, written atomically:
  the refresh token and user id, the PKCE verifier of a sign-in in progress, a
  random device id for the sign-in page, and the cameras seen ringing. Whoever
  reads this file can use the SimpliSafe account (read the alarm, and arm,
  disarm or unlock it through the API) until "Sign out", a password change or
  the token is revoked.
- **Network**: HTTPS and WSS to the SimpliSafe cloud only (`auth.simplisafe.com`,
  `api.simplisafe.com`, `socketlink.prd.aser.simplisafe.com`, the camera media
  servers under `simplisafe.com`). The bearer token is sent to no other host:
  a picture address of an event that points elsewhere is not fetched.
- **Commands**: arming and disarming from Gladys are off by default, and so is
  unlocking the Smart Lock; the alarm state is read-only, so no voice
  assistant or generic device command can change it.
- **Camera images** stay in memory and go to Gladys only.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the SimpliSafe cloud, apps, firmware and devices (report those to SimpliSafe).
