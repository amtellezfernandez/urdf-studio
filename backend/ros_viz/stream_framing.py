from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
import struct

from backend.ros_viz.params import (
    STREAM_FRAME_HEADER_BYTES,
    STREAM_FRAME_HEADER_FORMAT,
    STREAM_MAX_PAYLOAD_BYTES,
)


class RosVizStreamFrameType(IntEnum):
    TF_EDGE_BATCH = 1
    RESOLVED_FRAME_POSE_BATCH = 2
    MARKER_DELTA_BATCH = 3
    POINTCLOUD_CHUNK = 4
    JOINT_STATE_BATCH = 5
    CLOCK_TICK = 6
    DIAGNOSTIC_EVENT = 7


@dataclass(frozen=True)
class RosVizStreamFrame:
    frame_type: RosVizStreamFrameType
    flags: int
    seq: int
    t_ns: int
    topic_id: int
    payload: bytes


def build_stream_frame(
    frame_type: RosVizStreamFrameType,
    *,
    flags: int,
    seq: int,
    t_ns: int,
    topic_id: int,
    payload: bytes,
) -> bytes:
    if seq < 0:
        raise ValueError("Sequence must be non-negative.")
    if t_ns < 0:
        raise ValueError("Timestamp must be non-negative.")
    if topic_id < 0:
        raise ValueError("Topic ID must be non-negative.")
    payload_len = len(payload)
    if payload_len > STREAM_MAX_PAYLOAD_BYTES:
        raise ValueError(
            f"Payload too large: {payload_len} bytes exceeds {STREAM_MAX_PAYLOAD_BYTES} bytes."
        )

    header = struct.pack(
        STREAM_FRAME_HEADER_FORMAT,
        int(frame_type),
        flags,
        seq,
        t_ns,
        topic_id,
        payload_len,
    )
    return header + payload


def parse_stream_frame(frame: bytes) -> RosVizStreamFrame:
    if len(frame) < STREAM_FRAME_HEADER_BYTES:
        raise ValueError(
            f"Frame too short: expected at least {STREAM_FRAME_HEADER_BYTES} bytes, got {len(frame)}."
        )

    frame_type_raw, flags, seq, t_ns, topic_id, payload_len = struct.unpack(
        STREAM_FRAME_HEADER_FORMAT,
        frame[:STREAM_FRAME_HEADER_BYTES],
    )

    expected_length = STREAM_FRAME_HEADER_BYTES + payload_len
    if len(frame) != expected_length:
        raise ValueError(
            f"Frame length mismatch: expected {expected_length} bytes, got {len(frame)}."
        )

    try:
        frame_type = RosVizStreamFrameType(frame_type_raw)
    except ValueError as exc:
        raise ValueError(f"Unknown frame type: {frame_type_raw}") from exc

    payload = frame[STREAM_FRAME_HEADER_BYTES:]
    return RosVizStreamFrame(
        frame_type=frame_type,
        flags=flags,
        seq=seq,
        t_ns=t_ns,
        topic_id=topic_id,
        payload=payload,
    )
