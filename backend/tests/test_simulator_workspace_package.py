from __future__ import annotations

import json

from backend.models.simulator_runtime import SimulatorWorkspacePrepareRequest
from backend.models.world_scene_package import WorldArtifactRef, WorldRuntimeTarget
from backend.services.simulator_adapters.workspace_package import (
    prepare_simulator_workspace_package,
)
from backend.services.world_scene_package_digest import (
    computed_world_snapshot_digest,
    declared_world_snapshot_digests,
)
from backend.tests.simulator_adapter_test_utils import make_world_package


def test_prepare_simulator_workspace_refreshes_stale_world_snapshot_digest(
    tmp_path,
) -> None:
    world_package = make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>")
    world_package.artifacts = [
        WorldArtifactRef(
            kind="world_snapshot",
            digest_sha256="0" * 64,
            uri="inline://snapshot",
        )
    ]
    request = SimulatorWorkspacePrepareRequest(world_package=world_package)

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )
    staged_payload = json.loads(prepared.world_package_path.read_text(encoding="utf-8"))
    staged_world_package = world_package.model_validate(staged_payload)

    assert declared_world_snapshot_digests(staged_world_package) == (
        computed_world_snapshot_digest(staged_world_package),
    )


def test_prepare_simulator_workspace_normalizes_xacro_source_path(tmp_path) -> None:
    urdf_xml = "<robot name=\"demo\"><link name=\"base\"/></robot>"
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
        urdf_asset_path="robot.urdf.xacro",
    )

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    assert (prepared.workspace_dir / "source" / "robot.urdf").read_text(
        encoding="utf-8"
    ) == urdf_xml
    assert prepared.robot_urdf_path.name == "robot.urdf"


def test_prepare_simulator_workspace_writes_schema_compatible_world_package(tmp_path) -> None:
    world_package = make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>")
    world_package.runtime_targets = [WorldRuntimeTarget(name="blender", mode="python")]
    request = SimulatorWorkspacePrepareRequest(world_package=world_package)

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    payload = json.loads(prepared.world_package_path.read_text(encoding="utf-8"))
    assert "description" not in payload
    assert payload["runtime_targets"] == [{"name": "blender", "mode": "python"}]


def test_prepare_simulator_workspace_records_scene_counts(tmp_path) -> None:
    world_package = make_world_package(
        "<robot name=\"demo\"><link name=\"base\"/></robot>",
        objects=[
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.0, 0.0, 0.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.1, 0.2, 0.3],
                "color": "#22c55e",
            }
        ],
    )
    world_package.world_snapshot.cameras = [
        {
            "id": "cam",
            "name": "Camera",
            "link_name": "base",
            "pose": {"xyz": [0.0, 0.0, 1.0], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 320, "height": 240, "fov_deg": 60.0},
        }
    ]
    request = SimulatorWorkspacePrepareRequest(world_package=world_package)

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    assert prepared.world_object_count == 1
    assert prepared.camera_count == 1
