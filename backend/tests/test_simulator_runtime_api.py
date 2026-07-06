from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import uuid
from types import SimpleNamespace
from typing import cast, get_args
from unittest.mock import patch

import pytest

pytest.importorskip("httpx")

from httpx import ASGITransport, AsyncClient

from backend.app import create_app
from backend.api import simulator_runtime as simulator_runtime_api
from backend.api import workspace_transfer as workspace_transfer_api
from backend.core.simulator_security import SIMULATOR_TOKEN_HEADER
import backend.services.simulator_adapters as simulator_adapters_service
from backend.services import workspace_transfer as workspace_transfer_service
from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SimulatorId,
    SimulatorRuntimeDependency,
    SimulatorRuntimeStatus,
    WorkspaceChangeSetApplyRequest,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.models.workspace_transfer import WorkspaceLaunchCancelResponse, WorkspaceOpenResponse
from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters import (
    SUPPORTED_SIMULATOR_IDS,
    WORKSPACE_SIMULATOR_IDS,
    get_simulator_adapter,
    get_simulator_runtime_status,
    list_simulator_runtime_descriptors,
    list_simulator_runtime_specs,
    normalize_simulator_workspace_change_set_request,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapterError,
    SimulatorCapabilityError,
)
from backend.services.simulator_adapters.blender_change_sets import build_blender_change_set_source
from backend.services.simulator_adapters.camera_conventions import (
    world_camera_to_opengl_camera_rotation,
)
from backend.services.simulator_adapters.params import (
    SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID,
    SIMULATOR_SCENE_PARAMS_BY_ID,
    get_simulator_scene_params_by_id,
    get_simulator_workspace_process_params_by_id,
)
from backend.services.simulator_adapters.plugin import DirectUrdfSimulatorPlugin, get_plugin
from backend.services.world_scene_package_digest import (
    computed_world_snapshot_digest,
    declared_world_snapshot_digests,
)
from backend.services.world_scene_package_params import WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1


TEST_SIMULATOR_TOKEN = "sim-token"
TEST_BASE_URL = "http://testserver"
TEST_CLIENT_HOST = "127.0.0.1"
TEST_CLIENT_PORT = 8001


def _operator_headers() -> dict[str, str]:
    return {SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN}


def _patch_security_settings():
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=TEST_SIMULATOR_TOKEN),
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
        "schema_version": WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
        "package_id": "demo_world",
        "version": "1.0.0",
        "title": "Demo World",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
        "runtime_targets": [],
        "interface": {
            "observation_modalities": ["state"],
            "action_semantics": "joint_position",
            "timestep_ms": 10,
            "frame_convention": "ros-rep-103",
        },
        "artifacts": [],
        "world_snapshot": {
            "urdf_xml": "<robot name=\"demo\"><link name=\"base\"/></robot>",
            "joint_positions": {},
            "cameras": [],
            "objects": [],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
        "provenance": {},
        "security": {
            "signature_ref": None,
            "attestation_refs": [],
            "sbom_ref": None,
        },
    }


