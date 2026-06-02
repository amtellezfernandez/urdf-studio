# Architecture Defaults (Code-True)

Each default is intentional. If changed, document why and expected behavior impact.

## Frontend RosViz defaults

- `fixed_frame`: `world`
- deterministic mode request: `strict`
- initial clock mode local state: `live`
- initial source local state: `live_ros`
- playback rate cycle: `[0.5, 1, 2, 4]`
- 2D scene default zoom: `96 px/m`

Primary paths:
- `web/src/studio_ui/rosviz/RosVizV2Viewer.tsx`
- `web/src/studio_core/scene/rosViz2dSceneParams.ts`

## Backend RosViz mode defaults

- source -> mode default mapping:
  - `live_ros` -> `live_debug`
  - `replay` -> `replay_rosbag`
  - `episode` -> `replay_episode`

- `live_debug`:
  - data source: `live_ros`
  - clock: `live`
  - controls: no play/seek/step/rate control

- replay modes (`replay_rosbag`, `replay_episode`, `replay_motion_only`, `hybrid_compare`):
  - clock: `replay`
  - controls: play + step + seek + playback rate enabled

Primary path:
- `backend/ros_viz/runtime.py`

## Stream protocol defaults

- RosViz binary stream header is fixed-width (`32` bytes)
- sequence increment step is `1`

Primary path:
- `web/src/runtime_engine/rosviz/protocol/rosVizProtocol.ts`
- `backend/ros_viz/stream_framing.py`
