from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from backend.models.simulator_runtime import (
    SimulatorMeshAssetUpload,
    SimulatorWorkspacePrepareRequest,
    validate_simulator_relative_path,
)
from backend.models.world_scene_package import WorldArtifactRef, WorldRuntimeTarget
from backend.services.simulator_adapters.workspace_package import (
    _write_asset_file,
    prepare_simulator_workspace_package,
)
from backend.services.world_scene_package_digest import (
    computed_world_snapshot_digest,
    declared_world_snapshot_digests,
)
from backend.tests.simulator_adapter_test_utils import make_world_package


def _minimal_world_package():
    return make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>")


def test_simulator_relative_path_normalizes_safe_relative_segments() -> None:
    assert (
        validate_simulator_relative_path("./assets//meshes/./crate.stl", "mesh asset path")
        == "assets/meshes/crate.stl"
    )
    assert (
        validate_simulator_relative_path("assets\\meshes\\crate.stl", "mesh asset path")
        == "assets/meshes/crate.stl"
    )


@pytest.mark.parametrize(
    "path",
    (
        "/tmp/crate.stl",
        "\\\\server\\share\\crate.stl",
        "C:\\tmp\\crate.stl",
        "assets/../crate.stl",
        ".",
        "./",
    ),
)
def test_simulator_relative_path_rejects_host_or_empty_paths(path: str) -> None:
    with pytest.raises(ValueError):
        validate_simulator_relative_path(path, "mesh asset path")


def test_workspace_prepare_request_rejects_absolute_uploaded_asset_path() -> None:
    with pytest.raises(ValidationError, match="mesh asset path must be relative"):
        SimulatorWorkspacePrepareRequest(
            world_package=_minimal_world_package(),
            mesh_assets=[
                SimulatorMeshAssetUpload(
                    path="/tmp/crate.stl",
                    aliases=[],
                    content_base64="AA==",
                )
            ],
        )


def test_workspace_prepare_request_rejects_absolute_urdf_asset_path() -> None:
    with pytest.raises(ValidationError, match="URDF asset path must be relative"):
        SimulatorWorkspacePrepareRequest(
            world_package=_minimal_world_package(),
            urdf_asset_path="/tmp/robot.urdf",
        )


def test_write_asset_file_rejects_absolute_asset_path(tmp_path) -> None:
    with pytest.raises(ValueError, match="asset path must be relative"):
        _write_asset_file(
            tmp_path,
            "/tmp/crate.stl",
            b"solid crate\nendsolid crate\n",
            error=ValueError,
        )


def test_prepare_simulator_workspace_refreshes_stale_world_snapshot_digest(
    tmp_path,
) -> None:
    world_package = _minimal_world_package()
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


@pytest.mark.parametrize(
    ("urdf_asset_path", "staged_relative_path"),
    (
        ("robot.urdf.xacro", "robot.urdf"),
        ("robot.xacro", "robot.urdf"),
        ("robots/demo.urdf.xacro", "robots/demo.urdf"),
        ("robots/demo.xacro", "robots/demo.urdf"),
    ),
)
def test_prepare_simulator_workspace_normalizes_xacro_source_path(
    tmp_path,
    urdf_asset_path: str,
    staged_relative_path: str,
) -> None:
    urdf_xml = "<robot name=\"demo\"><link name=\"base\"/></robot>"
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
        urdf_asset_path=urdf_asset_path,
    )

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    assert (prepared.workspace_dir / "source" / staged_relative_path).read_text(
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
            },
            {
                "id": "hidden-crate",
                "name": "Hidden Crate",
                "type": "cube",
                "position_xyz": [1.0, 1.0, 1.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.1, 0.2, 0.3],
                "color": "#111827",
                "is_hidden": True,
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
