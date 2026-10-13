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
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored in `/data/robots.json`** (the container's only writable volume,
  file mode 600): for each robot, its name, model, firmware, IP and MAC
  address, BLID and **local MQTT password**. The password is needed at every
  connection, so it is stored as is.
- **Never stored**: the iRobot account email and password, typed in the
  "Get the passwords from the iRobot cloud" action and sent only to the iRobot
  login service (Gigya, then iRobot), once.
- **Never logged**: passwords, BLIDs, IP or MAC addresses (socket errors are
  logged with the address masked). The Diagnostic action contains none of them.
- **Network**: MQTT over TLS to each robot on the local network (port 8883).
  The robot's certificate is self-signed and is not verified, and the TLS
  settings accept the robots' legacy parameters (legacy renegotiation,
  AES128-SHA256, security level 0) for that connection only. UDP 5678 for
  discovery (broadcast through the Gladys core, unicast to a typed address).
  HTTPS to the iRobot cloud only when the cloud action runs.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the robots' firmware, the iRobot cloud and app.
