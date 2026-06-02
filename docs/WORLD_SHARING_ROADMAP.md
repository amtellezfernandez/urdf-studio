# World Sharing Roadmap

## Objective

Turn URDF Studio into a robust world-sharing platform with:

- strict package standards
- deterministic validation
- trusted provenance metadata
- registry-driven discoverability
- runtime compatibility across control plane and data plane

## Live Session Sharing

The live collaboration relay is a control-plane service, not a teleoperation transport. It now uses:

- owner/editor tokens with owner-controlled lock and editor-token rotation
- token-in-fragment share URLs so room tokens are not sent in normal HTTP request URLs
- WebSocket subprotocol tokens so join credentials are not placed in WebSocket query strings
- server-issued event IDs and server receive timestamps
- client `clientSequence` replay/out-of-order rejection enforced on the backend
- owner-only room stats at `/collaboration/sessions/{session_id}/stats`, including retained history count, total accepted event count, rejected event count, and replay rejection count
- `npm run team` launcher profile that auto-selects a LAN host, enables sharing/teleop, prints operator instructions, and keeps the remote-exposure acknowledgement gate

For defense-grade deployments, the remaining hardening work is durability and authority:

- replace the in-memory session store with an append-only durable event journal
- add signed room manifests and revocation status
- add operator/team identity binding instead of bearer-token-only invites
- add multi-node relay conformance tests under packet loss, roaming clients, and congested Wi-Fi
- keep high-rate teleoperation on the Rust WebTransport/native QUIC sidecar, separate from document/session sharing

## Delivery Phases

### Phase 1: Package Standard and Validation

- [x] Define WSP manifest schema v1.0.0 (`docs/specs/WSP_manifest.schema.json`)
- [x] Define WSP specification doc (`docs/specs/WSP_v0.1.md`)
- [x] Keep scene package metadata (`WSP`) separate from model rollout contracts (`PWMP/PWMI`).
- [x] Add backend validation endpoint (`POST /worlds/packages/validate`)
- [x] Add CLI validation command (`npm run world:validate`)

Acceptance:

- Manifest validation is deterministic and returns digest + warnings/errors.

### Phase 2: Publishable Registry Control Plane

- [x] Add backend registry endpoints:
  - `POST /worlds/packages`
  - `GET /worlds/packages`
  - `GET /worlds/packages/{package_id}/versions/{version}`
- [x] Persist registry state to disk (`URDF_WORLD_REGISTRY_PATH`).
- [x] Add duplicate version conflict protection.

Acceptance:

- Published world versions are immutable and retrievable by package/version.

### Phase 3: UI Integration for Share Flows

- [x] Add `Worlds` top-menu with actions:
  - Validate Current World
  - Publish Current World
  - Export World Package
  - Import World Package
  - List Published Worlds
- [x] Build package from current scene state (URDF, joints, cameras, objects, scenario time).
- [x] Add world registry panel view (filterable table + trust/runtime columns + load action).

Acceptance:

- Users can export/import world packages directly from UI.
- Users can validate/publish without leaving the app.

### Phase 4: Runtime Hardening and Data Plane Integration

- [x] Add `world-bridge` in backend control plane.
- [x] Add Rust `worldd` world-bridge HTTP + WS APIs under current `ikd/` runtime path.
- [x] Add backend proxy mode (control plane routes high-rate paths to `worldd` by default).
- [x] Add dual-runtime conformance checks (Python fallback vs Rust data plane parity).

Acceptance:

- Same contract works with Python fallback and Rust primary runtime.

### Phase 5: Trust, Provenance, and Federation

- [ ] Add signature verification fields and status in registry responses.
- [ ] Add attestation lifecycle and SBOM metadata status.
- [ ] Add OCI artifact references and mirror metadata.
- [ ] Add verification badges in UI world listing.

Acceptance:

- Package trust state is machine-verifiable and visible in UI.

### Phase 6: Benchmark and Conformance Harness

- [ ] Build world-package conformance suite and CI gate.
- [ ] Add reproducibility report artifacts by package version.
- [ ] Add benchmark metadata model and result ingestion.

Acceptance:

- Registry entries include reproducibility and conformance signals for decision making.

## Current Priority Queue

1. Add OCI publish/pull integration for artifact refs.
2. Add signature + attestation verification worker.
