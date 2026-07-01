from __future__ import annotations

import argparse
import time
import xml.etree.ElementTree as ET
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import SIMULATOR_SAPIEN_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import (
    SAPIEN_SCENE_PARAMS,
    SAPIEN_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.simulator_adapters.world_mesh_assets import resolve_declared_mesh_asset_path
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap
from backend.services.world_layout_transfer_types import WorldLayoutTransferError


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in SAPIEN.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    parser.add_argument("--no-floor", action="store_true")
    parser.add_argument("--free-base", action="store_true")
    return parser.parse_args()


def _materialize_physics_urdf(robot_urdf_path: Path) -> Path:
    tree = ET.parse(robot_urdf_path)
    root = tree.getroot()
    for link in root.findall("link"):
        for visual in list(link.findall("visual")):
            link.remove(visual)
    physics_urdf_path = robot_urdf_path.with_name(f"{robot_urdf_path.stem}.sapien-physics.urdf")
    ET.indent(root, space="  ")
    tree.write(physics_urdf_path, encoding="unicode", xml_declaration=True)
    return physics_urdf_path


def _pose(sapien: Any, primitive: SimPrimitive) -> Any:
    return sapien.Pose(
        p=list(primitive.position_xyz),
        q=list(primitive.quat_wxyz),
    )


def _joint_name(joint: Any) -> str | None:
    name = getattr(joint, "name", None)
    if callable(name):
        name = name()
    if isinstance(name, str) and name.strip():
        return name.strip()
    get_name = getattr(joint, "get_name", None)
    if callable(get_name):
        value = get_name()
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _joint_dof(joint: Any) -> int:
    dof = getattr(joint, "dof", None)
    if callable(dof):
        dof = dof()
    return int(dof) if isinstance(dof, int) else 1


def _sequence_attr_or_call(target: Any, *names: str) -> Sequence[Any] | None:
    for name in names:
        value = getattr(target, name, None)
        if value is None:
            continue
        if callable(value):
            try:
                value = value()
            except TypeError:
                continue
        if isinstance(value, Sequence):
            return value
    return None


def _robot_qpos(robot: Any) -> list[float] | None:
    value = getattr(robot, "get_qpos", None)
    if callable(value):
        value = value()
    else:
        value = getattr(robot, "qpos", None)
    if value is None:
        return None
    try:
        return [float(item) for item in value]
    except TypeError:
        return None


def _apply_initial_joint_positions(robot: Any, joint_positions: dict[str, float]) -> int | None:
    if not joint_positions:
        return 0
    active_joints = _sequence_attr_or_call(
        robot,
        "get_active_joints",
        "active_joints",
        "get_joints",
        "joints",
    )
    qpos = _robot_qpos(robot)
    set_qpos = getattr(robot, "set_qpos", None)
    if active_joints is None or qpos is None or not callable(set_qpos):
        return None

    applied_count = 0
    qpos_index = 0
    for joint in active_joints:
        joint_dof = max(_joint_dof(joint), 0)
        joint_name = _joint_name(joint)
        if joint_dof == 1 and joint_name is not None and joint_name in joint_positions:
            position = joint_positions[joint_name]
            if is_finite_number(position) and qpos_index < len(qpos):
                qpos[qpos_index] = float(position)
                applied_count += 1
        qpos_index += joint_dof
    if applied_count:
        set_qpos(qpos)
    return applied_count


def _add_primitive(
    sapien: Any,
    scene: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> Any:
    builder = scene.create_actor_builder()
    builder.set_initial_pose(_pose(sapien, primitive))
    asset_path = resolve_declared_mesh_asset_path(
        primitive,
        asset_roots,
        simulator_label="SAPIEN",
    )
    density = primitive.mass_kg if primitive.mass_kg is not None else 1000.0
    if primitive.collision:
        if asset_path is not None:
            if primitive.fixed:
                builder.add_nonconvex_collision_from_file(
                    str(asset_path),
                    scale=primitive.asset_scale_xyz or (1.0, 1.0, 1.0),
                    density=density,
                )
            else:
                builder.add_convex_collision_from_file(
                    str(asset_path),
                    scale=primitive.asset_scale_xyz or (1.0, 1.0, 1.0),
                    density=density,
                )
        elif primitive.sim_type == "box":
            builder.add_box_collision(
                half_size=tuple(component * 0.5 for component in primitive.size_xyz),
                density=density,
            )
        elif primitive.sim_type == "sphere":
            builder.add_sphere_collision(
                radius=max(primitive.size_xyz) * 0.5,
                density=density,
            )
        elif primitive.sim_type == "cylinder":
            builder.add_cylinder_collision(
                radius=primitive.size_xyz[0] * 0.5,
                half_length=primitive.size_xyz[2] * 0.5,
                density=density,
            )
        else:
            raise WorldLayoutTransferError(f"Unsupported SAPIEN primitive type: {primitive.sim_type}")

    if primitive.fixed:
        return builder.build_static(primitive.sim_name)
    return builder.build(primitive.sim_name)


def _add_floor(sapien: Any, scene: Any) -> Any:
    builder = scene.create_actor_builder()
    thickness = SAPIEN_SCENE_PARAMS.floor_thickness_m
    builder.set_initial_pose(
        sapien.Pose(
            p=[0.0, 0.0, -thickness * 0.5],
            q=[1.0, 0.0, 0.0, 0.0],
        )
    )
    builder.add_box_collision(
        half_size=(
            SAPIEN_SCENE_PARAMS.floor_size_xy_m[0] * 0.5,
            SAPIEN_SCENE_PARAMS.floor_size_xy_m[1] * 0.5,
            thickness * 0.5,
        )
    )
    return builder.build_static("urdf_studio_floor")


def prepare_sapien_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_floor: bool,
    no_viewer: bool,
    free_base: bool,
    report_path: Path | None,
) -> None:
    import sapien

    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in simulator_scene.warnings:
        print(f"[sapien-workspace] warning: {warning}", flush=True)
    cameras = simulator_scene.cameras

    scene = sapien.Scene([sapien.physx.PhysxCpuSystem()])
    scene.set_timestep(SAPIEN_SCENE_PARAMS.sim_dt_sec)
    loader = scene.create_urdf_loader()
    if hasattr(loader, "fix_root_link"):
        loader.fix_root_link = not free_base and SAPIEN_SCENE_PARAMS.fixed_base
    physics_urdf_path = _materialize_physics_urdf(robot_urdf_path)
    robot = loader.load(str(physics_urdf_path.resolve()))
    applied_joints = _apply_initial_joint_positions(
        robot,
        dict(simulator_scene.robot.joint_positions),
    )
    object_entities = [
        _add_primitive(sapien, scene, primitive, asset_roots=simulator_scene.robot.asset_roots)
        for primitive in simulator_scene.primitives
    ]
    floor_entity = _add_floor(sapien, scene) if not no_floor else None
    scene.step()
    print(
        "[sapien-workspace] "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"robot_loaded=1 world_objects={len(object_entities)} cameras={len(cameras)} "
        f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map}",
        flush=True,
    )
    if applied_joints is not None:
        print(f"[sapien-workspace] applied_initial_joints={applied_joints}", flush=True)
    if report_path is not None:
        runtime: dict[str, Any] = {
            "robot_loaded": True,
            "world_objects": len(object_entities),
            "cameras": len(cameras),
            "physics_system": "PhysxCpuSystem",
            "render_system": False,
            "physics_urdf_path": physics_urdf_path,
            "free_base": free_base,
            "floor": floor_entity is not None,
            "headless": True,
            "persistent_process": not no_viewer,
        }
        if applied_joints is not None:
            runtime["applied_initial_joints"] = applied_joints
        write_simulator_validation_report(
            simulator_scene,
            report_path,
            simulator_id=SIMULATOR_SAPIEN_ID,
            simulator_label="SAPIEN",
            runtime=runtime,
        )
        print(f"[sapien-workspace] report written: {report_path}", flush=True)
    print(SAPIEN_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
    while True:
        scene.step()
        if deadline is not None and time.monotonic() >= deadline:
            break
        if no_viewer:
            break
        time.sleep(1.0 / SAPIEN_SCENE_PARAMS.viewer_step_hz)


def main() -> int:
    args = _parse_args()
    prepare_sapien_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_floor=args.no_floor,
        no_viewer=args.no_viewer,
        free_base=args.free_base,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
