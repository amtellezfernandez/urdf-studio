from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import get_args
from unittest.mock import patch

import pytest

pytest.importorskip("httpx")

from httpx import ASGITransport, AsyncClient

from backend.app import create_app
from backend.api import simulator_runtime as simulator_runtime_api
from backend.api import workspace_transfer as workspace_transfer_api
from backend.core.simulator_security import SIMULATOR_TOKEN_HEADER
from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SIMULATOR_RUNTIME_SPECS,
    SimulatorId,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareResponse,
)
from backend.models.workspace_transfer import WorkspaceOpenResponse
from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters import (
    SUPPORTED_SIMULATOR_IDS,
    get_simulator_adapter,
    list_simulator_runtime_descriptors,
)
from backend.services.simulator_adapters.blender_workspace import build_blender_change_set_source
from backend.services.simulator_adapters.params import (
    SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID,
    SIMULATOR_SCENE_PARAMS_BY_ID,
)


TEST_SIMULATOR_TOKEN = "sim-token"
TEST_BASE_URL = "http://testserver"
TEST_CLIENT_HOST = "127.0.0.1"
TEST_CLIENT_PORT = 8001


def _operator_headers() -> dict[str, str]:
    return {SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN}


def _patch_security_settings():
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=TEST_SIMULATOR_TOKEN, cam_to_sim_proxy_token=None),
    )


async def _request_json(
    method: str,
    path: str,
    *,
    client_host: str = TEST_CLIENT_HOST,
    **kwargs,
):
    transport = ASGITransport(
        app=create_app(),
        client=(client_host, TEST_CLIENT_PORT),
    )
    async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as client:
        return await client.request(method, path, **kwargs)


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


def _open_request_payload_with_bad_world_snapshot_digest() -> dict:
    payload = _open_request_payload()
    payload["world_package"]["artifacts"] = [
        {
            "kind": "world_snapshot",
            "digest_sha256": "0" * 64,
            "uri": "inline://snapshot",
        }
    ]
    return payload


def _world_package_with_layout_object_payload() -> dict:
    payload = _world_package_payload()
    payload["world_snapshot"]["objects"] = [
        {
            "id": "crate",
            "name": "Crate",
            "type": "cube",
            "position_xyz": [0.0, 0.0, 0.0],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.2, 0.3, 0.4],
            "color": "#22c55e",
        }
    ]
    payload["world_snapshot"]["cameras"] = [
        {
            "id": "scene-camera",
            "name": "Scene camera",
            "parent_joint": "base",
            "pose": {"xyz": [0.0, 0.0, 1.0], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 60.0},
        }
    ]
    return payload


def _blender_change_set_source_payload(world_package_payload: dict) -> dict:
    world_package = WorldScenePackageManifest.model_validate(world_package_payload)
    return build_blender_change_set_source(
        world_package,
        world_object_ids=[
            str(item.get("id", ""))
            for item in world_package_payload["world_snapshot"].get("objects", [])
        ],
        camera_ids=[
            str(item.get("id", ""))
            for item in world_package_payload["world_snapshot"].get("cameras", [])
        ],
    )


def _blender_change_set_payload(
    world_package_payload: dict,
    *,
    changes: list[dict],
    review_only: list[dict] | None = None,
) -> dict:
    return {
        "schema": "urdf-studio.blender-change-set.v1",
        "source": _blender_change_set_source_payload(world_package_payload),
        "changes": changes,
        "review_only": review_only or [],
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
        "blender": "native",
        "robosplatter": "native",
    }
    expected_target_kinds = {
        "genesis": "physics_simulator",
        "mjlab": "physics_simulator",
        "mujoco": "physics_simulator",
        "mjx": "physics_simulator",
        "pybullet": "physics_simulator",
        "sapien2": "physics_simulator",
        "sapien3": "physics_simulator",
        "isaacsim": "physics_simulator",
        "isaacgym": "physics_simulator",
        "newton": "physics_simulator",
        "blender": "authoring_tool",
        "robosplatter": "renderer",
    }

    for spec in SIMULATOR_RUNTIME_SPECS:
        assert spec.target_kind == expected_target_kinds[spec.simulator_id]
        assert spec.transfer.frame_convention == SIMULATOR_CANONICAL_FRAME_CONVENTION
        assert spec.transfer.robot_asset_format == expected_robot_asset_formats[spec.simulator_id]
        if spec.capabilities_model().workspace_target:
            assert spec.transfer.transfer_strategy in {"direct", "convert"}
        else:
            assert spec.transfer.transfer_strategy == "planned"


