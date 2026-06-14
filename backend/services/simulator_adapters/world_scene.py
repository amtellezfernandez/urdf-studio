from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters.camera_transfer import (
    SimCameraSpec,
    build_sim_camera_specs,
)
from backend.services.simulator_adapters.workspace_paths import workspace_asset_roots
from backend.services.world_layout_static_transfer import (
    build_sim_primitives,
    parse_static_world_layout_payload,
    resolve_world_layout_frame_map,
)
from backend.services.world_scene_package_digest import world_scene_package_json_payload
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    SimPrimitive,
    StaticWorldLayout,
    WorldLayoutFrameMap,
)


@dataclass(frozen=True)
class PreparedWorldScene:
    world_package: WorldScenePackageManifest
    layout: StaticWorldLayout
    frame_map: ConcreteWorldLayoutFrameMap
    primitives: tuple[SimPrimitive, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class SimulatorRobotSpec:
    urdf_path: Path
    asset_roots: tuple[Path, ...]
    joint_positions: Mapping[str, float]


@dataclass(frozen=True)
class SimulatorSceneSpec:
    world_package: WorldScenePackageManifest
    layout: StaticWorldLayout
    requested_frame_map: WorldLayoutFrameMap
    frame_map: ConcreteWorldLayoutFrameMap
    robot: SimulatorRobotSpec
    primitives: tuple[SimPrimitive, ...]
    cameras: tuple[SimCameraSpec, ...]
    warnings: tuple[str, ...]

    def validation_report(self) -> dict[str, Any]:
        return {
            "package_id": self.world_package.package_id,
            "version": self.world_package.version,
            "requested_frame_map": self.requested_frame_map,
            "frame_map": self.frame_map,
            "frame_convention": self.layout.frame_convention,
            "object_count": len(self.layout.objects),
            "primitive_count": len(self.primitives),
            "camera_count": len(self.cameras),
            "joint_position_count": len(self.robot.joint_positions),
            "robot_urdf_path": str(self.robot.urdf_path),
            "asset_roots": [str(path) for path in self.robot.asset_roots],
            "warnings": list(self.warnings),
            "objects": [_primitive_report(primitive) for primitive in self.primitives],
            "cameras": [_camera_report(camera) for camera in self.cameras],
        }


def build_simulator_validation_report(
    scene: SimulatorSceneSpec,
    *,
    simulator_id: str,
    simulator_label: str,
    runtime: Mapping[str, Any] | None = None,
    artifacts: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    report = scene.validation_report()
    report["simulator"] = {
        "id": simulator_id,
        "label": simulator_label,
        "runtime": _json_safe(runtime or {}),
    }
    report["artifacts"] = _json_safe(artifacts or {})
    return report


def write_simulator_validation_report(
    scene: SimulatorSceneSpec,
    report_path: Path,
    *,
    simulator_id: str,
    simulator_label: str,
    runtime: Mapping[str, Any] | None = None,
    artifacts: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    report = build_simulator_validation_report(
        scene,
        simulator_id=simulator_id,
        simulator_label=simulator_label,
        runtime=runtime,
        artifacts=artifacts,
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")
    return report


def load_world_package(path: Path) -> WorldScenePackageManifest:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Failed to read world package: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid world package JSON: {exc}") from exc
    return WorldScenePackageManifest.model_validate(payload)


def prepare_world_scene(
    *,
    world_package_path: Path,
    frame_map: WorldLayoutFrameMap,
    include_hidden: bool,
) -> PreparedWorldScene:
    world_package = load_world_package(world_package_path)
    layout = parse_static_world_layout_payload(world_scene_package_json_payload(world_package))
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    primitives, warnings = build_sim_primitives(
        layout,
        frame_map=resolved_frame_map,
        include_hidden=include_hidden,
    )
    return PreparedWorldScene(
        world_package=world_package,
        layout=layout,
        frame_map=resolved_frame_map,
        primitives=primitives,
        warnings=warnings,
    )


def prepare_simulator_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    include_hidden: bool,
) -> SimulatorSceneSpec:
    prepared_world = prepare_world_scene(
        world_package_path=world_package_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    cameras, camera_warnings = build_sim_camera_specs(
        prepared_world.world_package,
        robot_urdf_path=robot_urdf_path,
    )
    return SimulatorSceneSpec(
        world_package=prepared_world.world_package,
        layout=prepared_world.layout,
        requested_frame_map=frame_map,
        frame_map=prepared_world.frame_map,
        robot=SimulatorRobotSpec(
            urdf_path=robot_urdf_path,
            asset_roots=workspace_asset_roots(world_package_path, robot_urdf_path),
            joint_positions=prepared_world.world_package.world_snapshot.joint_positions,
        ),
        primitives=prepared_world.primitives,
        cameras=cameras,
        warnings=(*prepared_world.warnings, *camera_warnings),
    )


def _primitive_report(primitive: SimPrimitive) -> dict[str, Any]:
    return {
        "source_id": primitive.source_id,
        "source_name": primitive.source_name,
        "sim_name": primitive.sim_name,
        "source_type": primitive.source_type,
        "sim_type": primitive.sim_type,
        "position_xyz": list(primitive.position_xyz),
        "quat_wxyz": list(primitive.quat_wxyz),
        "size_xyz": list(primitive.size_xyz),
        "rgba": list(primitive.rgba),
        "collision": primitive.collision,
        "fixed": primitive.fixed,
        "mass_kg": primitive.mass_kg,
        "friction": primitive.friction,
        "restitution": primitive.restitution,
        "semantic_role": primitive.semantic_role,
        "asset_ref": primitive.asset_ref,
        "asset_scale_xyz": list(primitive.asset_scale_xyz) if primitive.asset_scale_xyz else None,
    }


def _camera_report(camera: SimCameraSpec) -> dict[str, Any]:
    return {
        "camera_id": camera.camera_id,
        "name": camera.name,
        "sim_name": camera.sim_name,
        "parent_joint": camera.parent_joint,
        "parent_link": camera.parent_link,
        "position_xyz": list(camera.position_xyz),
        "quat_wxyz": list(camera.quat_wxyz),
        "width": camera.width,
        "height": camera.height,
        "fov_deg": camera.fov_deg,
        "intrinsics": {
            "matrix": [list(row) for row in camera.intrinsics.matrix],
        }
        if camera.intrinsics is not None
        else None,
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_json_safe(item) for item in value]
    return value
