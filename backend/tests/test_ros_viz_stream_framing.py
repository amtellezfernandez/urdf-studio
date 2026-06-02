from __future__ import annotations

import pytest

from backend.ros_viz.params import STREAM_FLAG_PAYLOAD_JSON, STREAM_MAX_PAYLOAD_BYTES
from backend.ros_viz.stream_framing import (
    RosVizStreamFrameType,
    build_stream_frame,
    parse_stream_frame,
)


def test_build_and_parse_frame_roundtrip() -> None:
    payload = b'{"ok":true}'
    encoded = build_stream_frame(
        RosVizStreamFrameType.CLOCK_TICK,
        flags=STREAM_FLAG_PAYLOAD_JSON,
        seq=1,
        t_ns=2,
        topic_id=3,
        payload=payload,
    )

    decoded = parse_stream_frame(encoded)
    assert decoded.frame_type == RosVizStreamFrameType.CLOCK_TICK
    assert decoded.flags == STREAM_FLAG_PAYLOAD_JSON
    assert decoded.seq == 1
    assert decoded.t_ns == 2
    assert decoded.topic_id == 3
    assert decoded.payload == payload


def test_parse_frame_rejects_short_header() -> None:
    with pytest.raises(ValueError, match="Frame too short"):
        parse_stream_frame(b"abc")


def test_build_frame_rejects_payload_above_limit() -> None:
    payload = b"x" * (STREAM_MAX_PAYLOAD_BYTES + 1)
    with pytest.raises(ValueError, match="Payload too large"):
        build_stream_frame(
            RosVizStreamFrameType.DIAGNOSTIC_EVENT,
            flags=0,
            seq=1,
            t_ns=1,
            topic_id=1,
            payload=payload,
        )
