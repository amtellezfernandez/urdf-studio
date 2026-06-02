from datetime import timedelta

import pytest
from pydantic import ValidationError

import backend.world_bridge.runtime as world_bridge_runtime_module
from backend.models.attestation import (
    AttestationStatusUpsertRequest,
    AttestationTrustState,
    utc_now,
)
from backend.services.attestation import attestation_status_store
from backend.world_bridge.params import MAX_CAMERAS_PER_SESSION
from backend.world_bridge.readiness_params import READINESS_MIN_TRANSITIONS_FOR_WATCH
from backend.world_bridge.runtime import WorldBridgeRuntime
from backend.world_bridge.types import (
    WorldBridgeEventType,
    WorldBridgeJointCommandRequest,
    WorldBridgeReadinessDecision,
    WorldBridgeRolloutMode,
    WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeTransitionType,
)


TEST_SCENARIO_DURATION_MS = 1_200
TEST_INITIAL_SCENARIO_TIME_MS = 300
TEST_OUT_OF_BOUNDS_SCENARIO_TIME_MS = 9_999
TEST_JOINT_A_POSITION = 0.25
TEST_JOINT_B_POSITION = -0.75
TEST_JOINT_COMMAND_SEQUENCE_ID = 4
TEST_ROBOT_NAME = "so100"
TEST_PLANNER_ID = "planner-a"
TEST_TASK_ID = "pick-place"
TEST_ADAPTER_ID = "adapter-v1"
TEST_ACTIVE_SESSION_CAPACITY = 1
TEST_IDLE_SESSION_TTL_MS = 1
TEST_FIRST_TIMESTAMP_MS = 1_000
TEST_EXPIRED_TIMESTAMP_MS = 1_002


def test_create_session_records_creation_event() -> None:
    runtime = WorldBridgeRuntime()
    session = runtime.create_session(
        WorldBridgeSessionCreateRequest(
            robot_name=TEST_ROBOT_NAME,
            camera_ids=["base_cam", "gripper_cam"],
            scenario_duration_ms=TEST_SCENARIO_DURATION_MS,
        )
    )

    assert session.robot_name == TEST_ROBOT_NAME
    assert session.scenario_duration_ms == TEST_SCENARIO_DURATION_MS
    assert len(session.recent_events) == 1
    assert session.recent_events[0].type == WorldBridgeEventType.SESSION_CREATED
    assert len(session.recent_transitions) == 0


def test_apply_joint_command_updates_joint_state_and_sequence() -> None:
    runtime = WorldBridgeRuntime()
    session = runtime.create_session(WorldBridgeSessionCreateRequest(robot_name="so101"))

    ack = runtime.apply_joint_command(
        session_id=session.session_id,
        req=WorldBridgeJointCommandRequest(
            joint_positions={"joint_a": TEST_JOINT_A_POSITION, "joint_b": TEST_JOINT_B_POSITION},
            source="test-suite",
            planner_id=TEST_PLANNER_ID,
            task_id=TEST_TASK_ID,
            adapter_id=TEST_ADAPTER_ID,
            sequence_id=TEST_JOINT_COMMAND_SEQUENCE_ID,
            rollout_mode=WorldBridgeRolloutMode.COUNTERFACTUAL,
        ),
    )

    snapshot = runtime.get_session(session.session_id)

    assert ack.accepted is True
    assert ack.command_sequence == TEST_JOINT_COMMAND_SEQUENCE_ID
    assert snapshot.joint_state["joint_a"] == TEST_JOINT_A_POSITION
    assert snapshot.joint_state["joint_b"] == TEST_JOINT_B_POSITION
    assert snapshot.last_command_sequence == ack.command_sequence
    assert snapshot.last_command_sequence == TEST_JOINT_COMMAND_SEQUENCE_ID
    assert len(snapshot.recent_transitions) == 1
    transition = snapshot.recent_transitions[0]
    assert transition.type == WorldBridgeTransitionType.JOINT_COMMAND
    assert transition.sequence_id == TEST_JOINT_COMMAND_SEQUENCE_ID
    assert transition.action_joint_positions["joint_a"] == TEST_JOINT_A_POSITION
    assert transition.rollout_mode == WorldBridgeRolloutMode.COUNTERFACTUAL
    assert transition.planner_id == TEST_PLANNER_ID