def _thin_world_package_payload() -> dict:
    payload = _world_package_payload()
    return {
        "package_id": payload["package_id"],
        "version": payload["version"],
        "provenance": payload["provenance"],
        "artifacts": payload["artifacts"],
        "world": {
            "name": payload["title"],
            "urdf_xml": payload["world_snapshot"]["urdf_xml"],
            "joint_positions": payload["world_snapshot"]["joint_positions"],
            "cameras": payload["world_snapshot"]["cameras"],
            "objects": payload["world_snapshot"]["objects"],
            "scenario_time_ms": payload["world_snapshot"]["scenario_time_ms"],
            "scenario_duration_ms": payload["world_snapshot"]["scenario_duration_ms"],
            "environment": {
                "frame_convention": payload["interface"]["frame_convention"],
            },
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
    next_changes = list(changes)
    review_only_entries = list(review_only or [])
    changed_camera_ids = {
        str(change.get("stable_id", ""))
        for change in next_changes
        if change.get("entity_type") == "camera"
    }
    deleted_camera_ids = {
        str(entry.get("stable_id", ""))
        for entry in review_only_entries
        if entry.get("entity_type") == "deleted_camera"
    }
    for camera in world_package_payload["world_snapshot"].get("cameras", []):
        camera_id = str(camera.get("id", ""))
        if (
            camera_id
            and camera_id not in changed_camera_ids
            and camera_id not in deleted_camera_ids
        ):
            next_changes.append(_blender_camera_change_payload(camera_id))
    return {
        "schema": "urdf-studio.blender-change-set.v1",
        "source": _blender_change_set_source_payload(world_package_payload),
        "changes": next_changes,
        "review_only": review_only_entries,
    }


def test_world_registry_publish_and_get_version_roundtrip_thin_envelopes() -> None:
    payload = _thin_world_package_payload()
    unique_suffix = uuid.uuid4().hex[:8]
    payload["package_id"] = f"demo_world_registry_api_{unique_suffix}"
    payload["version"] = f"1.0.{int(unique_suffix[:2], 16)}"
    with _patch_security_settings():
        publish_response = asyncio.run(
            _request_json(
                "POST",
                "/worlds/packages",
                headers=_operator_headers(),
                json=payload,
            )
        )

        assert publish_response.status_code == 200
        assert publish_response.json()["package_id"] == payload["package_id"]

        version_response = asyncio.run(
            _request_json(
                "GET",
                f"/worlds/packages/{payload['package_id']}/versions/{payload['version']}",
                headers=_operator_headers(),
            )
        )

        assert version_response.status_code == 200
        version_payload = version_response.json()
        assert version_payload["manifest"]["package_id"] == payload["package_id"]
        assert version_payload["manifest"]["world"]["name"] == "Demo World"
        assert "runtime_targets" not in version_payload["manifest"]
        assert "security" not in version_payload["manifest"]


def test_world_registry_validate_accepts_legacy_manifest_payloads() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/worlds/packages/validate",
                headers=_operator_headers(),
                json=_world_package_payload(),
            )
        )

        assert response.status_code == 200
        assert response.json()["valid"] is True


def _blender_camera_change_payload(stable_id: str) -> dict:
    quat_xyzw = world_camera_to_opengl_camera_rotation().as_quat()
    return {
        "entity_type": "camera",
        "stable_id": stable_id,
        "position_xyz": [0.0, 0.0, 1.0],
        "quat_wxyz": [
            float(quat_xyzw[3]),
            float(quat_xyzw[0]),
            float(quat_xyzw[1]),
            float(quat_xyzw[2]),
        ],
        "fov_deg": 60.0,
        "pose_frame": "opengl_render_local",
    }


def test_simulator_registry_covers_literal_ids() -> None:
    simulator_runtime_specs = list_simulator_runtime_specs()
    assert set(SUPPORTED_SIMULATOR_IDS) == set(get_args(SimulatorId))
    assert [spec.simulator_id for spec in simulator_runtime_specs] == list(SUPPORTED_SIMULATOR_IDS)
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
        "newton": "physics_simulator",
        "blender": "authoring_tool",
        "robosplatter": "renderer",
    }

    for spec in list_simulator_runtime_specs():
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
        for spec in list_simulator_runtime_specs()
        if spec.capabilities_model().workspace_target and spec.transfer.transfer_strategy != "planned"
    }
    process_backed_simulator_ids = {
        simulator_id
        for simulator_id in openable_simulator_ids
        if get_plugin(simulator_id).workspace_process is not None
    }
    scene_param_simulator_ids = {
        simulator_id
        for simulator_id in openable_simulator_ids
        if hasattr(get_plugin(simulator_id), "scene_params")
    }

    assert openable_simulator_ids == set(WORKSPACE_SIMULATOR_IDS)
    assert process_backed_simulator_ids == set(SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID)
    assert scene_param_simulator_ids == set(SIMULATOR_SCENE_PARAMS_BY_ID)
    assert SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID is get_simulator_workspace_process_params_by_id()
    assert SIMULATOR_SCENE_PARAMS_BY_ID is get_simulator_scene_params_by_id()

    for simulator_id in process_backed_simulator_ids:
        assert get_simulator_adapter(simulator_id).capabilities.workspace_target
        workspace_process = SIMULATOR_WORKSPACE_PROCESS_PARAMS_BY_ID[simulator_id]

        assert get_plugin(simulator_id).require_workspace_process() is workspace_process
        assert workspace_process.ready_log_marker
        assert workspace_process.ready_timeout_sec > 0

    for simulator_id in scene_param_simulator_ids:
        scene_params = SIMULATOR_SCENE_PARAMS_BY_ID[simulator_id]
        if hasattr(scene_params, "viewer_step_hz"):
            assert scene_params.viewer_step_hz > 0
        if hasattr(scene_params, "gravity_xyz"):
            assert len(scene_params.gravity_xyz) == 3


