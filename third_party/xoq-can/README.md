# xoq-can / XoQ

Reference only. This directory does not vendor or redistribute upstream source code.

## Upstream

- Package: https://pypi.org/project/xoq-can/
- Observed version: `xoq-can==0.3.6`
- Observed on: April 18, 2026
- Source artifact inspected: PyPI source distribution `xoq_can-0.3.6.tar.gz`
- License declared by package metadata: Apache-2.0
- Purpose upstream: drop-in `python-can` replacement for remote CAN buses over XoQ/Iroh P2P, with optional MoQ relay paths for browser-oriented fanout.

## Why It Is Here

XoQ is directly relevant to URDF Studio's robot gateway model:

- a robot host can bridge local SocketCAN, serial, camera, and audio devices to network clients
- a remote client can address a CAN server with a 64-character Iroh endpoint id
- Python clients using `can.Bus(...)` can be transparently routed to the remote bus through the `xoq-can` import hook
- MoQ paths can publish state and accept command streams through a relay

This is the right shape for "I have hardware connected here, send a share link and let a remote operator use it" as long as URDF Studio keeps leases, identity, calibration, and safety policy outside the raw transport.

## What The Package Does

From the inspected `xoq-can` package:

- `xoq_can_hook.pth` installs an import hook that patches `import can`.
- `can.Bus(channel=...)` is treated as remote when the channel is a 64-character lowercase hex string, a path containing `/`, or an `http(s)://...` MoQ URL.
- 64-character hex channels are Iroh endpoint ids, not local `/dev` paths.
- MoQ channels use relay plus path semantics and split command/state tracks.
- The CAN server opens Linux SocketCAN interfaces such as `can0` or `can0:fd`, then bridges frames over Iroh/MoQ.
- The source also ships `fake-can-server`, which simulates 8 Damiao motors and replies on `0x11` through `0x18`.

That last point is operationally important: valid Damiao-looking CAN replies prove an XoQ endpoint is alive, but they do not prove the endpoint is the physical robot being observed.

## Why It Is Not Vendored Here

- URDF Studio should not couple its core robot gateway to a third-party implementation detail or PyPI import hook.
- `xoq-can` is a low-level transport. URDF Studio needs a higher-level authority boundary: robot identity, calibration profile, control lease, capability token, audit log, stale heartbeat handling, and safety state.
- Raw CAN endpoint ids are sensitive robot access material. They should stay on the robot host or backend runtime, not inside shared URLs, frontend bundles, recordings, or committed config.
- The upstream source distribution includes multiple servers and examples beyond the narrow CAN bridge path; copying it into this repo would create update and security-review burden without improving the product contract.

## Useful Ideas To Reuse Internally

### 1. Transport Adapter Boundary

Model XoQ as a robot-gateway transport adapter, not as a UI feature:

- local SocketCAN or serial stays on the robot host
- XoQ endpoint ids stay in `.env.robot.local` or another private robot-host config
- URDF Studio talks to its own robot gateway contract
- browser guests receive scoped teleop capabilities, not raw CAN or XoQ ids

### 2. Share Flow For Connected Hardware

The safe product flow should be:

1. Admin connects follower hardware to the robot host.
2. Admin starts URDF Studio plus the robot gateway on that host.
3. The gateway uses local CAN, local serial, or XoQ endpoint ids from private config.
4. The gateway advertises a URDF Studio manifest with robot id, capabilities, calibration id, and live state endpoints.
5. Admin creates a share link with optional teleop capability.
6. Guest opens the share link and requests a control lease.
7. The gateway validates the lease/capability before any command reaches the transport.

The guest never needs to see a CAN interface, serial path, Iroh endpoint id, MoQ command path, or simulator token.

### 3. Endpoint Correlation Check

Before enabling real hardware motion through an XoQ-backed bus, require a positive physical correlation check:

- query state from the selected endpoint
- ask the admin to manually move one known joint or trigger a read-only identity check
- verify the reported encoder change maps to the expected URDF joint and physical side
- reject control if the endpoint behaves like `fake-can-server`, a stale demo, or a different robot

### 4. Capability-Aware State Fanout

XoQ's split between state and command tracks maps cleanly to URDF Studio:

- state fanout can be watch-only and shareable
- command publishing requires a current lease and teleop capability
- command paths should be backend/gateway-owned, not directly embedded in the browser when hardware is armed

## Recommended Integration Direction For This Repo

Use XoQ inside `backend/robot_gateway` only behind native URDF Studio contracts:

- `RobotGatewayAdapter` owns robot-specific mapping, calibration, and safety checks.
- A future `XoqTransportDescriptor` can describe endpoint kind, relay, path, and physical correlation status.
- The UI should show "remote CAN via XoQ" as an implementation detail in diagnostics, not as the user-facing control model.
- Share links should include collaboration room and teleop capability data only.

## Existing Repo Touchpoints

- Robot gateway contract: `backend/models/robot_gateway.py`
- Robot gateway runtime: `backend/robot_gateway/runtime.py`
- OpenArm CAN transport: `backend/robot_gateway/openarm_can_transport.py`
- Teleoperation docs: `docs/TELEOPERATION.md`
- OpenArm hardware wrapper: `tools/scripts/openArmHardware.js`

## Follow-up Candidate

Implement a native XoQ-aware transport descriptor with:

- endpoint-id validation for Iroh channels
- MoQ relay/path validation
- explicit local vs remote transport labels
- correlation state in the gateway manifest
- tests that distinguish real endpoint ids from fake/simulated Damiao replies
