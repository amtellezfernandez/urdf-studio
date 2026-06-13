from __future__ import annotations

import asyncio
from http import HTTPStatus
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import backend.api.world_bridge as world_bridge_api
from backend.models.attestation import AttestationStatusUpsertRequest, AttestationTrustState
from backend.services.attestation import attestation_status_store
from backend.world_bridge.types import (
    WorldBridgeCommandAck,
    WorldBridgeReadinessDecision,
    WorldBridgeReadinessMetrics,
    WorldBridgeReadinessResponse,
    WorldBridgeJointCommandRequest,
    WorldBridgeSessionCreateRequest,
    WorldBridgeStatusResponse,
)
from backend.world_bridge.worldd_client import WorlddHttpError, WorlddUnavailableError


TEST_RUNTIME_ACTIVE_SESSIONS = 1
TEST_WORLDD_ACTIVE_SESSIONS = 2
TEST_SCENARIO_DURATION_MS = 12_000


def _run_api(coro):
    return asyncio.run(coro)


class RuntimeStub:
    def __init__(self, active_sessions: int) -> None:
        self._active_sessions = active_sessions

    def get_status(self) -> WorldBridgeStatusResponse:
        return WorldBridgeStatusResponse(active_sessions=self._active_sessions)

    def list_sessions(self):
        return []

    def get_readiness(self) -> WorldBridgeReadinessResponse:
        return WorldBridgeReadinessResponse(
            decision=WorldBridgeReadinessDecision.NO_GO,
            checks_passed=[],
            blockers=["no telemetry"],
            metrics=WorldBridgeReadinessMetrics(
                total_sessions=0,
                total_joint_commands=0,
                total_scenario_time_updates=0,
                total_transitions=0,
                unique_robot_count=0,
                unique_planner_count=0,
                unique_task_count=0,
                unique_adapter_count=0,
                counterfactual_transition_count=0,
                live_rollout_transition_count=0,
            ),
        )

    def resolve_robot_name(self, _session_id: str) -> str | None:
        return None


class RuntimeMutatingFallbackGuardStub(RuntimeStub):
    def create_session(self, _req: WorldBridgeSessionCreateRequest):
        raise AssertionError("Mutating fallback should not execute")


class RuntimeSessionStub(RuntimeStub):
    def __init__(self, active_sessions: int, robot_name: str) -> None:
        super().__init__(active_sessions=active_sessions)
        self._robot_name = robot_name

    def resolve_robot_name(self, _session_id: str) -> str | None:
        return self._robot_name

    def apply_joint_command(
        self, _session_id: str, _req: WorldBridgeJointCommandRequest
    ) -> WorldBridgeCommandAck:
        return WorldBridgeCommandAck(
            session_id="session-1",
            accepted=True,
            applied_joint_count=1,
            scenario_time_ms=0,
            command_sequence=1,
        )


class WorlddStatusStub:
    def __init__(self, active_sessions: int) -> None:
        self._active_sessions = active_sessions

    def get_status(self) -> WorldBridgeStatusResponse:
        return WorldBridgeStatusResponse(
            service="worldd-world-bridge",
            runtime_mode="rust-data-plane",
            active_sessions=self._active_sessions,
        )


class WorlddUnavailableStatusStub:
    def get_status(self) -> WorldBridgeStatusResponse:
        raise WorlddUnavailableError("offline")


class WorlddUnavailableCreateSessionStub:
    def create_session(self, _req: WorldBridgeSessionCreateRequest):
        raise WorlddUnavailableError("offline")


class WorlddUnavailableListSessionsStub:
    def list_sessions(self):
        raise WorlddUnavailableError("offline")


class WorlddCreateSessionHttpErrorStub:
    def create_session(self, _req: WorldBridgeSessionCreateRequest):
        raise WorlddHttpError(
            status_code=int(HTTPStatus.BAD_REQUEST),
            detail="invalid request",
        )


def _set_proxy_state(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    monkeypatch.setattr(
        world_bridge_api,
        "settings",
        SimpleNamespace(world_bridge_use_worldd_proxy=enabled),
    )


def test_status_uses_worldd_when_proxy_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )
    monkeypatch.setattr(
        world_bridge_api,
        "worldd_client",
        WorlddStatusStub(active_sessions=TEST_WORLDD_ACTIVE_SESSIONS),
    )

    status = _run_api(world_bridge_api.get_world_bridge_status())

    assert status.active_sessions == TEST_WORLDD_ACTIVE_SESSIONS
    assert status.runtime_mode == "rust-data-plane"