def test_update_scenario_time_is_clamped_to_session_duration() -> None:
    runtime = WorldBridgeRuntime()
    session = runtime.create_session(
        WorldBridgeSessionCreateRequest(
            robot_name=TEST_ROBOT_NAME,
            scenario_duration_ms=TEST_SCENARIO_DURATION_MS,
        )
    )

    first_snapshot = runtime.update_scenario_time(
        session_id=session.session_id,
        req=WorldBridgeScenarioTimeUpdateRequest(
            scenario_time_ms=TEST_INITIAL_SCENARIO_TIME_MS,
        ),
    )
    second_snapshot = runtime.update_scenario_time(
        session_id=session.session_id,
        req=WorldBridgeScenarioTimeUpdateRequest(
            scenario_time_ms=TEST_OUT_OF_BOUNDS_SCENARIO_TIME_MS,
        ),
    )

    assert first_snapshot.scenario_time_ms == TEST_INITIAL_SCENARIO_TIME_MS
    assert second_snapshot.scenario_time_ms == TEST_SCENARIO_DURATION_MS
    assert len(second_snapshot.recent_transitions) == 2
    assert second_snapshot.recent_transitions[-1].type == WorldBridgeTransitionType.SCENARIO_TIME_UPDATE


def test_create_session_rejects_excessive_camera_count() -> None:
    excessive_camera_ids = [f"camera_{index}" for index in range(MAX_CAMERAS_PER_SESSION + 1)]

    with pytest.raises(ValidationError) as error:
        WorldBridgeSessionCreateRequest(
            robot_name="so101",
            camera_ids=excessive_camera_ids,
        )

    assert "at most" in str(error.value)


def test_create_session_rejects_when_active_session_capacity_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        world_bridge_runtime_module,
        "MAX_ACTIVE_SESSIONS",
        TEST_ACTIVE_SESSION_CAPACITY,
    )
    runtime = WorldBridgeRuntime()
    runtime.create_session(WorldBridgeSessionCreateRequest(robot_name=TEST_ROBOT_NAME))

    with pytest.raises(ValueError) as error:
        runtime.create_session(WorldBridgeSessionCreateRequest(robot_name="so101"))

    assert "exceeded configured capacity" in str(error.value)


def test_create_session_prunes_idle_sessions_before_capacity_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        world_bridge_runtime_module,
        "MAX_ACTIVE_SESSIONS",
        TEST_ACTIVE_SESSION_CAPACITY,
    )
    monkeypatch.setattr(
        world_bridge_runtime_module,
        "WORLD_BRIDGE_SESSION_IDLE_TTL_MS",
        TEST_IDLE_SESSION_TTL_MS,
    )
    current_time_ms = [TEST_FIRST_TIMESTAMP_MS]
    monkeypatch.setattr(world_bridge_runtime_module, "_now_ms", lambda: current_time_ms[0])

    runtime = WorldBridgeRuntime()
    first_session = runtime.create_session(WorldBridgeSessionCreateRequest(robot_name=TEST_ROBOT_NAME))
    current_time_ms[0] = TEST_EXPIRED_TIMESTAMP_MS
    second_session = runtime.create_session(WorldBridgeSessionCreateRequest(robot_name="so101"))

    sessions = runtime.list_sessions()
    assert first_session.session_id != second_session.session_id
    assert [session.session_id for session in sessions] == [second_session.session_id]


