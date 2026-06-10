from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import get_args
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app
from backend.api import simulator_runtime as simulator_runtime_api
from backend.core.simulator_security import SIMULATOR_TOKEN_HEADER
from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SIMULATOR_RUNTIME_SPECS,
    SimulatorId,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenResponse,
)
from backend.services.simulator_adapters import (
    SUPPORTED_SIMULATOR_IDS,
    get_simulator_adapter,
    list_simulator_runtime_descriptors,
)
from backend.services.simulator_adapters.params import (
    SIMULATOR_LAUNCH_PARAMS_BY_ID,
    SIMULATOR_SCENE_PARAMS_BY_ID,
)


TEST_SIMULATOR_TOKEN = "sim-token"


def _operator_headers() -> dict[str, str]:
    return {SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN}


def _patch_security_settings():
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=TEST_SIMULATOR_TOKEN, cam_to_sim_proxy_token=None),
    )


def _world_package_payload() -> dict:
    return {
        "package_id": "demo_world",
        "version": "1.0.0",
        "title": "Demo World",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
        "interface": {
            "observation_modalities": ["state"],
            "action_semantics": "joint_position",
            "timestep_ms": 10,
            "frame_convention": "ros-rep-103",
        },
        "world_snapshot": {
            "urdf_xml": "<robot name=\"demo\"><link name=\"base\"/></robot>",
            "joint_positions": {},
            "objects": [],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
    }


def _open_request_payload() -> dict:
    return {
        "world_package": _world_package_payload(),
        "urdf_asset_path": "robot.urdf",
        "mesh_assets": [],
        "package_roots": {},
    }


def test_simulator_registry_covers_literal_ids() -> None:
    assert set(SUPPORTED_SIMULATOR_IDS) == set(get_args(SimulatorId))
    assert [spec.simulator_id for spec in SIMULATOR_RUNTIME_SPECS] == list(SUPPORTED_SIMULATOR_IDS)
    descriptors = list_simulator_runtime_descriptors().simulators

    assert [descriptor.simulator_id for descriptor in descriptors] == list(SUPPORTED_SIMULATOR_IDS)
    for simulator_id in SUPPORTED_SIMULATOR_IDS:
        adapter = get_simulator_adapter(simulator_id)
        assert adapter.simulator_id == simulator_id
        assert adapter.label
        assert adapter.capabilities is not None


def test_simulator_registry_declares_transfer_policy_for_each_backend() -> None:
    expected_robot_asset_formats = {
        "genesis": "urdf",
        "mjlab": "mjcf",
        "mujoco": "mjcf",
        "mjx": "mjx_mjcf",
        "pybullet": "urdf",
        "sapien2": "urdf",
        "sapien3": "urdf",
        "isaacsim": "usd",
        "isaacgym": "urdf",
        "newton": "mjcf",
        "blender": "usd",
        "robosplatter": "native",
    }

    for spec in SIMULATOR_RUNTIME_SPECS:
        assert spec.transfer.frame_convention == SIMULATOR_CANONICAL_FRAME_CONVENTION
        assert spec.transfer.robot_asset_format == expected_robot_asset_formats[spec.simulator_id]
        if spec.capabilities_model().world_viewer:
            assert spec.transfer.launch_strategy in {"direct", "convert"}
        else:
            assert spec.transfer.launch_strategy == "planned"


def test_openable_simulator_runtime_params_are_centralized() -> None:
    openable_simulator_ids = {
        spec.simulator_id
        for spec in SIMULATOR_RUNTIME_SPECS
        if spec.capabilities_model().world_viewer and spec.transfer.launch_strategy != "planned"
    }

    assert openable_simulator_ids == set(SIMULATOR_LAUNCH_PARAMS_BY_ID)
    assert openable_simulator_ids == set(SIMULATOR_SCENE_PARAMS_BY_ID)

    for simulator_id in openable_simulator_ids:
        launch_params = SIMULATOR_LAUNCH_PARAMS_BY_ID[simulator_id]
        scene_params = SIMULATOR_SCENE_PARAMS_BY_ID[simulator_id]

        assert launch_params.ready_log_marker
        assert launch_params.ready_timeout_sec > 0
        if hasattr(scene_params, "viewer_step_hz"):
            assert scene_params.viewer_step_hz > 0
        if hasattr(scene_params, "gravity_xyz"):
            assert len(scene_params.gravity_xyz) == 3


def test_list_simulator_runtimes_returns_capability_descriptors() -> None:
    with _patch_security_settings():
        response = TestClient(app).get("/simulators", headers=_operator_headers())

    assert response.status_code == 200
    simulators = response.json()["simulators"]
    assert [simulator["simulatorId"] for simulator in simulators] == list(SUPPORTED_SIMULATOR_IDS)
    assert simulators[0]["capabilities"] == {
        "worldViewer": True,
        "motionValidation": False,
    }
    assert simulators[1]["capabilities"] == {
        "worldViewer": True,
        "motionValidation": True,
    }
    assert simulators[0]["transferPolicy"] == {
        "robotAssetFormat": "urdf",
        "sceneAssetFormat": "urdf",
        "frameConvention": SIMULATOR_CANONICAL_FRAME_CONVENTION,
        "launchStrategy": "direct",
    }
    assert simulators[1]["transferPolicy"]["robotAssetFormat"] == "mjcf"
    assert simulators[1]["transferPolicy"]["launchStrategy"] == "convert"
    assert simulators[4]["simulatorId"] == "pybullet"
    assert simulators[4]["capabilities"]["worldViewer"] is True
    assert simulators[4]["transferPolicy"]["launchStrategy"] == "direct"


def test_simulator_world_open_delegates_to_selected_adapter(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_launch_simulator_world(simulator_id, request):
        captured["simulator_id"] = simulator_id
        captured["request_title"] = request.world_package.title
        return SimulatorWorldOpenResponse(
            simulator_id=simulator_id,
            started=True,
            pid=1234,
            command=["python", "-m", "sim"],
            log_path="/tmp/sim.log",
            world_package_path="/tmp/world.json",
            robot_urdf_path="/tmp/robot.urdf",
        )

    monkeypatch.setattr(
        simulator_runtime_api,
        "launch_simulator_world",
        fake_launch_simulator_world,
    )

    with _patch_security_settings():
        response = TestClient(app).post(
            "/simulators/genesis/world/open",
            headers=_operator_headers(),
            json=_open_request_payload(),
        )

    assert response.status_code == 200
    assert response.json()["simulator_id"] == "genesis"
    assert response.json()["pid"] == 1234
    assert captured == {
        "simulator_id": "genesis",
        "request_title": "Demo World",
    }


def test_optional_simulator_world_open_reports_missing_launcher() -> None:
    with _patch_security_settings():
        response = TestClient(app).post(
            "/simulators/sapien2/world/open",
            headers=_operator_headers(),
            json=_open_request_payload(),
        )

    assert response.status_code == 501
    assert "not available yet" in response.json()["detail"]


def test_non_world_viewer_simulators_are_registered_but_not_openable() -> None:
    descriptors = list_simulator_runtime_descriptors().simulators
    non_world_viewer_ids = [
        descriptor.simulator_id
        for descriptor in descriptors
        if not descriptor.capabilities.world_viewer
    ]

    assert non_world_viewer_ids == [
        "mjx",
        "sapien2",
        "sapien3",
        "isaacsim",
        "isaacgym",
        "newton",
        "blender",
        "robosplatter",
    ]

    with _patch_security_settings():
        client = TestClient(app)
        for simulator_id in non_world_viewer_ids:
            response = client.post(
                f"/simulators/{simulator_id}/world/open",
                headers=_operator_headers(),
                json=_open_request_payload(),
            )

            assert response.status_code == 501
            assert "not available yet" in response.json()["detail"]


def test_simulator_runtime_status_uses_adapter_registry(monkeypatch) -> None:
    def fake_get_simulator_runtime_status(simulator_id):
        return SimulatorRuntimeStatus(
            runtimeName=simulator_id,
            available=True,
            status="ready",
            dependencies=[],
        )

    monkeypatch.setattr(
        simulator_runtime_api,
        "get_simulator_runtime_status",
        fake_get_simulator_runtime_status,
    )

    with _patch_security_settings():
        response = TestClient(app).get(
            "/simulators/genesis/runtime",
            headers=_operator_headers(),
        )

    assert response.status_code == 200
    assert response.json() == {
        "runtimeName": "genesis",
        "available": True,
        "status": "ready",
        "dependencies": [],
    }
