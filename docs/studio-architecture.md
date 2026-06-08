# Studio Architecture Layers

The frontend architecture is enforced by three top-level layers:

- `web/src/studio_core`: editing + IK + scene logic.
- `web/src/runtime_engine`: time/session/adapters and transport contracts.
- `web/src/studio_ui`: mode bar, panels, and viewer orchestration.

## Import Rules

- `studio_core` must not import `studio_ui`.
- `runtime_engine` must not import `studio_ui`.
- `studio_ui` must consume runtime contracts via `runtime_engine` (not `runtime/viz2`).

## Compatibility Layer

Compatibility `web/src/runtime/viz2/*` modules remain thin wrappers re-exporting from `runtime_engine` and `studio_ui`.
This keeps existing imports working while preserving architectural boundaries.
