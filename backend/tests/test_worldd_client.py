from __future__ import annotations

from backend.world_bridge.types import WorldBridgeEventType
from backend.world_bridge.worldd_client import (
    NANOSECONDS_PER_MILLISECOND,
    parse_worldd_ack_payload,
    parse_worldd_session_payload,
    parse_worldd_status_payload,
)


TEST_STATUS_ACTIVE_SESSIONS = 3
TEST_STATUS_MAX_EVENTS = 512
TEST_STATUS_DURATION_MS = 12_000
TEST_EVENT_TIMESTAMP_NS = 2_500_000_000
TEST_CREATED_AT_NS = 5_000_000_000
TEST_UPDATED_AT_NS = 5_500_000_000
TEST_SCENARIO_DURATION_MS = 9_000
TEST_SCENARIO_TIME_MS = 700
TEST_LAST_COMMAND_SEQUENCE = 5
TEST_JOINT_POSITION_RAD = 0.35
TEST_SECOND_JOINT_POSITION_RAD = -0.15
TEST_APPLIED_JOINT_COUNT = 2
TEST_COMMAND_SEQUENCE = 9
TEST_INVALID_SCENARIO_DURATION = "bad-value"
TEST_INVALID_ACCEPTED_VALUE = "not-bool"
TEST_TRANSITION_TIMESTAMP_NS = 3_000_000_000


def test_parse_worldd_status_payload_reads_values() -> None:
    parsed = parse_worldd_status_payload(
        {
            "service": "worldd-world-bridge",
            "runtime_mode": "rust-data-plane",
            "active_sessions": TEST_STATUS_ACTIVE_SESSIONS,
            "max_events_per_session": TEST_STATUS_MAX_EVENTS,
            "default_scenario_duration_ms": TEST_STATUS_DURATION_MS,
        }
    )

    assert parsed.active_sessions == TEST_STATUS_ACTIVE_SESSIONS
    assert parsed.max_events_per_session == TEST_STATUS_MAX_EVENTS
    assert parsed.default_scenario_duration_ms == TEST_STATUS_DURATION_MS


def test_parse_worldd_session_payload_skips_unknown_events() -> None:
    parsed = parse_worldd_session_payload(
        {
            "session_id": "wbs-00000001",
            "robot_name": "so101",
            "camera_ids": ["base_cam"],
            "created_at_ns": TEST_CREATED_AT_NS,
            "updated_at_ns": TEST_UPDATED_AT_NS,
            "scenario_duration_ms": TEST_SCENARIO_DURATION_MS,
            "scenario_time_ms": TEST_SCENARIO_TIME_MS,
            "joint_state_rad": {"joint_1": TEST_JOINT_POSITION_RAD},
            "last_command_sequence": TEST_LAST_COMMAND_SEQUENCE,
            "recent_events": [
                {
                    "event_id": "evt-1",
                    "session_id": "wbs-00000001",
                    "event_type": "session_created",
                    "timestamp_ns": TEST_EVENT_TIMESTAMP_NS,
                    "payload": {"source": "test"},
                },
                {
                    "event_id": "evt-2",
                    "session_id": "wbs-00000001",
                    "event_type": "unsupported_event",
                    "timestamp_ns": TEST_EVENT_TIMESTAMP_NS,
                    "payload": {},
                },
            ],
            "recent_transitions": [
                {
                    "transition_id": "trn-1",
                    "session_id": "wbs-00000001",
                    "transition_type": "transition.joint_command",
                    "timestamp_ns": TEST_TRANSITION_TIMESTAMP_NS,
                    "source": "test-suite",
                    "sequence_id": TEST_COMMAND_SEQUENCE,
                    "scenario_time_before_ms": 100,
                    "scenario_time_after_ms": TEST_SCENARIO_TIME_MS,
                    "joint_state_before_rad": {"joint_1": TEST_JOINT_POSITION_RAD},
                    "action_joint_positions_rad": {
                        "joint_1": TEST_SECOND_JOINT_POSITION_RAD
                    },
                    "joint_state_after_rad": {"joint_1": TEST_SECOND_JOINT_POSITION_RAD},
                },
                {
                    "transition_id": "trn-2",
                    "session_id": "wbs-00000001",
                    "transition_type": "unsupported_transition",
                    "timestamp_ns": TEST_TRANSITION_TIMESTAMP_NS,
                    "source": "test-suite",
                    "scenario_time_before_ms": TEST_SCENARIO_TIME_MS,
                    "scenario_time_after_ms": TEST_SCENARIO_TIME_MS,
                    "joint_state_before_rad": {},
                    "action_joint_positions_rad": {},
                    "joint_state_after_rad": {},
                },
            ],
        }
    )

    assert parsed.created_at_ms == TEST_CREATED_AT_NS // NANOSECONDS_PER_MILLISECOND
    assert parsed.updated_at_ms == TEST_UPDATED_AT_NS // NANOSECONDS_PER_MILLISECOND
    assert parsed.joint_state["joint_1"] == TEST_JOINT_POSITION_RAD
    assert len(parsed.recent_events) == 1
    assert parsed.recent_events[0].type == WorldBridgeEventType.SESSION_CREATED
    assert len(parsed.recent_transitions) == 1
    assert (
        parsed.recent_transitions[0].timestamp_ms
        == TEST_TRANSITION_TIMESTAMP_NS // NANOSECONDS_PER_MILLISECOND
    )


