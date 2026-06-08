# Studio Architecture Layers

The frontend architecture is enforced by three top-level layers:

- `web/src/studio_core`: editing + IK + scene logic.
- `web/src/runtime_engine`: time/session/adapters and transport contracts.
- `web/src/studio_ui`: mode bar, panels, and viewer orchestration.

## Import Rules

- `studio_core` must not import `studio_ui`.
- `runtime_engine` must not import `studio_ui`.
- `studio_ui` must consume runtime contracts via `runtime_engine`.

## RosViz Module Ownership

Use `runtime_engine` for runtime contracts and `studio_ui` for viewer composition.
