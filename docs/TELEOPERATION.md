# Teleoperation

Teleoperation has two different jobs. Keep them separate in code, UI, security policy, and setup instructions.

1. Watch robot motion in URDF Studio.
   The robot is moved by an external stack, joystick, ROS node, autonomy process, or a person. URDF Studio only receives state frames and updates the visualization.

2. Drive the robot from a URDF Studio browser.
   The browser sends operator intent. A robot-side gateway decides whether to accept it and applies it to the robot through the real control stack.

The same laptop can run both URDF Studio and the robot gateway. In that case the robot endpoint is `127.0.0.1`. If the robot stack runs on another computer, the robot computer runs the gateway and URDF Studio connects across the LAN.

## Runtime Roles

- Studio browser: UI, visualization, optional operator input. It never owns hard safety policy.
- Studio backend: control plane for sessions, invites, auth policy, and repo/project state. It should not directly drive hardware.
- Rust teleop sidecar: low-latency relay and transport guard for WebTransport/native QUIC packets. It validates packet shape, sequence, replay, role, and session metadata.
- Robot gateway/operator-helper: robot-computer process that bridges to ROS, vendor SDKs, or the team's existing teleop stack. This is the only process that should convert accepted commands into robot actuation.
- External teleop stack: joystick/autonomy/manual control system that may publish robot state without accepting browser commands.

## Two User Modes

### Watch Robot Motion

Use this when the robot is already controlled by another stack and URDF Studio should show what is happening.

Expected flow:

1. Start URDF Studio on the Studio laptop.
2. Start the robot gateway on the robot computer in observe/mirror mode.
3. The gateway publishes joint/base/tool/camera state frames to the sidecar or backend runtime state endpoint.
4. URDF Studio renders those state frames.
5. Browser motion buttons stay disabled because the browser does not have control authority.

This mode should be the default for defense/fleet demos because it is lower risk: no browser command path is armed.

### Drive From This Browser

Use this only when the team explicitly wants browser-based teleoperation.

Expected flow:

1. Start URDF Studio.
2. Start the robot gateway on the robot computer in control-capable mode.
3. The gateway advertises robot identity, command capabilities, safety state, e-stop state, and allowed command kinds.
4. An operator requests control from the browser.
5. The gateway grants a short-lived control lease if policy allows it.
6. The browser sends operator intent, such as twist or target pose.
7. The gateway rate-limits, clamps, validates, and applies commands through the robot stack.
8. Robot state still flows back to URDF Studio as telemetry.

This mode must show who has control, what robot is targeted, when the lease expires, and how to e-stop. The sidecar being reachable is not enough to enable motion.

## Current Implementation

Current pieces already map to the intended design:

- `web/src/features/teleop/panel/OperatorTeleopPanel.tsx`: browser UI for status and optional browser control.
- `web/src/features/teleop/transport/operatorHelperApi.ts`: HTTP client for provider manifest, session, stats, and control endpoints. It fails closed when required provider routes are absent.
- `ikd/src/bin/teleop_sidecar.rs`: Rust sidecar process for fast WebTransport/native QUIC packet relay and health/stats.
- `ikd/src/teleop`: Rust packet contract, validation, sequence/replay protection, manifest, and stats.
- `web/src/features/teleop/operator-control/useNativeTeleop.ts`: current browser-to-IKD drag bridge for native IK target pushes; this is separate from follower hardware actuation.
- `tools/scripts/run.js` and `tools/scripts/runConfig.js`: start and advertise the sidecar when `--teleop` is enabled.

The important current limitation: the Rust sidecar is a relay/monitor, not a robot driver. URDF Studio no longer upgrades a sidecar `/health` response into a usable teleop session. If provider routes such as `/.well-known/urdf-studio-teleop.json`, `/session`, `/stats`, `/control/twist`, or `/control/estop` are missing, the web panel fails closed and requires an explicit teleop provider.

## OpenArm Leader/Follower Controls

OpenArm has two separate operator-side and robot-side concerns in this repo:

1. Leader Input.
   This is the operator-side input device, such as an OpenArm Mini leader arm or joystick. Leader Teleop can mirror this input in URDF Studio without a follower robot.