def test_plugin_require_workspace_process_reports_missing_config() -> None:
    class MissingWorkspaceProcessPlugin(DirectUrdfSimulatorPlugin):
        _abstract = True
        simulator_id = "pybullet"
        label = "Missing process"
        robot_asset_format = "urdf"
        transfer_strategy = "direct"

    plugin = MissingWorkspaceProcessPlugin()

    with pytest.raises(
        SimulatorCapabilityError,
        match="Missing process is missing workspace process configuration.",
    ):
        plugin.require_workspace_process()


def test_get_plugin_reports_unsupported_simulator() -> None:
    with pytest.raises(
        SimulatorCapabilityError,
        match="Unsupported simulator: definitely-not-a-simulator",
    ):
        get_plugin(cast(SimulatorId, "definitely-not-a-simulator"))


def test_mjlab_workspace_status_uses_mujoco_workspace_dependency(monkeypatch) -> None:
    from backend.services.simulator_adapters import base as simulator_adapter_base

    def fake_is_python_module_available(import_name: str) -> bool:
        return import_name == "mujoco"

    monkeypatch.setattr(
        simulator_adapter_base,
        "is_python_module_available",
        fake_is_python_module_available,
    )

    status = get_simulator_runtime_status("mjlab")

    assert status.available is True
    assert status.status == "ready"
    assert [
        (dependency.name, dependency.available, dependency.required, dependency.scope)
        for dependency in status.dependencies
    ] == [
        ("mujoco", True, True, "workspace"),
        ("warp", False, False, "validation"),
        ("mujoco_warp", False, False, "validation"),
        ("mjlab", False, False, "validation"),
    ]


def test_simulator_runtime_status_can_probe_external_python(monkeypatch) -> None:
    from backend.services.simulator_adapters import base as simulator_adapter_base

    observed: list[tuple[str, str]] = []

    def fake_is_python_module_available_in_python(
        python_executable: str,
        import_name: str,
    ) -> bool:
        observed.append((python_executable, import_name))
        return import_name == "mujoco"

    monkeypatch.setenv("STUDIO_MJLAB_PYTHON", "/opt/mjlab-env/bin/python")
    monkeypatch.setattr(
        simulator_adapter_base,
        "is_python_module_available_in_python",
        fake_is_python_module_available_in_python,
    )

    status = get_simulator_runtime_status("mjlab")

    assert status.available is True
    assert observed == [
        ("/opt/mjlab-env/bin/python", "mujoco"),
        ("/opt/mjlab-env/bin/python", "warp"),
    ]


def test_pybullet_runtime_status_reports_degraded_software_opengl(monkeypatch) -> None:
    from backend.services.simulator_adapters import base as simulator_adapter_base
    from backend.services.simulator_adapters import pybullet as pybullet_adapter

    monkeypatch.setattr(
        simulator_adapter_base,
        "is_python_module_available",
        lambda import_name: import_name == "pybullet",
    )
    monkeypatch.setattr(
        pybullet_adapter,
        "pybullet_runtime_opengl_warnings",
        lambda **_kwargs: ("PyBullet GUI is using software OpenGL.",),
    )

    status = get_simulator_runtime_status("pybullet")

    assert status.available is True
    assert status.status == "ready, display degraded: software OpenGL"
    assert (
        "hardware OpenGL",
        False,
        False,
        "runtime",
    ) in [
        (
            dependency.name,
            dependency.available,
            dependency.required,
            dependency.scope,
        )
        for dependency in status.dependencies
    ]