def test_parse_worldd_session_payload_strict_rejects_unknown_transition_type() -> None:
    try:
        parse_worldd_session_payload(
            {
                "session_id": "wbs-00000001",
                "robot_name": "so101",
                "camera_ids": ["base_cam"],
                "created_at_ns": TEST_CREATED_AT_NS,
                "updated_at_ns": TEST_UPDATED_AT_NS,
                "scenario_duration_ms": TEST_SCENARIO_DURATION_MS,
                "scenario_time_ms": TEST_SCENARIO_TIME_MS,
                "joint_state_rad": {},
                "last_command_sequence": TEST_LAST_COMMAND_SEQUENCE,
                "recent_events": [],
                "recent_transitions": [
                    {
                        "transition_id": "trn-2",
                        "session_id": "wbs-00000001",
                        "transition_type": "unsupported_transition",
                        "timestamp_ns": TEST_TRANSITION_TIMESTAMP_NS,
                        "source": "test-suite",
                        "scenario_time_before_ms": TEST_SCENARIO_TIME_MS,
                        "scenario_time_after_ms": TEST_SCENARIO_TIME_MS,
                        "joint_state_before_rad": {},
                        "action_joint_positions_rad": {},
                        "joint_state_after_rad": {},
                    },
                ],
            },
            strict=True,
        )
    except ValueError as exc:
        assert "Unsupported worldd transition type" in str(exc)
        return
    raise AssertionError("Expected strict parser to reject unknown transition type")


def test_parse_worldd_ack_payload_reads_command_fields() -> None:
    parsed = parse_worldd_ack_payload(
        {
            "session_id": "wbs-00000001",
            "accepted": True,
            "applied_joint_count": TEST_APPLIED_JOINT_COUNT,
            "scenario_time_ms": TEST_SCENARIO_TIME_MS,
            "command_sequence": TEST_COMMAND_SEQUENCE,
        }
    )

    assert parsed.accepted is True
    assert parsed.applied_joint_count == TEST_APPLIED_JOINT_COUNT
    assert parsed.scenario_time_ms == TEST_SCENARIO_TIME_MS
    assert parsed.command_sequence == TEST_COMMAND_SEQUENCE


def test_parse_worldd_ack_payload_parses_string_false_to_false() -> None:
    parsed = parse_worldd_ack_payload(
        {
            "session_id": "wbs-00000001",
            "accepted": "false",
            "applied_joint_count": TEST_APPLIED_JOINT_COUNT,
            "scenario_time_ms": TEST_SCENARIO_TIME_MS,
            "command_sequence": TEST_COMMAND_SEQUENCE,
        }
    )

    assert parsed.accepted is False


