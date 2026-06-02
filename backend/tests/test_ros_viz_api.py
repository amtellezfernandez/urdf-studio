from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.api.ros_viz import (
    create_ros_viz_session,
    get_ros_viz_clock_state,
    get_ros_viz_session_state,
    get_ros_viz_topics,
    issue_ros_viz_stream_ticket,
    update_ros_viz_clock_state,
    update_ros_viz_session_mode,
    update_ros_viz_subscriptions,
)
from backend.models.ros_viz import (
    RosVizClockControlRequest,
    RosVizModeUpdateRequest,
    RosVizSessionCreateRequest,
    RosVizSubscriptionRequest,
)


def _build_request(path: str, *, request_id: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [(b"x-request-id", request_id.encode("utf-8"))],
            "client": ("127.0.0.1", 1234),
        }
    )


def test_ros_viz_session_and_subscription_endpoints() -> None:
    session = create_ros_viz_session(
        RosVizSessionCreateRequest(
            deterministic_mode="strict",
            mode_profile="ros_debug",
            data_source="live_ros",
        )
    )
    session_id = session.session_id

    assert session.deterministic_mode == "strict"
    assert session.mode_profile == "ros_debug"
    assert session.data_source == "live_ros"
    assert session.session_mode == "live_debug"

    topics = get_ros_viz_topics(session_id)
    assert len(topics.topics) > 0

    subscribed = update_ros_viz_subscriptions(
        session_id,
        RosVizSubscriptionRequest(topic_ids=[2, 7], include_clock=True),
    )
    assert 6 in subscribed.subscribed_topic_ids


def test_ros_viz_mode_and_clock_endpoints_for_replay_session() -> None:
    session = create_ros_viz_session(
        RosVizSessionCreateRequest(
            data_source="replay",
            replay_source="episode://abc",
        )
    )

    state = get_ros_viz_session_state(session.session_id)
    assert state.mode == "replay_rosbag"
    assert state.capabilities.can_seek is True

    switched = update_ros_viz_session_mode(
        session.session_id,
        RosVizModeUpdateRequest(mode="replay_episode"),
    )
    assert switched.mode == "replay_episode"
    assert switched.data_source == "episode"

    initial_clock = get_ros_viz_clock_state(session.session_id)
    assert initial_clock.can_control is True
    assert initial_clock.mode == "replay"

    updated = update_ros_viz_clock_state(
        session.session_id,
        RosVizClockControlRequest(is_playing=False, step_ticks=2),
    )
    assert updated.is_playing is False
    assert updated.tick_index >= 2


def test_ros_viz_stream_ticket_endpoint_issues_short_lived_ticket() -> None:
    session = create_ros_viz_session(RosVizSessionCreateRequest())

    ticket_response = issue_ros_viz_stream_ticket(
        _build_request(f"/ros-viz/sessions/{session.session_id}/stream-ticket", request_id="rosviz-api-ticket-1"),
        session.session_id,
    )

    assert ticket_response.session_id == session.session_id
    assert ticket_response.ticket
    assert ticket_response.expires_at_ms >= session.created_at_ms


def test_ros_viz_clock_control_rejects_live_debug_pause() -> None:
    session = create_ros_viz_session(RosVizSessionCreateRequest(data_source="live_ros"))

    with pytest.raises(HTTPException, match="422: Session mode 'live_debug' does not support play/pause control."):
        update_ros_viz_clock_state(
            session.session_id,
            RosVizClockControlRequest(is_playing=False),
        )