def test_status_falls_back_to_runtime_when_worldd_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )
    monkeypatch.setattr(
        world_bridge_api,
        "worldd_client",
        WorlddUnavailableStatusStub(),
    )

    status = _run_api(world_bridge_api.get_world_bridge_status())

    assert status.active_sessions == TEST_RUNTIME_ACTIVE_SESSIONS
    assert status.runtime_mode == "python-control-plane"


def test_proxy_maps_worldd_bad_request_to_unprocessable_entity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "worldd_client",
        WorlddCreateSessionHttpErrorStub(),
    )

    with pytest.raises(HTTPException) as exc_info:
        _run_api(
            world_bridge_api.create_world_bridge_session(
                WorldBridgeSessionCreateRequest(
                    robot_name="so101",
                    scenario_duration_ms=TEST_SCENARIO_DURATION_MS,
                )
            )
        )

    assert exc_info.value.status_code == int(HTTPStatus.UNPROCESSABLE_ENTITY)


def test_proxy_disabled_uses_runtime_without_worldd(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=False)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )
    monkeypatch.setattr(
        world_bridge_api,
        "worldd_client",
        WorlddUnavailableStatusStub(),
    )

    status = _run_api(world_bridge_api.get_world_bridge_status())

    assert status.active_sessions == TEST_RUNTIME_ACTIVE_SESSIONS


def test_mutating_request_returns_503_when_worldd_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeMutatingFallbackGuardStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )
    monkeypatch.setattr(
        world_bridge_api,
        "worldd_client",
        WorlddUnavailableCreateSessionStub(),
    )

    with pytest.raises(HTTPException) as exc_info:
        _run_api(
            world_bridge_api.create_world_bridge_session(
                WorldBridgeSessionCreateRequest(
                    robot_name="so101",
                    scenario_duration_ms=TEST_SCENARIO_DURATION_MS,
                )
            )
        )

    assert exc_info.value.status_code == int(HTTPStatus.SERVICE_UNAVAILABLE)


def test_list_sessions_returns_503_when_worldd_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )
    monkeypatch.setattr(
        world_bridge_api,
        "worldd_client",
        WorlddUnavailableListSessionsStub(),
    )

    with pytest.raises(HTTPException) as exc_info:
        _run_api(world_bridge_api.list_world_bridge_sessions())

    assert exc_info.value.status_code == int(HTTPStatus.SERVICE_UNAVAILABLE)


def test_readiness_endpoint_reads_runtime_control_plane(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )

    readiness = _run_api(world_bridge_api.get_world_bridge_readiness())

    assert readiness.decision == WorldBridgeReadinessDecision.NO_GO


def test_readiness_assert_raises_conflict_when_minimum_not_met(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )

    with pytest.raises(HTTPException) as exc_info:
        _run_api(
            world_bridge_api.assert_world_bridge_readiness(
                WorldBridgeReadinessDecision.WATCH
            )
        )

    assert exc_info.value.status_code == int(HTTPStatus.CONFLICT)


def test_readiness_assert_returns_payload_when_minimum_met(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=True)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS),
    )

    readiness = _run_api(
        world_bridge_api.assert_world_bridge_readiness(
            WorldBridgeReadinessDecision.NO_GO
        )
    )

    assert readiness.decision == WorldBridgeReadinessDecision.NO_GO


def test_joint_command_requires_attestation_when_proxy_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=False)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeSessionStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS, robot_name="so101"),
    )

    with pytest.raises(HTTPException) as exc_info:
        _run_api(
            world_bridge_api.apply_world_bridge_joint_command(
                "session-1",
                WorldBridgeJointCommandRequest(joint_positions={"joint_a": 0.5}),
            )
        )

    assert exc_info.value.status_code == 412


def test_joint_command_allows_verified_attestation_when_proxy_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_proxy_state(monkeypatch, enabled=False)
    monkeypatch.setattr(
        world_bridge_api,
        "runtime",
        RuntimeSessionStub(active_sessions=TEST_RUNTIME_ACTIVE_SESSIONS, robot_name="so101"),
    )
    attestation_status_store.upsert(
        AttestationStatusUpsertRequest(
            robot_id="so101",
            trust_state=AttestationTrustState.VERIFIED,
        )
    )

    ack = _run_api(
        world_bridge_api.apply_world_bridge_joint_command(
            "session-1",
            WorldBridgeJointCommandRequest(joint_positions={"joint_a": 0.5}),
        )
    )

    assert ack.accepted is True


def teardown_function() -> None:
    attestation_status_store._statuses.clear()
