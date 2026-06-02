# Demo Runtime Governance

## Source of truth

- Runtime behavior is implemented in `web/src` and applies to both normal and demo builds.
- The demo build is a deployment flavor, not a separate runtime implementation.

## Allowed demo-only differences

- Backend availability/feature gates.
- Demo bootstrap/autoload content.
- Host integration affordances for embedded preview mode.

## Disallowed demo-only differences

- Timeline/editor behavior and semantics.
- Constraint/velocity/joint-limit semantics.
- Playback/camera/joint synchronization semantics.

## Bridge contract ownership

- PostMessage contract constants and payload types live in:
  - `web/src/shared/contracts/previewBridge.ts`
- Consumers (including URDF Star host) must reference this contract and verify parity.