def test_pybullet_runtime_status_keeps_single_hardware_opengl_dependency(monkeypatch) -> None:
    from backend.models.simulator_runtime import SimulatorRuntimeDependency, SimulatorRuntimeStatus
    from backend.services.simulator_adapters import pybullet as pybullet_adapter
    from backend.services.simulator_adapters.plugin import DirectUrdfSimulatorPlugin

    monkeypatch.setattr(
        DirectUrdfSimulatorPlugin,
        "runtime_status",
        lambda self: SimulatorRuntimeStatus(
            runtimeName="pybullet",
            available=True,
            status="ready",
            dependencies=[
                SimulatorRuntimeDependency(
                    name="pybullet",
                    available=True,
                    required=True,
                    scope="workspace",
                ),
                SimulatorRuntimeDependency(
                    name="hardware OpenGL",
                    available=False,
                    required=False,
                    scope="runtime",
                ),
            ],
        ),
    )
    monkeypatch.setattr(
        pybullet_adapter,
        "pybullet_runtime_opengl_warnings",
        lambda **_kwargs: ("PyBullet GUI is using software OpenGL.",),
    )

    status = pybullet_adapter.PyBulletPlugin().runtime_status()

    assert status.status == "ready, display degraded: software OpenGL"
    assert [
        dependency.name for dependency in status.dependencies
        if dependency.name == "hardware OpenGL"
    ] == ["hardware OpenGL"]


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
    blender = next(simulator for simulator in simulators if simulator["simulatorId"] == "blender")
    assert blender["targetKind"] == "authoring_tool"
    assert blender["capabilities"]["layoutRoundTrip"] is True


def test_list_workspace_transfer_targets_returns_capability_descriptors() -> None:
    with _patch_security_settings():
        response = asyncio.run(
            _request_json("GET", "/workspace-transfer/targets", headers=_operator_headers())
        )

    assert response.status_code == 200
    targets = response.json()["targets"]
    assert [target["targetId"] for target in targets] == list(SUPPORTED_SIMULATOR_IDS)
    assert targets[0]["targetKind"] == "physics_simulator"
    blender = next(target for target in targets if target["targetId"] == "blender")
    assert blender["targetKind"] == "authoring_tool"
    assert blender["capabilities"]["layoutRoundTrip"] is True


def test_workspace_transfer_targets_match_simulator_runtime_descriptors() -> None:
    with _patch_security_settings():
        simulator_response = asyncio.run(
            _request_json("GET", "/simulators", headers=_operator_headers())
        )
        transfer_response = asyncio.run(
            _request_json("GET", "/workspace-transfer/targets", headers=_operator_headers())
        )

    assert simulator_response.status_code == 200
    assert transfer_response.status_code == 200
    simulators = simulator_response.json()["simulators"]
    targets = transfer_response.json()["targets"]

    assert [
        {
            "targetId": simulator["simulatorId"],
            "label": simulator["label"],
            "targetKind": simulator["targetKind"],
            "capabilities": simulator["capabilities"],
            "transferPolicy": simulator["transferPolicy"],
        }
        for simulator in simulators
    ] == targets


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
            workspace_warnings=["simulator diagnostic"],
            world_object_count=5,
            camera_count=3,
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
    assert response.json()["workspace_warnings"] == ["simulator diagnostic"]
    assert response.json()["world_object_count"] == 5
    assert response.json()["camera_count"] == 3
    assert captured == {
        "simulator_id": "genesis",
        "request_title": "Demo World",
    }


def test_simulator_workspace_prepare_refreshes_stale_world_snapshot_digest(
    monkeypatch,
) -> None:
    def fake_prepare_simulator_workspace(simulator_id, request):
        assert declared_world_snapshot_digests(request.world_package) == (
            computed_world_snapshot_digest(request.world_package),
        )
        return SimulatorWorkspacePrepareResponse(
            simulator_id=simulator_id,
            started=True,
            pid=1234,
            command=["python", "-m", "sim"],
            log_path="/tmp/sim.log",
            world_package_path="/tmp/world.json",
            robot_urdf_path="/tmp/robot.urdf",
            world_object_count=2,
            camera_count=1,
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
                json=_open_request_payload_with_bad_world_snapshot_digest(),
            )
        )

    assert response.status_code == 200
    assert response.json()["simulator_id"] == "genesis"