def test_openable_simulator_runtime_params_are_centralized() -> None:
    openable_simulator_ids = {
        spec.simulator_id
        for spec in SIMULATOR_RUNTIME_SPECS
        if spec.capabilities_model().workspace_target and spec.transfer.transfer_strategy != "planned"
    }

    assert openable_simulator_ids == set(SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID)
    assert openable_simulator_ids == set(SIMULATOR_SCENE_PARAMS_BY_ID)

    for simulator_id in openable_simulator_ids:
        workspace_process = SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID[simulator_id]
        scene_params = SIMULATOR_SCENE_PARAMS_BY_ID[simulator_id]

        assert workspace_process.ready_log_marker
        assert workspace_process.ready_timeout_sec > 0
        if hasattr(scene_params, "viewer_step_hz"):
            assert scene_params.viewer_step_hz > 0
        if hasattr(scene_params, "gravity_xyz"):
            assert len(scene_params.gravity_xyz) == 3


def test_list_simulator_runtimes_returns_capability_descriptors() -> None:
    with _patch_security_settings():
        response = asyncio.run(_request_json("GET", "/simulators", headers=_operator_headers()))

    assert response.status_code == 200
    simulators = response.json()["simulators"]
    assert [simulator["simulatorId"] for simulator in simulators] == list(SUPPORTED_SIMULATOR_IDS)
    assert simulators[0]["capabilities"] == {
        "workspaceTarget": True,
        "motionValidation": False,
        "layoutRoundTrip": False,
    }
    assert simulators[0]["targetKind"] == "physics_simulator"
    assert simulators[1]["capabilities"] == {
        "workspaceTarget": True,
        "motionValidation": True,
        "layoutRoundTrip": False,
    }
    assert simulators[1]["targetKind"] == "physics_simulator"
    assert simulators[0]["transferPolicy"] == {
        "robotAssetFormat": "urdf",
        "sceneAssetFormat": "urdf",
        "frameConvention": SIMULATOR_CANONICAL_FRAME_CONVENTION,
        "transferStrategy": "direct",
    }
    assert simulators[1]["transferPolicy"]["robotAssetFormat"] == "mjcf"
    assert simulators[1]["transferPolicy"]["transferStrategy"] == "convert"
    assert simulators[4]["simulatorId"] == "pybullet"
    assert simulators[4]["capabilities"]["workspaceTarget"] is True
    assert simulators[4]["transferPolicy"]["transferStrategy"] == "direct"
    assert simulators[10]["simulatorId"] == "blender"
    assert simulators[10]["targetKind"] == "authoring_tool"
    assert simulators[10]["capabilities"]["layoutRoundTrip"] is True


def test_list_workspace_transfer_targets_returns_capability_descriptors() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json("GET", "/workspace-transfer/targets", headers=_operator_headers())
        )

    assert response.status_code == 200
    targets = response.json()["targets"]
    assert [target["targetId"] for target in targets] == list(SUPPORTED_SIMULATOR_IDS)
    assert targets[0]["targetKind"] == "physics_simulator"
    assert targets[10]["targetId"] == "blender"
    assert targets[10]["targetKind"] == "authoring_tool"
    assert targets[10]["capabilities"]["layoutRoundTrip"] is True


def test_simulator_runtime_routes_require_token_for_remote_clients() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "GET",
                "/simulators",
                client_host="192.168.1.10",
            )
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Simulator API token required for remote simulator access."


def test_workspace_transfer_routes_require_token_for_remote_clients() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "GET",
                "/workspace-transfer/targets",
                client_host="192.168.1.10",
            )
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Simulator API token required for remote simulator access."