def test_apply_joint_command_rejects_expired_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        world_bridge_runtime_module,
        "WORLD_BRIDGE_SESSION_IDLE_TTL_MS",
        TEST_IDLE_SESSION_TTL_MS,
    )
    current_time_ms = [TEST_FIRST_TIMESTAMP_MS]
    monkeypatch.setattr(world_bridge_runtime_module, "_now_ms", lambda: current_time_ms[0])

    runtime = WorldBridgeRuntime()
    session = runtime.create_session(WorldBridgeSessionCreateRequest(robot_name=TEST_ROBOT_NAME))
    current_time_ms[0] = TEST_EXPIRED_TIMESTAMP_MS

    with pytest.raises(KeyError) as error:
        runtime.apply_joint_command(
            session_id=session.session_id,
            req=WorldBridgeJointCommandRequest(joint_positions={"joint_a": TEST_JOINT_A_POSITION}),
        )

    assert str(error.value) == f"'unknown session: {session.session_id}'"


def test_joint_command_rejects_non_finite_values() -> None:
    with pytest.raises(ValidationError):
        WorldBridgeJointCommandRequest(joint_positions={"joint_a": float("nan")})


def test_get_readiness_reports_watch_after_minimum_telemetry() -> None:
    runtime = WorldBridgeRuntime()
    session = runtime.create_session(
        WorldBridgeSessionCreateRequest(
            robot_name=TEST_ROBOT_NAME,
            planner_id=TEST_PLANNER_ID,
            task_id=TEST_TASK_ID,
            adapter_id=TEST_ADAPTER_ID,
        )
    )

    for index in range(READINESS_MIN_TRANSITIONS_FOR_WATCH):
        runtime.apply_joint_command(
            session_id=session.session_id,
            req=WorldBridgeJointCommandRequest(
                joint_positions={"joint_a": TEST_JOINT_A_POSITION + index},
                planner_id=TEST_PLANNER_ID,
                rollout_mode=WorldBridgeRolloutMode.LIVE,
            ),
        )

    readiness = runtime.get_readiness()
    assert readiness.decision == WorldBridgeReadinessDecision.WATCH
    assert readiness.metrics.total_transitions == READINESS_MIN_TRANSITIONS_FOR_WATCH


def test_external_proxy_telemetry_uses_session_robot_mapping() -> None:
    runtime = WorldBridgeRuntime()
    proxy_session_id = "wbs-proxy-session"
    runtime.record_external_session_create(
        WorldBridgeSessionCreateRequest(
            robot_name=TEST_ROBOT_NAME,
            planner_id=TEST_PLANNER_ID,
            task_id=TEST_TASK_ID,
            adapter_id=TEST_ADAPTER_ID,
        ),
        session_id=proxy_session_id,
    )

    runtime.record_external_joint_command(
        session_id=proxy_session_id,
        robot_name=None,
        req=WorldBridgeJointCommandRequest(
            joint_positions={"joint_a": TEST_JOINT_A_POSITION},
            planner_id=TEST_PLANNER_ID,
            rollout_mode=WorldBridgeRolloutMode.LIVE,
        ),
    )

    readiness = runtime.get_readiness()
    assert readiness.metrics.unique_robot_count == 1
    assert readiness.metrics.total_joint_commands == 1


def test_session_snapshot_includes_attestation_summary() -> None:
    runtime = WorldBridgeRuntime()
    attestation_status_store.upsert(
        AttestationStatusUpsertRequest(
            robot_id=TEST_ROBOT_NAME,
            trust_state=AttestationTrustState.VERIFIED,
            reason="Hardware profile matches baseline.",
            expires_at=utc_now() + timedelta(minutes=5),
        )
    )
    session = runtime.create_session(WorldBridgeSessionCreateRequest(robot_name=TEST_ROBOT_NAME))
    snapshot = runtime.get_session(session.session_id)

    assert snapshot.attestation is not None
    assert snapshot.attestation.effective_trust_state == AttestationTrustState.VERIFIED
    assert snapshot.attestation.control_allowed is True
    assert snapshot.attestation.reason == "Hardware profile matches baseline."


def teardown_function() -> None:
    attestation_status_store._statuses.clear()