def test_blender_workspace_prepare_refreshes_stale_world_snapshot_digest(
    monkeypatch,
) -> None:
    def fake_prepare_simulator_workspace(simulator_id, request):
        assert simulator_id == "blender"
        assert declared_world_snapshot_digests(request.world_package) == (
            computed_world_snapshot_digest(request.world_package),
        )
        return SimulatorWorkspacePrepareResponse(
            simulator_id=simulator_id,
            started=True,
            pid=1234,
            command=["python", "-m", "sim"],
            log_path="/tmp/blender.log",
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
                "/simulators/blender/workspace/prepare",
                headers=_operator_headers(),
                json=_open_request_payload_with_bad_world_snapshot_digest(),
            )
        )

    assert response.status_code == 200
    assert response.json()["simulator_id"] == "blender"


def test_simulator_workspace_change_set_request_refreshes_stale_world_snapshot_digest() -> None:
    world_package_payload = _world_package_with_layout_object_payload()
    change_set = _blender_change_set_payload(
        world_package_payload,
        changes=[],
    )
    world_package_payload["artifacts"] = [
        {
            "kind": "world_snapshot",
            "digest_sha256": "0" * 64,
            "uri": "inline://snapshot",
        }
    ]
    request = WorkspaceChangeSetApplyRequest(
        world_package=WorldScenePackageManifest.model_validate(world_package_payload),
        change_set=change_set,
    )

    normalized = normalize_simulator_workspace_change_set_request(request)

    assert declared_world_snapshot_digests(normalized.world_package) == (
        computed_world_snapshot_digest(normalized.world_package),
    )


def test_workspace_requests_accept_thin_world_registry_envelopes() -> None:
    thin_world_package = _thin_world_package_payload()

    prepare_request = SimulatorWorkspacePrepareRequest.model_validate(
        {
            "world_package": thin_world_package,
            "urdf_asset_path": "robot.urdf",
            "mesh_assets": [],
            "package_roots": {},
        }
    )
    change_set_request = WorkspaceChangeSetApplyRequest.model_validate(
        {
            "world_package": thin_world_package,
            "change_set": {
                "schema": "urdf-studio.blender-change-set.v1",
                "changes": [],
                "review_only": [],
            },
        }
    )

    assert prepare_request.world_package.title == "Demo World"
    assert prepare_request.world_package.interface.frame_convention == "ros-rep-103"
    assert change_set_request.world_package.title == "Demo World"


def test_workspace_transfer_open_delegates_to_selected_adapter(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_open_workspace_transfer_target(target_id, request):
        captured["target_id"] = target_id
        captured["request_title"] = request.world_package.world.name
        captured["launch_id"] = request.launch_id
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

    payload = _open_request_payload()
    payload["launch_id"] = "launch-123"
    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/workspace-transfer/targets/genesis/open",
                headers=_operator_headers(),
                json=payload,
            )
        )

    assert response.status_code == 200
    assert response.json()["targetId"] == "genesis"
    assert response.json()["pid"] == 1234
    assert captured == {
        "target_id": "genesis",
        "request_title": "Demo World",
        "launch_id": "launch-123",
    }


def test_workspace_transfer_cancel_launch_delegates_to_launch_registry(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_cancel_workspace_transfer_target_launch(target_id, launch_id):
        captured["target_id"] = target_id
        captured["launch_id"] = launch_id
        return WorkspaceLaunchCancelResponse(
            targetId=target_id,
            launchId=launch_id,
            cancelled=True,
            processStopped=True,
            pid=1234,
        )

    monkeypatch.setattr(
        workspace_transfer_api,
        "cancel_workspace_transfer_target_launch",
        fake_cancel_workspace_transfer_target_launch,
    )

    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/workspace-transfer/targets/genesis/launches/launch-123/cancel",
                headers=_operator_headers(),
            )
        )

    assert response.status_code == 200
    assert response.json() == {
        "targetId": "genesis",
        "launchId": "launch-123",
        "cancelled": True,
        "processStopped": True,
        "pid": 1234,
    }
    assert captured == {
        "target_id": "genesis",
        "launch_id": "launch-123",
    }


