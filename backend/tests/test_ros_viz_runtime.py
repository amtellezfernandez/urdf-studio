from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from backend.models.ros_viz import (
    RosVizClockControlRequest,
    RosVizModeUpdateRequest,
    RosVizSessionCreateRequest,
    RosVizSubscriptionRequest,
)
from backend.ros_viz.params import (
    DEFAULT_DETERMINISTIC_MODE,
    ROSVIZ_STREAM_TICKET_TTL_MS,
    STREAM_TICK_INTERVAL_NS,
    TOPIC_ID_CLOCK_TICK,
    TOPIC_ID_DIAGNOSTIC_EVENT,
    TOPIC_ID_MARKER_DELTA_BATCH,
    TOPIC_ID_RESOLVED_FRAME_POSE_BATCH,
)
from backend.ros_viz.runtime import RosVizRuntime
from backend.ros_viz.stream_framing import RosVizStreamFrameType, parse_stream_frame


def _tool_xyz_from_resolved_payload(payload: dict) -> list[float]:
    tool_pose = next((pose for pose in payload.get("poses", []) if pose.get("frame_id") == "tool0"), None)
    assert tool_pose is not None
    return list(tool_pose["translation_xyz"])


def test_runtime_create_session_and_list_topics() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    assert snapshot.session_id
    assert snapshot.topic_count > 0
    assert snapshot.deterministic_mode == DEFAULT_DETERMINISTIC_MODE
    assert snapshot.mode_profile == "ros_debug"
    assert snapshot.data_source == "live_ros"
    assert snapshot.session_mode == "live_debug"

    topics = runtime.list_topics(snapshot.session_id)
    topic_ids = {topic.topic_id for topic in topics.topics}
    assert TOPIC_ID_CLOCK_TICK in topic_ids
    assert TOPIC_ID_RESOLVED_FRAME_POSE_BATCH in topic_ids


def test_runtime_rejects_unknown_subscription_topic() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    with pytest.raises(ValueError, match="Unknown topic IDs"):
        runtime.update_subscriptions(
            snapshot.session_id,
            RosVizSubscriptionRequest(topic_ids=[99999], include_clock=True),
        )


def test_runtime_stream_ticket_is_single_use_and_host_bound() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    ticket_response = runtime.issue_stream_ticket(
        snapshot.session_id,
        client_host="127.0.0.1",
        request_id="ticket-issue-1",
    )

    runtime.consume_stream_ticket(
        snapshot.session_id,
        ticket=ticket_response.ticket,
        client_host="127.0.0.1",
    )

    with pytest.raises(PermissionError, match="already used"):
        runtime.consume_stream_ticket(
            snapshot.session_id,
            ticket=ticket_response.ticket,
            client_host="127.0.0.1",
        )


def test_runtime_stream_ticket_rejects_wrong_client_or_expired_ticket() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    with patch("backend.ros_viz.runtime._now_ms", return_value=1_000):
        ticket_response = runtime.issue_stream_ticket(
            snapshot.session_id,
            client_host="client-a",
            request_id="ticket-issue-2",
        )

    with patch("backend.ros_viz.runtime._now_ms", return_value=1_001):
        with pytest.raises(PermissionError, match="not valid for this client"):
            runtime.consume_stream_ticket(
                snapshot.session_id,
                ticket=ticket_response.ticket,
                client_host="client-b",
            )

    expired_now_ms = 1_000 + ROSVIZ_STREAM_TICKET_TTL_MS + 1
    with patch("backend.ros_viz.runtime._now_ms", return_value=expired_now_ms):
        with pytest.raises(PermissionError, match="expired"):
            runtime.consume_stream_ticket(
                snapshot.session_id,
                ticket=ticket_response.ticket,
                client_host="client-a",
            )


def test_runtime_stream_frames_have_monotonic_sequence() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    frames = runtime.build_stream_frames(snapshot.session_id)
    decoded = [parse_stream_frame(frame) for frame in frames]

    assert len(decoded) >= 2
    assert all(decoded[i].seq < decoded[i + 1].seq for i in range(len(decoded) - 1))

    frame_types = {frame.frame_type for frame in decoded}
    assert RosVizStreamFrameType.CLOCK_TICK in frame_types
    assert RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH in frame_types
    assert RosVizStreamFrameType.DIAGNOSTIC_EVENT in frame_types


def test_runtime_clock_ticks_advance_deterministically() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    first = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(snapshot.session_id)]
    second = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(snapshot.session_id)]

    first_clock = next(frame for frame in first if frame.frame_type == RosVizStreamFrameType.CLOCK_TICK)
    second_clock = next(frame for frame in second if frame.frame_type == RosVizStreamFrameType.CLOCK_TICK)
    assert second_clock.t_ns > first_clock.t_ns
    assert first_clock.t_ns + STREAM_TICK_INTERVAL_NS == second_clock.t_ns


