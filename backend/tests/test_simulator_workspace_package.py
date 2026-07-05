from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.models.simulator_runtime import (
    SimulatorMeshAssetUpload,
    SimulatorWorkspacePrepareRequest,
    validate_simulator_relative_path,
)
from backend.models.world_scene_package import WorldArtifactRef, WorldRuntimeTarget
from backend.services.ilu_session import IluSessionError
from backend.services.ilu_urdf import BundleMeshAssetsResult
from backend.services.simulator_adapters.workspace_package import (
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.workspace_paths import workspace_asset_roots
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
        "~/crate.stl",
        "~user/crate.stl",
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


def test_prepare_simulator_workspace_normalizes_root_relative_mesh_refs(
    monkeypatch,
    tmp_path,
) -> None:
    urdf_xml = """
    <robot name="demo">
      <link name="base">
        <visual>
          <geometry>
            <mesh filename="/meshes/base.stl"/>
          </geometry>
        </visual>
      </link>
    </robot>
    """
    observed: dict[str, str] = {}

    def fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        observed["urdf_xml"] = urdf_xml
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(tmp_path / "assets"),
            copied_files=1,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.bundle_mesh_assets_for_urdf_file",
        fake_bundle_mesh_assets_for_urdf_file,
    )

    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
        mesh_assets=[
            SimulatorMeshAssetUpload(
                path="meshes/base.stl",
                aliases=[],
                content_base64="AA==",
            )
        ],
    )

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    assert 'filename="meshes/base.stl"' in observed["urdf_xml"]
    assert 'filename="/meshes/base.stl"' not in observed["urdf_xml"]
    assert 'filename="meshes/base.stl"' in prepared.robot_urdf_path.read_text(
        encoding="utf-8"
    )


def test_prepare_simulator_workspace_normalizes_flat_root_relative_mesh_refs(
    monkeypatch,
    tmp_path,
) -> None:
    urdf_xml = """
    <robot name="demo">
      <link name="base">
        <visual>
          <geometry>
            <mesh filename="/base.stl"/>
          </geometry>
        </visual>
      </link>
    </robot>
    """
    observed: dict[str, str] = {}

    def fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        observed["urdf_xml"] = urdf_xml
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(tmp_path / "assets"),
            copied_files=1,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.bundle_mesh_assets_for_urdf_file",
        fake_bundle_mesh_assets_for_urdf_file,
    )

    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
        mesh_assets=[
            SimulatorMeshAssetUpload(
                path="base.stl",
                aliases=[],
                content_base64="AA==",
            )
        ],
    )

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    assert 'filename="base.stl"' in observed["urdf_xml"]
    assert 'filename="/base.stl"' not in observed["urdf_xml"]
    assert 'filename="base.stl"' in prepared.robot_urdf_path.read_text(encoding="utf-8")


def test_prepare_simulator_workspace_persists_shared_asset_roots(
    monkeypatch,
    tmp_path,
) -> None:
    observed: dict[str, list[str]] = {}

    def fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        observed["extra_search_roots"] = extra_search_roots or []
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(tmp_path / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.bundle_mesh_assets_for_urdf_file",
        fake_bundle_mesh_assets_for_urdf_file,
    )

    request = SimulatorWorkspacePrepareRequest(
        world_package=_minimal_world_package(),
        package_roots={"demo_description": ["robot_description"]},
    )

    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=tmp_path,
        error=ValueError,
    )

    scene_roots = workspace_asset_roots(prepared.world_package_path, prepared.robot_urdf_path)
    assert tuple(Path(root) for root in observed["extra_search_roots"]) == scene_roots
    assert prepared.workspace_dir / "source" in scene_roots
    assert prepared.workspace_dir / "source" / "robot_description" in scene_roots
    assert prepared.robot_urdf_path.parent in scene_roots