def test_workspace_transfer_open_refreshes_stale_world_snapshot_digest(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_prepare_simulator_workspace(simulator_id, request):
        captured["simulator_id"] = simulator_id
        captured["declared_digests"] = declared_world_snapshot_digests(request.world_package)
        captured["actual_digest"] = computed_world_snapshot_digest(request.world_package)
        return SimulatorWorkspacePrepareResponse(
            simulator_id=simulator_id,
            started=True,
            pid=1234,
            command=["python", "-m", "sim"],
            log_path="/tmp/sim.log",
            world_package_path="/tmp/world.json",
            robot_urdf_path="/tmp/robot.urdf",
            workspace_warnings=["PyBullet GUI is using software OpenGL."],
            world_object_count=2,
            camera_count=1,
        )

    monkeypatch.setattr(
        workspace_transfer_service,
        "prepare_simulator_workspace",
        fake_prepare_simulator_workspace,
    )

    with _patch_security_settings():
        response = asyncio.run(
            _request_json(
                "POST",
                "/workspace-transfer/targets/blender/open",
                headers=_operator_headers(),
                json=_open_request_payload_with_bad_world_snapshot_digest(),
            )
        )

    assert response.status_code == 200
    assert captured["simulator_id"] == "blender"
    assert captured["declared_digests"] == (captured["actual_digest"],)
    assert response.json()["workspaceWarnings"] == [
        "PyBullet GUI is using software OpenGL."
    ]
    assert response.json()["worldObjectCount"] == 2
    assert response.json()["cameraCount"] == 1


def test_workspace_transfer_status_delegates_to_target_registry(monkeypatch) -> None:
    def fake_get_simulator_runtime_status(simulator_id):
        return SimulatorRuntimeStatus(
            runtimeName=simulator_id,
            available=True,
            status="ready",
            dependencies=[SimulatorRuntimeDependency(name="genesis", available=True)],
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
        "dependencies": [
            {
                "name": "genesis",
                "available": True,
                "required": True,
                "scope": "workspace",
            }
        ],
    }


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


def test_simulator_workspace_prepare_rejects_unavailable_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnavailableWorkspacePlugin:
        simulator_id = "pybullet"
        label = "PyBullet"
        workspace_target = True
        transfer_strategy = "direct"

        def runtime_status(self) -> SimulatorRuntimeStatus:
            return SimulatorRuntimeStatus(
                runtimeName="pybullet",
                available=False,
                status="Missing optional dependency: pybullet",
                dependencies=[],
            )

        def prepare_workspace(self, _request):
            raise AssertionError("prepare_workspace must not run for unavailable runtimes")

    monkeypatch.setattr(
        simulator_adapters_service,
        "get_plugin",
        lambda _simulator_id: UnavailableWorkspacePlugin(),
    )
    request = SimulatorWorkspacePrepareRequest.model_validate(_open_request_payload())

    with pytest.raises(SimulatorAdapterError) as exc_info:
        simulator_adapters_service.prepare_simulator_workspace("pybullet", request)

    assert exc_info.value.status_code == 503
    assert "PyBullet runtime unavailable on this machine" in str(exc_info.value)


def test_non_workspace_target_simulators_are_registered_but_not_openable() -> None:
    descriptors = list_simulator_runtime_descriptors().simulators
    non_workspace_target_ids = [
        descriptor.simulator_id
        for descriptor in descriptors
        if not descriptor.capabilities.workspace_target
    ]

    assert non_workspace_target_ids == [
        "sapien2",
        "sapien3",
        "isaacsim",
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
                    ),
                },
            )
        )

    assert response.status_code == 200
    payload = response.json()
    updated_object = payload["world_package"]["world"]["objects"][0]
    assert payload["targetId"] == "blender"
    assert payload["world_package"]["world"]["environment"]["frame_convention"] == "ros-rep-103"
    assert updated_object["position_xyz"] == [1.0, 2.0, 3.0]
    assert updated_object["rotation_rpy_rad"] == [0.0, 0.0, 0.0]
    assert updated_object["size_xyz"] == [0.5, 0.6, 0.7]
    assert payload["appliedChangeCount"] == 2
    assert payload["reviewOnlyCount"] == 0


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