2. Follower Hardware.
   This is the robot-side connection to the OpenArm follower. When Follower Hardware is connected and the browser holds a lease, Leader Input moves both the Studio view and the follower through the robot gateway. When Follower Hardware is disconnected, Leader Input moves Studio only.

Drag IK is separate from Leader Teleop. Leader Teleop disables IK drag handles because the leader device owns the live joint targets in that mode.

For direct LeRobot leader-follower teleop outside the browser, LeRobot owns the actuators. URDF Studio can mirror state and render the bundled bimanual OpenArm URDF, but `lerobot-teleoperate` is the process that talks to Damiao CAN and OpenArm Mini Feetech hardware.

`npm run setup` installs the OpenArm hardware Python runtime into `.venv-lerobot`. Use the repo wrapper for real hardware bring-up so hardware identifiers stay out of git:

```bash
npm run openarm:doctor
```

The setup and repair install path includes the current LeRobot hardware pieces needed by the pasted setup: `lerobot[feetech,damiao]`, `xoq-can`, and `rerun-sdk`. The doctor command checks for LeRobot core, Damiao CAN support, Feetech Mini support, Rerun, the bimanual OpenArm follower, and the OpenArm Mini teleoperator. If the environment is damaged later, repair it with `npm run openarm:install`.

Put robot-host-only configuration in ignored env files at the repository root. Root `.env`, `.env.local`, `.env.robot.local`, and the selected `.env.robots/<robot>.env` overlay are loaded by `npm run start`, ignored by git, and must stay on the machine physically connected to the robot.

Use `.env.robot.local` only for shared local workstation defaults:

```bash
URDF_ROBOT_GATEWAY_RUNTIME_MODE=control
```

Put physical hardware identity in one file per robot. OpenArm example in `.env.robots/openarm-a.env`:

```bash
URDF_ROBOT_GATEWAY_ADAPTER=openarm_native
URDF_ROBOT_GATEWAY_ROBOT_ID=openarm-a
URDF_ROBOT_GATEWAY_OPENARM_CAN_INTERFACE=xoq
URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT=<left-xoq-or-can-channel>
URDF_ROBOT_GATEWAY_OPENARM_RIGHT_PORT=<right-xoq-or-can-channel>
URDF_ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_FILE=<openarm-a-rotation-calibration.json>
URDF_SIMULATOR_API_TOKEN=<private-operator-api-token>
```

SO100 / LeRobot example in `.env.robots/so100-left-1.env`:

```bash
URDF_ROBOT_GATEWAY_ADAPTER=lerobot
URDF_ROBOT_GATEWAY_ROBOT_ID=so100-left-1
URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE=so100_follower
URDF_ROBOT_GATEWAY_LEROBOT_PORT=<serial-port-or-hid>
URDF_ROBOT_GATEWAY_LEROBOT_ID=so100-left-1
URDF_ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR=<lerobot-calibration-dir>
URDF_SIMULATOR_API_TOKEN=<private-operator-api-token>
```

For several identical robots, create one overlay per unit, for example `.env.robots/so100-left-1.env`, `.env.robots/so100-left-2.env`, and `.env.robots/openarm-a.env`. Start each gateway with the matching `URDF_ROBOT_GATEWAY_ENV` value so ports, HIDs, XoQ channels, and calibration files cannot bleed between robots.

```bash
npm run start -- --robot openarm-a
npm run start -- --robot so100-left-1
npm run start -- --robot so100-left-2
```

When `--robot` or `--robot-env-file` is present, the launcher does not stop other URDF Studio process groups from the same checkout, and it auto-picks free web/API ports for each process. Use `npm run start -- --robot-env-file .env.robots/<robot>.env` when a process should select an explicit file path. That explicit file takes priority over a default `URDF_ROBOT_GATEWAY_ENV` selector.

The rotation calibration file is a per-robot overlay. It is not a URDF fork.
It maps hardware encoder angles into URDF joint angles and back before safety
checks or CAN targets are produced:

```json
{
  "schema_version": "urdf-studio.openarm.rotation-calibration.v1",
  "calibration_id": "openarm-unit-03-rotation-2026-04-17",
  "joints": {
    "openarm_left_joint1": {
      "direction": 1,
      "zero_offset_rad": 0.0,
      "soft_min_rad": -1.2,
      "soft_max_rad": 1.2
    }
  }
}
```

For real hardware, do not set
`URDF_ROBOT_GATEWAY_OPENARM_ALLOW_UNVALIDATED_SELF_COLLISION`. Follower motion
requires the rotation calibration file, fresh CAN feedback, self-collision
preflight, a lease, and the Follower Hardware panel's `Motion safety ready`
state.

The admin can then start the Studio session without editing code:

```bash
npm run start
```

The admin keeps these keys on the robot host. Remote operators do not receive
CAN ports, simulator tokens, relay credentials, or source edits. The admin opens
Share, creates a `Can view + teleop` or `Can edit + teleop` link, and sends that
URL. The link carries the collaboration room token plus a scoped teleop
capability; the backend verifies the capability before any REST lease or control
command reaches the robot gateway. The admin's browser can also control through
the owner token for that collaboration session.

### XoQ-backed follower sharing

XoQ is a useful transport for this setup, but treat it as robot-gateway plumbing,
not as the product-level permission model. A 64-character XoQ/Iroh CAN channel is
a remote bus endpoint id. It is not a local serial port, and it should be handled
like a hardware access credential.

The intended flow is:

1. The robot host runs the follower gateway and owns the local CAN/serial/XoQ
   configuration in `.env.robot.local`.
2. The robot gateway connects to the follower through local SocketCAN, local
   serial, or XoQ.
3. URDF Studio receives robot state through the gateway manifest and live state
   transport.
4. The admin creates a normal URDF Studio share link.
5. A guest with `Can view + teleop` or `Can edit + teleop` requests a control
   lease from the gateway.
6. The gateway validates the collaboration teleop capability, calibration,
   physical endpoint correlation, safety state, and lease ownership before
   forwarding commands to XoQ or any other low-level transport.

Do not put XoQ endpoint ids, MoQ command paths, CAN interface names, camera
serials, or simulator tokens in share URLs. Guests should receive scoped URDF
Studio capabilities only. The gateway remains the only component that knows the
raw transport ids and can convert accepted commands into hardware frames.

When debugging XoQ, remember that an endpoint returning Damiao-looking frames on
`0x11` through `0x18` is not enough proof that it is the physical robot in front
of you. The upstream package also includes a fake Damiao CAN server. Require a
positive physical correlation check before enabling motion: manually move a
known joint, verify the reported encoder delta, verify side/joint mapping, and
reject control if the endpoint behaves like a simulator, stale demo, or different
robot.

See `third_party/xoq-can/README.md` for the inspected upstream behavior and the
recommended URDF Studio integration boundary.

For direct LeRobot leader-follower bring-up, use the same private-file pattern with the LeRobot wrapper variables:

```bash
OPENARM_LEFT_FOLLOWER_PORT=<left-can-or-xoq-port>
OPENARM_RIGHT_FOLLOWER_PORT=<right-can-or-xoq-port>
OPENARM_MINI_RIGHT_PORT=<right-mini-serial-port>
OPENARM_MINI_LEFT_PORT=<left-mini-serial-port>
```

If only one OpenArm Mini leader is connected for bench tests, keep it explicit instead of duplicating the same serial path into both Mini ports:

```bash
OPENARM_SINGLE_MINI_PORT=/dev/serial/by-id/<one-openarm-mini-leader>
npm run openarm:single-mini-snapshot
```

The single-Mini snapshot command reads that one leader arm and prints a virtual bimanual mirror payload for Studio/debug tests. It does not send follower CAN frames.

Print the exact command before running it:

```bash
npm run openarm:print-command
```

Run hardware only from the robot computer, with the physical e-stop verified:

```bash
OPENARM_ALLOW_HARDWARE_RUN=I_UNDERSTAND_THIS_MOVES_HARDWARE npm run openarm:teleoperate
```

