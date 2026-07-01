from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_SAPIEN_ID,
    SimulatorId,
    SimulatorMeshAssetUpload,
    SimulatorWorkspacePrepareRequest,
)
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldRuntimeTarget,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.world_scene_package_params import WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1
from backend.services.world_scene_package_digest import (
    normalize_and_require_world_snapshot_artifact_digests,
)

WORKSPACE_SIMULATORS: tuple[SimulatorId, ...] = (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_SAPIEN_ID,
    SIMULATOR_BLENDER_ID,
)
WORKSPACE_FIXTURES = (
    "demo",
    "studio-y-up-axis",
    "mesh-asset",
    "hidden-object",
    "xacro-source",
)
MESH_ASSET_FIXTURE_PATH = "assets/workspace_mesh_crate.obj"
MESH_ASSET_FIXTURE_OBJ = """\
o workspace_mesh_crate
v -0.5 -0.5 -0.5
v 0.5 -0.5 -0.5
v 0.5 0.5 -0.5
v -0.5 0.5 -0.5
v -0.5 -0.5 0.5
v 0.5 -0.5 0.5
v 0.5 0.5 0.5
v -0.5 0.5 0.5
f 1 2 3
f 1 3 4
f 5 8 7
f 5 7 6
f 1 5 6
f 1 6 2
f 2 6 7
f 2 7 3
f 3 7 8
f 3 8 4
f 4 8 5
f 4 5 1
"""
DEMO_URDF_XML = """\
<?xml version="1.0"?>
<robot name="workspace_demo">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.08" rpy="0 0 0"/>
      <geometry>
        <box size="0.32 0.24 0.16"/>
      </geometry>
      <material name="base_green">
        <color rgba="0.2 0.55 0.45 1"/>
      </material>
    </visual>
    <collision>
      <origin xyz="0 0 0.08" rpy="0 0 0"/>
      <geometry>
        <box size="0.32 0.24 0.16"/>
      </geometry>
    </collision>
    <inertial>
      <mass value="1"/>
      <inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/>
    </inertial>
  </link>
  <link name="tool_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.06"/>
      </geometry>
      <material name="tool_yellow">
        <color rgba="0.95 0.72 0.2 1"/>
      </material>
    </visual>
    <collision>
      <geometry>
        <sphere radius="0.06"/>
      </geometry>
    </collision>
    <inertial>
      <mass value="0.2"/>
      <inertia ixx="0.001" ixy="0" ixz="0" iyy="0.001" iyz="0" izz="0.001"/>
    </inertial>
  </link>
  <joint name="lift_joint" type="revolute">
    <parent link="base_link"/>
    <child link="tool_link"/>
    <origin xyz="0 0 0.24" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.57" upper="1.57" effort="5" velocity="1"/>
  </joint>
</robot>
"""
DEMO_CAMERAS: list[dict] = []
DEMO_OBJECTS = [
    {
        "id": "table_block",
        "name": "Table block",
        "type": "cube",
        "position_xyz": [0.65, 0.0, 0.12],
        "rotation_rpy_rad": [0.0, 0.0, 0.0],
        "size_xyz": [0.28, 0.28, 0.24],
        "color": "#2563eb",
        "source": "user",
    }
]
WORKSPACE_ASSET_IGNORED_DIR_NAMES = frozenset(
    {
        ".cache",
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "__pycache__",
        "node_modules",
    }
)
WORKSPACE_TRANSFER_ASSET_FILENAMES = frozenset({"package.xml"})
WORKSPACE_TRANSFER_ASSET_SUFFIXES = frozenset(
    {
        ".bin",
        ".bmp",
        ".dae",
        ".glb",
        ".gltf",
        ".jpeg",
        ".jpg",
        ".mtl",
        ".obj",
        ".ply",
        ".png",
        ".stl",
        ".tga",
        ".usd",
        ".usda",
        ".usdc",
        ".webp",
    }
)