def test_runtime_marker_delta_batch_is_streamed_and_shaped() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())
    runtime.update_subscriptions(
        snapshot.session_id,
        RosVizSubscriptionRequest(topic_ids=[TOPIC_ID_MARKER_DELTA_BATCH], include_clock=False),
    )

    decoded = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(snapshot.session_id)]
    marker_frame = next(frame for frame in decoded if frame.frame_type == RosVizStreamFrameType.MARKER_DELTA_BATCH)
    payload = json.loads(marker_frame.payload.decode("utf-8"))

    assert payload["fixed_frame"] in {"map", "world"}
    assert isinstance(payload["deltas"], list)
    assert len(payload["deltas"]) >= 2
    first_delta = payload["deltas"][0]
    assert first_delta["action"] == "add_or_modify"
    assert first_delta["marker"]["marker_type"] in {"line_strip", "sphere", "cube"}


def test_runtime_allows_empty_subscription_set_with_liveness_frame() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())
    runtime.update_subscriptions(
        snapshot.session_id,
        RosVizSubscriptionRequest(topic_ids=[], include_clock=False),
    )

    frames = runtime.build_stream_frames(snapshot.session_id)
    decoded = [parse_stream_frame(frame) for frame in frames]
    assert len(decoded) == 1
    assert decoded[0].frame_type == RosVizStreamFrameType.DIAGNOSTIC_EVENT
    assert decoded[0].topic_id == TOPIC_ID_DIAGNOSTIC_EVENT


def test_runtime_resolved_pose_hash_and_session_hash_progress() -> None:
    runtime = RosVizRuntime()
    snapshot = runtime.create_session(RosVizSessionCreateRequest())

    first_frames = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(snapshot.session_id)]
    second_frames = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(snapshot.session_id)]

    first_pose = next(
        frame for frame in first_frames if frame.frame_type == RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH
    )
    second_pose = next(
        frame for frame in second_frames if frame.frame_type == RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH
    )

    first_payload = json.loads(first_pose.payload.decode("utf-8"))
    second_payload = json.loads(second_pose.payload.decode("utf-8"))

    assert first_payload["pose_hash"]
    assert second_payload["pose_hash"]
    assert first_payload["pose_hash"] != second_payload["pose_hash"]

    session_snapshot = runtime.get_session(snapshot.session_id)
    assert session_snapshot.deterministic_session_hash


def test_runtime_strict_mode_first_tick_pose_hash_matches_across_sessions() -> None:
    runtime = RosVizRuntime()
    first_session = runtime.create_session(RosVizSessionCreateRequest(deterministic_mode="strict"))
    second_session = runtime.create_session(RosVizSessionCreateRequest(deterministic_mode="strict"))

    first_frames = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(first_session.session_id)]
    second_frames = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(second_session.session_id)]

    first_pose = next(
        frame for frame in first_frames if frame.frame_type == RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH
    )
    second_pose = next(
        frame for frame in second_frames if frame.frame_type == RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH
    )

    first_payload = json.loads(first_pose.payload.decode("utf-8"))
    second_payload = json.loads(second_pose.payload.decode("utf-8"))
    assert first_payload["pose_hash"] == second_payload["pose_hash"]


def test_runtime_without_live_ros_data_stays_static() -> None:
    runtime = RosVizRuntime()
    session = runtime.create_session(RosVizSessionCreateRequest())

    first_frames = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(session.session_id)]
    second_frames = [parse_stream_frame(frame) for frame in runtime.build_stream_frames(session.session_id)]

    first_pose = next(
        frame for frame in first_frames if frame.frame_type == RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH
    )
    second_pose = next(
        frame for frame in second_frames if frame.frame_type == RosVizStreamFrameType.RESOLVED_FRAME_POSE_BATCH
    )
    first_diag = next(frame for frame in first_frames if frame.frame_type == RosVizStreamFrameType.DIAGNOSTIC_EVENT)

    first_payload = json.loads(first_pose.payload.decode("utf-8"))
    second_payload = json.loads(second_pose.payload.decode("utf-8"))
    diag_payload = json.loads(first_diag.payload.decode("utf-8"))

    assert _tool_xyz_from_resolved_payload(first_payload) == _tool_xyz_from_resolved_payload(second_payload)
    assert diag_payload["details"]["motion_source"] == "static_waiting_for_ros"
    assert diag_payload["details"]["mode_profile"] == "ros_debug"
    assert diag_payload["details"]["mode"] == "live_debug"


def test_runtime_clock_state_defaults_follow_mode() -> None:
    runtime = RosVizRuntime()

    live_session = runtime.create_session(RosVizSessionCreateRequest(data_source="live_ros"))
    live_clock = runtime.get_clock_state(live_session.session_id)
    assert live_clock.mode == "live"
    assert live_clock.is_playing is True
    assert live_clock.can_control is False


def test_runtime_clock_control_rejects_live_debug_updates() -> None:
    runtime = RosVizRuntime()
    session = runtime.create_session(RosVizSessionCreateRequest(data_source="live_ros"))

    with pytest.raises(ValueError, match="does not support play/pause"):
        runtime.update_clock_control(
            session.session_id,
            RosVizClockControlRequest(is_playing=False),
        )


def test_runtime_session_mode_update_resets_timeline_and_controls() -> None:
    runtime = RosVizRuntime()
    session = runtime.create_session(RosVizSessionCreateRequest())

    updated = runtime.update_session_mode(
        session.session_id,
        RosVizModeUpdateRequest(mode="live_debug"),
    )

    assert updated.mode == "live_debug"
    assert updated.data_source == "live_ros"
    assert updated.clock_mode == "live"
    assert updated.capabilities.can_seek is False
    assert updated.tick_index == 0