def test_simulator_workspace_prepare_delegates_to_selected_adapter(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_prepare_simulator_workspace(simulator_id, request):
        captured["simulator_id"] = simulator_id
        captured["request_title"] = request.world_package.title
        return SimulatorWorkspacePrepareResponse(
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
        "prepare_simulator_workspace",
        fake_prepare_simulator_workspace,
    )

    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/genesis/workspace/prepare",
                headers=_operator_headers(),
                json=_open_request_payload(),
            )
        )

    assert response.status_code == 200
    assert response.json()["simulator_id"] == "genesis"
    assert response.json()["pid"] == 1234
    assert captured == {
        "simulator_id": "genesis",
        "request_title": "Demo World",
    }


def test_simulator_workspace_prepare_rejects_mismatched_world_snapshot_digest() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/genesis/workspace/prepare",
                headers=_operator_headers(),
                json=_open_request_payload_with_bad_world_snapshot_digest(),
            )
        )

    assert response.status_code == 422
    assert "world_snapshot" in response.json()["detail"]


def test_blender_workspace_prepare_validates_package_before_runtime_detection() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/blender/workspace/prepare",
                headers=_operator_headers(),
                json=_open_request_payload_with_bad_world_snapshot_digest(),
            )
        )

    assert response.status_code == 422
    assert "world_snapshot" in response.json()["detail"]


def test_workspace_transfer_open_delegates_to_selected_adapter(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_open_workspace_transfer_target(target_id, request):
        captured["target_id"] = target_id
        captured["request_title"] = request.world_package.title
        return WorkspaceOpenResponse(
            targetId=target_id,
            started=True,
            pid=1234,
            command=["python", "-m", "sim"],
            logPath="/tmp/sim.log",
            worldPackagePath="/tmp/world.json",
            robotUrdfPath="/tmp/robot.urdf",
        )

    monkeypatch.setattr(
        workspace_transfer_api,
        "open_workspace_transfer_target",
        fake_open_workspace_transfer_target,
    )

    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/workspace-transfer/targets/genesis/open",
                headers=_operator_headers(),
                json=_open_request_payload(),
            )
        )

    assert response.status_code == 200
    assert response.json()["targetId"] == "genesis"
    assert response.json()["pid"] == 1234
    assert captured == {
        "target_id": "genesis",
        "request_title": "Demo World",
    }


def test_workspace_transfer_status_delegates_to_target_registry(monkeypatch) -> None:
    def fake_get_simulator_runtime_status(simulator_id):
        return SimulatorRuntimeStatus(
            runtimeName=simulator_id,
            available=True,
            status="ready",
            dependencies=[],
        )

    monkeypatch.setattr(
        "backend.services.workspace_transfer.get_simulator_runtime_status",
        fake_get_simulator_runtime_status,
    )

    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "GET",
                "/workspace-transfer/targets/genesis/status",
                headers=_operator_headers(),
            )
        )

    assert response.status_code == 200
    assert response.json() == {
        "targetId": "genesis",
        "available": True,
        "status": "ready",
        "dependencies": [],
    }


def test_workspace_transfer_runtime_route_remains_compatible(monkeypatch) -> None:
    def fake_get_simulator_runtime_status(simulator_id):
        return SimulatorRuntimeStatus(
            runtimeName=simulator_id,
            available=True,
            status="ready",
            dependencies=[],
        )

    monkeypatch.setattr(
        "backend.services.workspace_transfer.get_simulator_runtime_status",
        fake_get_simulator_runtime_status,
    )

    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "GET",
                "/workspace-transfer/targets/genesis/runtime",
                headers=_operator_headers(),
            )
        )

    assert response.status_code == 200
    assert response.json()["targetId"] == "genesis"


def test_optional_simulator_workspace_prepare_reports_missing_adapter() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/sapien2/workspace/prepare",
                headers=_operator_headers(),
                json=_open_request_payload(),
            )
        )

    assert response.status_code == 501
    assert "workspace adapter is planned" in response.json()["detail"]


