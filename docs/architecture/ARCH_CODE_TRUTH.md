# Architecture Code Truth (Current Behavior)

This document describes what the code actually does today.

## 1) Frontend module boundaries

- `web/src/studio_core`
  - Owns scene rendering primitives and core editing/IK facades.
  - Current 2D RosViz scene implementation:
    - `web/src/studio_core/scene/rosViz2dSceneParams.ts`
    - `web/src/studio_core/scene/rosViz2dSceneRenderer.ts`

- `web/src/runtime_engine`
  - Owns session/time/transport/protocol/state contracts.
  - RosViz runtime contracts and adapters:
    - `web/src/runtime_engine/rosviz/types.ts`
    - `web/src/runtime_engine/rosviz/api/rosVizApi.ts`
    - `web/src/runtime_engine/rosviz/protocol/rosVizProtocol.ts`
    - `web/src/runtime_engine/rosviz/transport/rosStreamClient.ts`

- `web/src/studio_ui`
  - Owns mode bar, overlays, panel composition, viewer orchestration.
  - Current RosViz UI:
    - `web/src/studio_ui/rosviz/RosVizV2Viewer.tsx`
    - `web/src/studio_ui/rosviz/components/*`
    - `web/src/studio_ui/panels/RuntimeHealthPanel.tsx`

## 2) RosViz module ownership

RosViz runtime contracts live under `runtime_engine`; RosViz UI lives under `studio_ui`.

## 3) Runtime selection behavior

- Viewer runtime selection is in:
  - `web/src/runtime_engine/rosviz/session/runtimeSelector.ts`
- UI host wiring is in:
  - `web/src/features/layout/page/ViewerHost.tsx`

Runtime can fall back from RosViz v2 to Studio 3D when:
- thumbnail mode is active,
- RosViz feature/gate is unavailable,
- WebGPU is unavailable.

## 4) Backend RosViz session model behavior

- Data contracts:
  - `backend/models/ros_viz.py`
- Runtime behavior:
  - `backend/ros_viz/runtime.py`
- API surface:
  - `backend/api/ros_viz.py`

Session state now includes explicit mode/time/transport/recording/capabilities:
- `GET /ros-viz/sessions/{id}/state`
- `POST /ros-viz/sessions/{id}/mode`
- `GET/POST /ros-viz/sessions/{id}/clock`

Clock controls are mode-gated by capabilities (for example, `live_debug` rejects pause/seek/step).

## 5) Health telemetry semantics

`RuntimeHealthPanel` reports stream/session telemetry. It is operational telemetry only.
It is not an operator safety/readiness contract.
See: `docs/health/HEALTH_VS_READINESS.md`.