def build_demo_workspace_request() -> SimulatorWorkspacePrepareRequest:
    world_package = WorldScenePackageManifest(
        schema_version=WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
        package_id="demo-simulator-workspaces-check",
        version="1.0.0",
        title="Demo Simulator Workspace Check",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[
            WorldRuntimeTarget(name=simulator_id, mode="python")
            for simulator_id in WORKSPACE_SIMULATORS
        ],
        interface=WorldInterfaceSpec(
            observation_modalities=["state", "rgb"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        artifacts=[],
        world_snapshot=WorldSnapshot(
            urdf_xml=DEMO_URDF_XML,
            joint_positions={},
            cameras=DEMO_CAMERAS,
            objects=DEMO_OBJECTS,
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
        provenance={
            "workspace_check_fixture": "demo",
        },
        security={"attestation_refs": []},
    )
    return SimulatorWorkspacePrepareRequest(
        world_package=world_package,
        urdf_asset_path="robot.urdf",
        mesh_assets=[],
    )


def build_studio_y_up_axis_workspace_request() -> SimulatorWorkspacePrepareRequest:
    request = build_demo_workspace_request()
    world_package = request.world_package.model_copy(deep=True)
    world_package.package_id = "studio-y-up-axis-workspace-check"
    world_package.title = "Studio Y-Up Axis Workspace Check"
    world_package.interface.frame_convention = "studio-y-up"
    world_package.interface.observation_modalities = ["state"]
    world_package.world_snapshot.cameras = []
    world_package.world_snapshot.objects = [
        {
            "id": "axis-box",
            "name": "Axis box",
            "type": "cube",
            "position_xyz": [1.0, 2.0, 3.0],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.2, 0.4, 0.8],
            "color": "#22c55e",
            "source": "user",
        }
    ]
    world_package.provenance = {
        **world_package.provenance,
        "workspace_check_fixture": "studio-y-up-axis",
    }
    return request.model_copy(update={"world_package": world_package}, deep=True)


def build_mesh_asset_workspace_request() -> SimulatorWorkspacePrepareRequest:
    request = build_demo_workspace_request()
    world_package = request.world_package.model_copy(deep=True)
    world_package.package_id = "mesh-asset-workspace-check"
    world_package.title = "Mesh Asset Workspace Check"
    world_package.interface.observation_modalities = ["state"]
    world_package.world_snapshot.cameras = []
    world_package.world_snapshot.objects = [
        {
            "id": "mesh-crate",
            "name": "Mesh crate",
            "type": "mesh",
            "position_xyz": [0.4, -0.2, 0.15],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.3, 0.2, 0.2],
            "color": "#22c55e",
            "asset_ref": MESH_ASSET_FIXTURE_PATH,
            "source": "user",
        }
    ]
    world_package.provenance = {
        **world_package.provenance,
        "workspace_check_fixture": "mesh-asset",
    }
    mesh_asset = SimulatorMeshAssetUpload(
        path=MESH_ASSET_FIXTURE_PATH,
        aliases=[],
        content_base64=base64.b64encode(
            MESH_ASSET_FIXTURE_OBJ.encode("utf-8")
        ).decode("ascii"),
        mime="model/obj",
    )
    return request.model_copy(
        update={
            "world_package": world_package,
            "mesh_assets": [*request.mesh_assets, mesh_asset],
        },
        deep=True,
    )


def build_hidden_object_workspace_request() -> SimulatorWorkspacePrepareRequest:
    request = build_demo_workspace_request()
    world_package = request.world_package.model_copy(deep=True)
    world_package.package_id = "hidden-object-workspace-check"
    world_package.title = "Hidden Object Workspace Check"
    world_package.world_snapshot.objects = [
        *world_package.world_snapshot.objects,
        {
            "id": "hidden-transfer-probe",
            "name": "Hidden transfer probe",
            "type": "cube",
            "position_xyz": [1.25, -0.85, 0.45],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.25, 0.25, 0.25],
            "color": "#f97316",
            "source": "user",
            "is_hidden": True,
        },
    ]
    world_package.provenance = {
        **world_package.provenance,
        "workspace_check_fixture": "hidden-object",
    }
    return request.model_copy(update={"world_package": world_package}, deep=True)


