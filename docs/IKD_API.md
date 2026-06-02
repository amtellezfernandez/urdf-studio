# IKD API (v1)

`ikd` is the native IK daemon for reactive control.

## Endpoints

- `GET /health`
- `GET /version`
- `POST /model`
- `POST /target`
- `GET /telemetry` (WebSocket upgrade)

## Model Load Request (AMIK)

`POST /model`

```json
{
  "schema_version": "1",
  "urdf_xml": "<robot ... />",
  "target_link": "gripper_frame_link",
  "seed_joint_values_rad": {
    "shoulder_pan_joint": 0.1
  }
}
```

### Response

```json
{
  "schema_version": "1",
  "loaded": true,
  "target_link": "gripper_frame_link",
  "actuated_joint_names": ["shoulder_pan_joint", "elbow_joint"],
  "initial_ee_position_xyz_m": [0.25, 0.0, 0.18]
}
```

## Target Request

`POST /target`

```json
{
  "schema_version": "1",
  "sequence": 17,
  "source_ts_ns": 1738886400000000000,
  "mode": "pose",
  "target_link": "gripper_frame_link",
  "position_xyz_m": [0.28, 0.11, 0.19],
  "orientation_wxyz": [1.0, 0.0, 0.0, 0.0],
  "joint_targets_rad": null,
  "orientation_policy": "prefer",
  "max_linear_speed_mps": null,
  "max_angular_speed_rps": null
}
```

### Validation rules

- `schema_version` must be `"1"`.
- `target_link` must be non-empty.
- `mode=pose` requires `position_xyz_m` and `orientation_wxyz`.
- `mode=position` requires `position_xyz_m`.
- `mode=joint` requires `joint_targets_rad`.
- Numeric fields must be finite.
- Speed limits, when present, must be `> 0`.

### Response

```json
{
  "schema_version": "1",
  "accepted": true,
  "sequence": 17,
  "server_rx_ts_ns": 1738886400001234567
}
```

### Error response

```json
{
  "schema_version": "1",
  "code": "invalid_target",
  "message": "position mode requires position_xyz_m"
}
```

## Telemetry Stream

`WS /telemetry`

```json
{
  "schema_version": "1",
  "tick_ts_ns": 1738886400005678000,
  "sequence_applied": 17,
  "q_rad": {
    "shoulder_pan_joint": 0.4,
    "elbow_joint": -1.2
  },
  "ee_position_xyz_m": [0.28, 0.11, 0.19],
  "ee_orientation_wxyz": [1.0, 0.0, 0.0, 0.0],
  "residual_position_m": 0.0,
  "residual_orientation_rad": 0.0,
  "loop_hz": 500.0,
  "overrun": false,
  "stale_target": false,
  "limit_clamp_count": 0
}
```

## Runtime environment

- `IKD_HOST` default `127.0.0.1`
- `IKD_PORT` default `8088`
- `IKD_WS_PATH` default `/telemetry`
- `IKD_CONTROL_HZ` default `500`
- `IKD_TELEMETRY_HZ` default `60`
- `IKD_STALE_TARGET_MS` default `250`
- `IKD_CORS_ORIGIN` optional exact origin