def test_parse_worldd_ack_payload_strict_rejects_invalid_boolean_field() -> None:
    try:
        parse_worldd_ack_payload(
            {
                "session_id": "wbs-00000001",
                "accepted": TEST_INVALID_ACCEPTED_VALUE,
                "applied_joint_count": TEST_APPLIED_JOINT_COUNT,
                "scenario_time_ms": TEST_SCENARIO_TIME_MS,
                "command_sequence": TEST_COMMAND_SEQUENCE,
            },
            strict=True,
        )
    except ValueError as exc:
        assert "accepted" in str(exc)
        return
    raise AssertionError("Expected strict parser to reject invalid boolean field")


def test_parse_worldd_status_payload_strict_requires_service_field() -> None:
    try:
        parse_worldd_status_payload(
            {
                "runtime_mode": "rust-data-plane",
                "active_sessions": TEST_STATUS_ACTIVE_SESSIONS,
                "max_events_per_session": TEST_STATUS_MAX_EVENTS,
                "default_scenario_duration_ms": TEST_STATUS_DURATION_MS,
            },
            strict=True,
        )
    except ValueError as exc:
        assert "service" in str(exc)
        return
    raise AssertionError("Expected strict parser to require service field")


def test_parse_worldd_session_payload_strict_rejects_unknown_event_type() -> None:
    try:
        parse_worldd_session_payload(
            {
                "session_id": "wbs-00000001",
                "robot_name": "so101",
                "camera_ids": ["base_cam"],
                "created_at_ns": TEST_CREATED_AT_NS,
                "updated_at_ns": TEST_UPDATED_AT_NS,
                "scenario_duration_ms": TEST_SCENARIO_DURATION_MS,
                "scenario_time_ms": TEST_SCENARIO_TIME_MS,
                "joint_state_rad": {},
                "last_command_sequence": TEST_LAST_COMMAND_SEQUENCE,
                "recent_events": [
                    {
                        "event_id": "evt-2",
                        "session_id": "wbs-00000001",
                        "event_type": "unsupported_event",
                        "timestamp_ns": TEST_EVENT_TIMESTAMP_NS,
                        "payload": {},
                    },
                ],
            },
            strict=True,
        )
    except ValueError as exc:
        assert "Unsupported worldd event type" in str(exc)
        return
    raise AssertionError("Expected strict parser to reject unknown event type")


def test_parse_worldd_session_payload_strict_rejects_invalid_numeric_fields() -> None:
    try:
        parse_worldd_session_payload(
            {
                "session_id": "wbs-00000001",
                "robot_name": "so101",
                "camera_ids": ["base_cam"],
                "created_at_ns": TEST_CREATED_AT_NS,
                "updated_at_ns": TEST_UPDATED_AT_NS,
                "scenario_duration_ms": TEST_INVALID_SCENARIO_DURATION,
                "scenario_time_ms": TEST_SCENARIO_TIME_MS,
                "joint_state_rad": {},
                "last_command_sequence": TEST_LAST_COMMAND_SEQUENCE,
                "recent_events": [],
            },
            strict=True,
        )
    except ValueError as exc:
        assert "scenario_duration_ms" in str(exc)
        return
    raise AssertionError("Expected strict parser to reject invalid numeric field")


def test_parse_worldd_session_payload_strict_rejects_non_object_event_payload() -> None:
    try:
        parse_worldd_session_payload(
            {
                "session_id": "wbs-00000001",
                "robot_name": "so101",
                "camera_ids": ["base_cam"],
                "created_at_ns": TEST_CREATED_AT_NS,
                "updated_at_ns": TEST_UPDATED_AT_NS,
                "scenario_duration_ms": TEST_SCENARIO_DURATION_MS,
                "scenario_time_ms": TEST_SCENARIO_TIME_MS,
                "joint_state_rad": {},
                "last_command_sequence": TEST_LAST_COMMAND_SEQUENCE,
                "recent_events": [
                    {
                        "event_id": "evt-1",
                        "session_id": "wbs-00000001",
                        "event_type": "session_created",
                        "timestamp_ns": TEST_EVENT_TIMESTAMP_NS,
                        "payload": ["unexpected"],
                    },
                ],
            },
            strict=True,
        )
    except ValueError as exc:
        assert "payload" in str(exc)
        return
    raise AssertionError("Expected strict parser to reject non-object event payload")