The wrapper emits this LeRobot shape:

```bash
lerobot-teleoperate \
  --robot.type=bi_openarm_follower \
  --robot.left_arm_config.port=$OPENARM_LEFT_FOLLOWER_PORT \
  --robot.left_arm_config.side=left \
  --robot.left_arm_config.max_relative_target=$OPENARM_MAX_RELATIVE_TARGET_DEG \
  --robot.right_arm_config.port=$OPENARM_RIGHT_FOLLOWER_PORT \
  --robot.right_arm_config.side=right \
  --robot.right_arm_config.max_relative_target=$OPENARM_MAX_RELATIVE_TARGET_DEG \
  --robot.id=${OPENARM_ROBOT_ID:-my_follower} \
  --teleop.type=openarm_mini \
  --teleop.id=${OPENARM_TELEOP_ID:-my_leader} \
  --teleop.port_right=$OPENARM_MINI_RIGHT_PORT \
  --teleop.port_left=$OPENARM_MINI_LEFT_PORT \
  --fps=${OPENARM_TELEOP_FPS:-60}
```

Notes from the current LeRobot OpenArm docs:

- Native OpenArm follower ports are Linux CAN interfaces such as `can0` and `can1`.
- The documented bimanual CAN leader uses `--teleop.type=bi_openarm_leader`; the Mini teleoperator uses `--teleop.type=openarm_mini` with right/left serial ports and is present in LeRobot 0.5.x.
- `lerobot-teleoperate` moves hardware but does not create a dataset. Use `lerobot-record` with the same robot and teleop arguments when the goal is camera-backed dataset recording.
- Cameras are passed through LeRobot robot camera config, for example `--robot.cameras='{...}'` or per-arm camera config. Keep camera serials private for the same reason as CAN/XoQ ports.

## Teleop Profiles

URDF Studio does not ship robot-specific teleop profiles. A provider must advertise profile metadata through `/.well-known/urdf-studio-teleop.json`, and the operator must explicitly select one of those provider-owned profiles before control can enable.

The provider owns the real topic/service mapping, velocity clamps, lease policy, deadman timeout, audit log, and robot actuation. The browser must not publish directly to ROS topics such as `/cmd_vel` in a hardware-control deployment.

The panel also shows a short local "Recent control events" list for operator feedback. Treat that as a UI trace only; the durable audit log must be written by the robot gateway because it sees the final accept/reject decision and hardware-side safety state.

## Target Repo Shape

Keep the repo organized by authority boundary:

```text
web/src/features/teleop/
  panel/                         # React UI only: mode choice, status, controls
  operator-control/              # browser intent builders, lease UI state, keyboard/gamepad mapping
  robot-mirror/                  # robot state subscriptions and Studio joint/base pose application
  transport/                     # WebTransport/native/browser HTTP clients
  contracts/                     # TS protocol types shared by panel + tests
  params/                        # UI tick rates, debounce, command limits, copy labels

backend/teleop_control/
  sessions.py                    # session manifests, invites, role policy
  leases.py                      # one active operator lease per robot/session
  audit.py                       # append-only control and e-stop decisions
  api.py                         # HTTP/WebSocket control-plane routes only

ikd/src/teleop/
  protocol.rs                    # packet schemas and validation
  hub.rs                         # relay, replay guard, stats, acks
  security.rs                    # certs, mTLS, role/session checks
  webtransport.rs                # browser datagram transport
  native_quic.rs                 # robot/native datagram transport

ikd/src/bin/
  teleop_sidecar.rs              # starts relay services; no robot-specific actuation
  robot_gateway.rs               # future robot-computer bridge to ROS/vendor SDK/external stack

docs/teleop/
  operator-guide.md              # non-expert setup: same laptop vs robot computer
  robot-gateway.md               # robot-side gateway configuration
  protocol.md                    # packet schema and command/state messages
  security.md                    # mTLS, tokens, leases, audit, network exposure
  testing.md                     # LAN latency, packet loss, replay, fail-safe tests
```

The names matter: `sidecar` means transport relay; `robot_gateway` means the process on the robot computer that can touch robot control.