def test_prepare_simulator_workspace_ignores_ilu_sessions_without_local_source(
    monkeypatch,
    tmp_path,
) -> None:
    def fake_get_ilu_session_local_urdf_source_context(_session_id: str):
        raise IluSessionError(status_code=404, detail="ilu session has no local asset source.")

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.get_ilu_session_local_urdf_source_context",
        fake_get_ilu_session_local_urdf_source_context,
    )

    prepared = prepare_simulator_workspace_package(
        SimulatorWorkspacePrepareRequest(
            world_package=_minimal_world_package(),
            ilu_session_id="demo-session",
        ),
        workspace_root=tmp_path,
        error=ValueError,
    )

    assert prepared.robot_urdf_path.exists()


def test_prepare_simulator_workspace_surfaces_ilu_session_lookup_errors(
    monkeypatch,
    tmp_path,
) -> None:
    def fake_get_ilu_session_local_urdf_source_context(_session_id: str):
        raise IluSessionError(status_code=404, detail="ilu session not found: demo-session")

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.get_ilu_session_local_urdf_source_context",
        fake_get_ilu_session_local_urdf_source_context,
    )

    with pytest.raises(ValueError, match="ilu session not found: demo-session"):
        prepare_simulator_workspace_package(
            SimulatorWorkspacePrepareRequest(
                world_package=_minimal_world_package(),
                ilu_session_id="demo-session",
            ),
            workspace_root=tmp_path,
            error=ValueError,
        )

    assert list(tmp_path.iterdir()) == []


def test_prepare_simulator_workspace_removes_partial_workspace_on_bundle_error(
    monkeypatch,
    tmp_path,
) -> None:
    def fail_bundle_mesh_assets_for_urdf_file(**_kwargs) -> BundleMeshAssetsResult:
        raise RuntimeError("bundle exploded")

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.bundle_mesh_assets_for_urdf_file",
        fail_bundle_mesh_assets_for_urdf_file,
    )

    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(
            """
            <robot name="demo">
              <link name="base">
                <visual>
                  <geometry>
                    <mesh filename="/base.stl"/>
                  </geometry>
                </visual>
              </link>
            </robot>
            """
        ),
        mesh_assets=[
            SimulatorMeshAssetUpload(
                path="base.stl",
                aliases=[],
                content_base64="AA==",
            )
        ],
    )

    with pytest.raises(RuntimeError, match="bundle exploded"):
        prepare_simulator_workspace_package(
            request,
            workspace_root=tmp_path,
            error=ValueError,
        )

    assert list(tmp_path.iterdir()) == []


def test_prepare_simulator_workspace_removes_partial_workspace_on_source_root_error(
    monkeypatch,
    tmp_path,
) -> None:
    original_mkdir = Path.mkdir

    def fail_source_root_mkdir(self: Path, *args, **kwargs) -> None:
        if self.name == "source" and self.parent.parent == tmp_path:
            raise OSError("source root exploded")
        original_mkdir(self, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", fail_source_root_mkdir)

    with pytest.raises(OSError, match="source root exploded"):
        prepare_simulator_workspace_package(
            SimulatorWorkspacePrepareRequest(world_package=_minimal_world_package()),
            workspace_root=tmp_path,
            error=ValueError,
        )

    assert list(tmp_path.iterdir()) == []


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


def test_prepare_simulator_workspace_exposes_materialized_robot_urdf_xml(
    monkeypatch,
    tmp_path,
) -> None:
    urdf_xml = """
    <robot name="demo">
      <material name="painted_red">
        <color rgba="0.8 0.1 0.1 1.0"/>
      </material>
      <link name="base">
        <visual>
          <geometry>
            <box size="0.1 0.1 0.1"/>
          </geometry>
          <material name="painted_red"/>
        </visual>
      </link>
    </robot>
    """

    def fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(tmp_path / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        "backend.services.simulator_adapters.workspace_package.bundle_mesh_assets_for_urdf_file",
        fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = prepare_simulator_workspace_package(
        SimulatorWorkspacePrepareRequest(world_package=make_world_package(urdf_xml)),
        workspace_root=tmp_path,
        error=ValueError,
    )

    prepared_file_xml = prepared.robot_urdf_path.read_text(encoding="utf-8")
    assert '<color rgba="0.8 0.1 0.1 1.0"' in prepared_file_xml
    assert prepared.robot_urdf_xml == prepared_file_xml