def test_non_workspace_target_simulators_are_registered_but_not_openable() -> None:
    descriptors = list_simulator_runtime_descriptors().simulators
    non_workspace_target_ids = [
        descriptor.simulator_id
        for descriptor in descriptors
        if not descriptor.capabilities.workspace_target
    ]

    assert non_workspace_target_ids == [
        "mjx",
        "sapien2",
        "sapien3",
        "isaacsim",
        "isaacgym",
        "newton",
        "robosplatter",
    ]

    with _patch_security_settings():
        for simulator_id in non_workspace_target_ids:
            response = asyncio.run(
                _request_json(
                    "POST",
                    f"/simulators/{simulator_id}/workspace/prepare",
                    headers=_operator_headers(),
                    json=_open_request_payload(),
                )
            )

            assert response.status_code == 501
            assert "workspace adapter is planned" in response.json()["detail"]


def test_apply_blender_layout_change_set_updates_world_objects() -> None:
    world_package = _world_package_with_layout_object_payload()
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/workspace-transfer/change-set/apply",
                headers=_operator_headers(),
                json={
                    "world_package": world_package,
                    "change_set": _blender_change_set_payload(
                        world_package,
                        changes=[
                            {
                                "entity_type": "world_object",
                                "stable_id": "crate",
                                "position_xyz": [1.0, 2.0, 3.0],
                                "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                                "size_xyz": [0.5, 0.6, 0.7],
                            }
                        ],
                        review_only=[
                            {
                                "entity_type": "camera",
                                "stable_id": "scene-camera",
                            }
                        ],
                    ),
                },
            )
        )

    assert response.status_code == 200
    payload = response.json()
    updated_object = payload["world_package"]["world_snapshot"]["objects"][0]
    assert payload["targetId"] == "blender"
    assert updated_object["position_xyz"] == [1.0, 2.0, 3.0]
    assert updated_object["rotation_rpy_rad"] == [0.0, 0.0, 0.0]
    assert updated_object["size_xyz"] == [0.5, 0.6, 0.7]
    assert payload["appliedChangeCount"] == 1
    assert payload["reviewOnlyCount"] == 1


def test_apply_workspace_change_set_rejects_unsupported_schema() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/workspace-transfer/change-set/apply",
                headers=_operator_headers(),
                json={
                    "world_package": _world_package_with_layout_object_payload(),
                    "change_set": {
                        "schema": "not-blender",
                        "changes": [],
                    },
                },
            )
        )

    assert response.status_code == 501
    assert "Unsupported workspace change-set schema" in response.json()["detail"]


def test_schema_routed_change_set_import_is_not_exposed_under_simulators() -> None:
    world_package = _world_package_with_layout_object_payload()
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/workspace/change-set/apply",
                headers=_operator_headers(),
                json={
                    "world_package": world_package,
                    "change_set": _blender_change_set_payload(
                        world_package,
                        changes=[],
                        review_only=[
                            {
                                "entity_type": "camera",
                                "stable_id": "scene-camera",
                            }
                        ],
                    ),
                },
            )
        )

    assert response.status_code == 404


def test_apply_blender_layout_change_set_rejects_invalid_schema() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/blender/workspace/change-set/apply",
                headers=_operator_headers(),
                json={
                    "world_package": _world_package_with_layout_object_payload(),
                    "change_set": {
                        "schema": "not-blender",
                        "changes": [],
                    },
                },
            )
        )

    assert response.status_code == 422
    assert "Unsupported Blender change-set schema" in response.json()["detail"]


def test_apply_workspace_change_set_reports_unsupported_target() -> None:
    world_package = _world_package_with_layout_object_payload()
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/simulators/genesis/workspace/change-set/apply",
                headers=_operator_headers(),
                json={
                    "world_package": world_package,
                    "change_set": _blender_change_set_payload(world_package, changes=[]),
                },
            )
        )

    assert response.status_code == 501
    assert "workspace change-set import is not supported" in response.json()["detail"]


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
        response = asyncio.run(
            _request_json(
                "GET",
                "/simulators/genesis/runtime",
                headers=_operator_headers(),
            )
        )

    assert response.status_code == 200
    assert response.json() == {
        "runtimeName": "genesis",
        "available": True,
        "status": "ready",
        "dependencies": [],
    }