## Protocol Split

Use separate message families so watch-only deployments cannot accidentally send motion:

- `robot_state`: robot -> Studio. Joint positions, base pose, tool pose, mode, estop, source timestamp, frame id, sequence.
- `operator_intent`: browser -> robot gateway. Twist, target pose, joint jog, or stop intent, always tied to a control lease.
- `control_ack`: robot gateway -> browser. Accepted/rejected, reason, applied sequence, server timestamp.
- `safety_event`: gateway/backend -> Studio. E-stop, lease revoke, robot mismatch, heartbeat timeout, policy block.
- `session_manifest`: backend/sidecar -> clients. Robot id, mode, capabilities, endpoints, cert/auth requirements.

Do not mix robot state frames and operator commands into one generic payload without a `direction`, `role`, and `command_kind` check.

## Security Rules

- Browser control is disabled until a robot gateway reports an active session and grants a lease.
- Collaboration view/edit access is separate from teleoperation. A user can have `Can view`, `Can edit`, `Can view + teleop`, or `Can edit + teleop`; the `teleop` part is a short-lived `teleop_operator` capability layered on top of the room role.
- Guest browsers must not send collaboration view/edit room tokens to the robot gateway. Guest robot-control requests include the collaboration session id plus the scoped teleop capability token. The owner's browser may send the collaboration owner token so admin teleop works without exposing backend robot credentials.
- Robot-gateway REST lease/control endpoints enforce the same teleop authorization server-side. A disabled UI is not treated as the security boundary.
- Pausing sharing or rotating collaboration room tokens revokes outstanding teleop capabilities. Re-enabling sharing does not resurrect old teleop links.
- The sidecar may relay packets but should not independently decide that a browser can command a robot.
- Browser control clients send one in-flight command at a time, attach sequence/source timestamps, and let stop commands replace queued motion.
- Native robot/client connections use mTLS outside local development.
- Robot gateways bind to loopback by default unless an explicit team/network mode is enabled.
- All control commands include session id, peer id, role, sequence, monotonic timestamp, command kind, and source timestamp.
- Every accepted command and every rejection is audit logged with reason and latency.
- Heartbeat loss forces safe hold and lease revocation.
- E-stop is always available in browser-control mode and should be accepted even when normal command authority is blocked.

## Minimal Setup Copy

For non-communications users, the product copy should say:

- "Watch robot motion" - use this when your own teleop stack moves the robot.
- "Drive from this browser" - use this when URDF Studio should send commands.
- "Status endpoint" - set this to the teleop provider URL that serves the provider manifest, session, stats, and control endpoints.
- "Provider required" - no provider manifest/session/stats route is available, so browser control stays disabled.
- "Browser control armed" - a teleop provider granted a control lease and commands can move hardware.

## Existing IK Native Mode

The IK native daemon is separate from robot teleoperation. It is for local IK/drag solving:

- HTTP: `POST /model` loads URDF and target link.
- HTTP: `POST /target` pushes IK targets.
- WS: `GET /telemetry` streams solver output.

See `docs/IKD_API.md` for full payload definitions.

## Operational Checks

1. Start Studio: `npm run start`.
2. If using fast teleop relay, start with `npm run start -- --teleop`.
3. If using the relay, verify relay health at the `live teleop relay` URL printed by `npm run start -- --teleop` plus `/health`; this does not grant teleop access.
4. For watch mode, verify robot state frames update Studio with browser control disabled.
5. For browser-control mode, set the status endpoint to the teleop provider URL and verify the provider manifest, session, and stats routes exist before controls enable.
6. Test stop and e-stop before testing any motion.
7. Confirm stale heartbeat causes safe hold.

## Troubleshooting

- "No teleop provider manifest": start or connect the teleop provider that owns the robot profile and control routes.
- "No active operator session": start or connect the robot gateway on the robot computer.
- "Loaded model and operator target differ": the URDF in Studio and the robot gateway target identity do not match; do not command until resolved.
- Native connection unstable: verify LAN, firewall, certs, and sidecar stats before using browser control.