def build_xacro_source_workspace_request() -> SimulatorWorkspacePrepareRequest:
    request = build_demo_workspace_request()
    world_package = request.world_package.model_copy(deep=True)
    world_package.package_id = "xacro-source-workspace-check"
    world_package.title = "Xacro Source Workspace Check"
    world_package.provenance = {
        **world_package.provenance,
        "workspace_check_fixture": "xacro-source",
        "source_asset_path": "robots/demo.urdf.xacro",
    }
    return request.model_copy(
        update={
            "world_package": world_package,
            "urdf_asset_path": "robots/demo.urdf.xacro",
        },
        deep=True,
    )


def build_workspace_request_from_files(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    asset_roots: Sequence[Path] = (),
) -> SimulatorWorkspacePrepareRequest:
    world_package = WorldScenePackageManifest.model_validate(_load_json(world_package_path))
    world_package = normalize_and_require_world_snapshot_artifact_digests(
        world_package,
        context=f"World package artifact digest invalid in {world_package_path}",
    )
    resolved_robot_urdf_path = robot_urdf_path.expanduser().resolve()
    if not resolved_robot_urdf_path.is_file():
        raise ValueError(f"Robot URDF does not exist: {robot_urdf_path}")
    resolved_asset_roots = tuple(
        dict.fromkeys(
            root.expanduser().resolve()
            for root in (resolved_robot_urdf_path.parent, *asset_roots)
        )
    )
    for root in resolved_asset_roots:
        if not root.is_dir():
            raise ValueError(f"Asset root does not exist or is not a directory: {root}")
    return SimulatorWorkspacePrepareRequest(
        world_package=world_package,
        urdf_asset_path=_relative_to_asset_roots(
            resolved_robot_urdf_path,
            resolved_asset_roots,
        ),
        mesh_assets=_load_workspace_asset_uploads(
            resolved_asset_roots,
            skip_paths=(resolved_robot_urdf_path,),
        ),
    )


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def _relative_to_asset_roots(path: Path, roots: Sequence[Path]) -> str:
    resolved_path = path.resolve()
    for root in roots:
        try:
            return resolved_path.relative_to(root.resolve()).as_posix()
        except ValueError:
            continue
    raise ValueError(f"Path is outside simulator transfer asset roots: {path}")


def _load_workspace_asset_uploads(
    asset_roots: Sequence[Path],
    *,
    skip_paths: Sequence[Path] = (),
) -> list[SimulatorMeshAssetUpload]:
    skipped = {path.resolve() for path in skip_paths}
    content_by_path: dict[str, bytes] = {}
    for root in asset_roots:
        resolved_root = root.resolve()
        for source_path in sorted(path for path in resolved_root.rglob("*") if path.is_file()):
            resolved_source_path = source_path.resolve()
            if resolved_source_path in skipped:
                continue
            relative_path = resolved_source_path.relative_to(resolved_root).as_posix()
            if not _is_workspace_transfer_asset_path(relative_path):
                continue
            content = resolved_source_path.read_bytes()
            existing = content_by_path.get(relative_path)
            if existing is not None and existing != content:
                raise ValueError(f"Conflicting asset path across asset roots: {relative_path}")
            content_by_path[relative_path] = content
    return [
        SimulatorMeshAssetUpload(
            path=relative_path,
            aliases=[],
            content_base64=base64.b64encode(content).decode("ascii"),
        )
        for relative_path, content in sorted(content_by_path.items())
    ]


def _is_ignored_workspace_asset_path(relative_path: str) -> bool:
    return any(part in WORKSPACE_ASSET_IGNORED_DIR_NAMES for part in Path(relative_path).parts)


def _is_workspace_transfer_asset_path(relative_path: str) -> bool:
    path = Path(relative_path)
    if _is_ignored_workspace_asset_path(relative_path):
        return False
    if path.name.lower() in WORKSPACE_TRANSFER_ASSET_FILENAMES:
        return True
    return path.suffix.lower() in WORKSPACE_TRANSFER_ASSET_SUFFIXES
