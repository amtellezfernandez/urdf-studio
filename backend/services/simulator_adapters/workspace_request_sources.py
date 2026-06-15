from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_BLENDER_ID,
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
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
from backend.services.simulator_adapters.robot_repairs import (
    GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY,
    GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS,
)
from backend.services.world_scene_package_params import WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1
from backend.services.world_scene_package_digest import (
    normalize_world_snapshot_artifact_digests,
    require_world_snapshot_artifact_digests,
)

WORKSPACE_SIMULATORS: tuple[SimulatorId, ...] = (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_BLENDER_ID,
)
WORKSPACE_FIXTURES = (
    "demo",
    "studio-y-up-axis",
    "mesh-asset",
    "hidden-object",
    "xacro-source",
)
DEMO_ROOT = BASE_DIR / "web" / "public" / "demo"
SO101_MANIFEST_PATH = DEMO_ROOT / "so101" / "manifest.json"
SO101_CAMERA_CONFIG_PATH = DEMO_ROOT / "so101" / "camera-config.json"
STATIC_WORLD_LAYOUT_PATH = (
    BASE_DIR / "web" / "public" / "world-layouts" / "static-transfer-smoke.world-layout.json"
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
    urdf_xml = (DEMO_ROOT / "robot.urdf").read_text(encoding="utf-8")
    cameras = _load_demo_cameras()
    objects = _load_demo_objects()
    world_package = WorldScenePackageManifest(
        schema_version=WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
        package_id="so101-simulator-workspaces-check",
        version="1.0.0",
        title="SO101 Simulator Workspace Check",
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
            urdf_xml=urdf_xml,
            joint_positions={},
            cameras=cameras,
            objects=objects,
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
        provenance={
            "robot": str((DEMO_ROOT / "robot.urdf").relative_to(BASE_DIR)),
            "cameras": str(SO101_CAMERA_CONFIG_PATH.relative_to(BASE_DIR)),
            "world_layout": str(STATIC_WORLD_LAYOUT_PATH.relative_to(BASE_DIR)),
            GENESIS_COMPATIBILITY_PATCH_PROVENANCE_KEY: {
                "genesis": [
                    GENESIS_COMPATIBILITY_PATCH_SO101_GRIPPER_PROXY_COLLISIONS,
                ],
            },
        },
        security={"attestation_refs": []},
    )
    return SimulatorWorkspacePrepareRequest(
        world_package=world_package,
        urdf_asset_path="robot.urdf",
        mesh_assets=_load_demo_mesh_assets(),
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
        "source_asset_path": "robots/so101.urdf.xacro",
    }
    return request.model_copy(
        update={
            "world_package": world_package,
            "urdf_asset_path": "robots/so101.urdf.xacro",
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
    world_package = normalize_world_snapshot_artifact_digests(world_package)
    require_world_snapshot_artifact_digests(
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


def _load_demo_mesh_assets() -> list[SimulatorMeshAssetUpload]:
    manifest = _load_json(SO101_MANIFEST_PATH)
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError(f"Invalid SO101 manifest: {SO101_MANIFEST_PATH}")

    uploads: list[SimulatorMeshAssetUpload] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        relative_path = entry.get("path")
        if not isinstance(relative_path, str) or relative_path == "robot.urdf":
            continue
        url = entry.get("url")
        source_path = (
            (SO101_MANIFEST_PATH.parent / url).resolve()
            if isinstance(url, str) and url
            else (DEMO_ROOT / relative_path).resolve()
        )
        uploads.append(
            SimulatorMeshAssetUpload(
                path=relative_path,
                aliases=[],
                content_base64=base64.b64encode(source_path.read_bytes()).decode("ascii"),
                mime=entry.get("mime") if isinstance(entry.get("mime"), str) else None,
            )
        )
    return uploads


def _load_demo_cameras() -> list[dict]:
    payload = _load_json(SO101_CAMERA_CONFIG_PATH)
    cameras = payload.get("cameras")
    if not isinstance(cameras, list):
        raise ValueError(f"Invalid SO101 camera config: {SO101_CAMERA_CONFIG_PATH}")
    return [
        _normalize_demo_camera(camera, index)
        for index, camera in enumerate(cameras)
        if isinstance(camera, dict)
    ]


def _normalize_demo_camera(camera: dict, index: int) -> dict:
    normalized = dict(camera)
    camera_name = normalized.get("name")
    normalized["id"] = (
        normalized.get("id")
        if isinstance(normalized.get("id"), str) and normalized.get("id")
        else _camera_id_from_name(camera_name if isinstance(camera_name, str) else "", index)
    )
    pose = normalized.get("pose")
    if isinstance(pose, list) and len(pose) == 6:
        normalized["pose"] = {
            "xyz": pose[:3],
            "rpy": pose[3:],
        }
    return normalized


def _camera_id_from_name(name: str, index: int) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip()).strip("_")
    return normalized or f"camera_{index + 1}"


def _load_demo_objects() -> list[dict]:
    payload = _load_json(STATIC_WORLD_LAYOUT_PATH)
    world_layout = payload.get("world_layout")
    if not isinstance(world_layout, dict):
        raise ValueError(f"Invalid static world layout: {STATIC_WORLD_LAYOUT_PATH}")
    objects = world_layout.get("objects")
    if not isinstance(objects, list):
        raise ValueError(f"Invalid object list in static world layout: {STATIC_WORLD_LAYOUT_PATH}")
    return [item for item in objects if isinstance(item, dict)]


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
