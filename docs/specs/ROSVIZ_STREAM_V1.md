# ROS Viz Stream V1 (Draft)

This document defines the v1 binary envelope used by the ROS viz websocket stream.

## Header Layout

Each websocket binary message uses a fixed-size 32-byte little-endian header:

- `u32 type`
- `u32 flags`
- `u64 seq`
- `u64 t_ns`
- `u32 topic_id`
- `u32 payload_len`

Payload bytes follow immediately after the header.

## Frame Types

- `1`: `TF_EDGE_BATCH`
- `2`: `RESOLVED_FRAME_POSE_BATCH`
- `3`: `MARKER_DELTA_BATCH`
- `4`: `POINTCLOUD_CHUNK`
- `5`: `JOINT_STATE_BATCH`
- `6`: `CLOCK_TICK`
- `7`: `DIAGNOSTIC_EVENT`

## Flags

- `1 << 0`: payload encoded as JSON
- `1 << 1`: payload encoded as FlatBuffer

## Current Endpoint

- `POST /ros-viz/sessions`
- `GET /ros-viz/sessions/{session_id}/topics`
- `POST /ros-viz/sessions/{session_id}/subscriptions`
- `WS /ws/ros-viz/{session_id}`

## Notes

- v1 currently sends JSON payloads for all frame types.
- Sequence numbers are monotonic and increment by 1 per frame.
- Session time uses a deterministic tick (`50ms`) per stream step for reproducible playback.
- `MARKER_DELTA_BATCH` follows RViz-style action semantics:
  - `add_or_modify`: replace marker by `(namespace, marker_id)`
  - `delete`: remove marker by `(namespace, marker_id)`
  - `delete_all`: clear all markers
  - `lifetime_ms`: optional marker auto-expiry
- Deterministic hash and FlatBuffer payload freeze are planned for the next contract pass.
