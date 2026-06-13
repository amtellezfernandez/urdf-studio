from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any, Sequence

from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.camera_transfer import (
    CAMERA_MARKER_RGBA,
    CAMERA_MARKER_SIZE_XYZ,
    SimCameraSpec,
    build_sim_camera_specs,
)
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import (
    PYBULLET_SCENE_PARAMS,
    PYBULLET_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.pybullet_camera import (
    write_pybullet_camera_screenshots,
)
from backend.services.simulator_adapters.workspace_paths import workspace_asset_roots
from backend.services.simulator_adapters.world_scene import prepare_world_scene
from backend.services.world_layout_static_transfer import resolve_world_layout_asset_path
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in PyBullet.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    parser.add_argument("--no-floor", action="store_true")
    parser.add_argument("--free-base", action="store_true")
    parser.add_argument("--show-camera-markers", action="store_true")
    parser.add_argument("--camera-screenshot-dir", default="")
    return parser.parse_args()


def _quat_wxyz_to_xyzw(quat_wxyz: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    return (quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0])


def _apply_initial_joint_positions(
    pybullet: Any,
    robot_id: int,
    joint_positions: dict[str, float],
) -> int:
    applied_count = 0
    joint_indices_by_name: dict[str, int] = {}
    for joint_index in range(pybullet.getNumJoints(robot_id)):
        joint_info = pybullet.getJointInfo(robot_id, joint_index)
        raw_name = joint_info[1]
        joint_name = raw_name.decode("utf-8", errors="replace") if isinstance(raw_name, bytes) else str(raw_name)
        joint_indices_by_name[joint_name] = joint_index

    for joint_name, position in joint_positions.items():
        joint_index = joint_indices_by_name.get(joint_name)
        if joint_index is None or not is_finite_number(position):
            continue
        pybullet.resetJointState(robot_id, joint_index, float(position))
        applied_count += 1
    return applied_count


def _primitive_shape(
    pybullet: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> tuple[int, dict[str, Any], dict[str, Any]]:
    asset_path = resolve_world_layout_asset_path(primitive.asset_ref, asset_roots)
    if asset_path is not None and hasattr(pybullet, "GEOM_MESH"):
        shape_kwargs = {
            "fileName": str(asset_path),
            "meshScale": primitive.asset_scale_xyz or (1.0, 1.0, 1.0),
        }
        return pybullet.GEOM_MESH, shape_kwargs, shape_kwargs
    if primitive.sim_type == "box":
        shape_kwargs = {
            "halfExtents": [component * 0.5 for component in primitive.size_xyz],
        }
        return pybullet.GEOM_BOX, shape_kwargs, shape_kwargs
    if primitive.sim_type == "sphere":
        shape_kwargs = {
            "radius": max(primitive.size_xyz) * 0.5,
        }
        return pybullet.GEOM_SPHERE, shape_kwargs, shape_kwargs
    if primitive.sim_type == "cylinder":
        return pybullet.GEOM_CYLINDER, {
            "radius": primitive.size_xyz[0] * 0.5,
            "height": primitive.size_xyz[2],
        }, {
            "radius": primitive.size_xyz[0] * 0.5,
            "length": primitive.size_xyz[2],
        }
    raise ValueError(f"Unsupported PyBullet primitive type: {primitive.sim_type}")


def _add_primitive(
    pybullet: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> int:
    shape_type, collision_shape_kwargs, visual_shape_kwargs = _primitive_shape(
        pybullet,
        primitive,
        asset_roots=asset_roots,
    )
    collision_shape = (
        pybullet.createCollisionShape(shape_type, **collision_shape_kwargs)
        if primitive.collision
        else -1
    )
    visual_shape = pybullet.createVisualShape(
        shape_type,
        rgbaColor=primitive.rgba,
        **visual_shape_kwargs,
    )
    base_mass = 0.0 if primitive.fixed else (primitive.mass_kg if primitive.mass_kg is not None else 1.0)
    body_id = pybullet.createMultiBody(
        baseMass=base_mass,
        baseCollisionShapeIndex=collision_shape,
        baseVisualShapeIndex=visual_shape,
        basePosition=primitive.position_xyz,
        baseOrientation=_quat_wxyz_to_xyzw(primitive.quat_wxyz),
    )
    dynamics_kwargs: dict[str, float] = {}
    if primitive.friction is not None:
        dynamics_kwargs["lateralFriction"] = primitive.friction
    if primitive.restitution is not None:
        dynamics_kwargs["restitution"] = primitive.restitution
    if dynamics_kwargs:
        pybullet.changeDynamics(body_id, -1, **dynamics_kwargs)
    return body_id


def _add_camera_marker(pybullet: Any, camera: SimCameraSpec) -> int:
    visual_shape = pybullet.createVisualShape(
        pybullet.GEOM_BOX,
        halfExtents=[component * 0.5 for component in CAMERA_MARKER_SIZE_XYZ],
        rgbaColor=CAMERA_MARKER_RGBA,
    )
    return pybullet.createMultiBody(
        baseMass=0.0,
        baseCollisionShapeIndex=-1,
        baseVisualShapeIndex=visual_shape,
        basePosition=camera.position_xyz,
        baseOrientation=camera.quat_xyzw,
    )


def prepare_pybullet_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_floor: bool,
    no_viewer: bool,
    free_base: bool,
    show_camera_markers: bool,
    camera_screenshot_dir: Path | None,
) -> None:
    import pybullet
    import pybullet_data

    prepared_scene = prepare_world_scene(
        world_package_path=world_package_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in prepared_scene.warnings:
        print(f"[pybullet-workspace] warning: {warning}", flush=True)
    cameras, camera_warnings = build_sim_camera_specs(
        prepared_scene.world_package,
        robot_urdf_path=robot_urdf_path,
    )
    for warning in camera_warnings:
        print(f"[pybullet-workspace] warning: {warning}", flush=True)

    connection_mode = pybullet.DIRECT if no_viewer else pybullet.GUI
    client_id = pybullet.connect(connection_mode)
    if client_id < 0:
        raise RuntimeError("PyBullet could not open a simulation connection.")
    try:
        pybullet.setAdditionalSearchPath(pybullet_data.getDataPath())
        pybullet.setGravity(*PYBULLET_SCENE_PARAMS.gravity_xyz)
        if not no_floor:
            pybullet.loadURDF("plane.urdf", useFixedBase=True)
        robot_id = pybullet.loadURDF(
            str(robot_urdf_path.resolve()),
            basePosition=PYBULLET_SCENE_PARAMS.robot_base_position_xyz,
            baseOrientation=PYBULLET_SCENE_PARAMS.robot_base_orientation_xyzw,
            useFixedBase=not free_base,
        )
        applied_joints = _apply_initial_joint_positions(
            pybullet,
            robot_id,
            prepared_scene.world_package.world_snapshot.joint_positions,
        )
        asset_roots = workspace_asset_roots(world_package_path, robot_urdf_path)
        object_ids = [
            _add_primitive(pybullet, primitive, asset_roots=asset_roots)
            for primitive in prepared_scene.primitives
        ]
        camera_marker_ids = (
            [_add_camera_marker(pybullet, camera) for camera in cameras]
            if show_camera_markers
            else []
        )
        pybullet.stepSimulation()
        camera_screenshot_count = 0
        if camera_screenshot_dir is not None:
            camera_screenshot_count = write_pybullet_camera_screenshots(
                pybullet,
                cameras,
                camera_screenshot_dir,
                near_m=PYBULLET_SCENE_PARAMS.camera_near_m,
                far_m=PYBULLET_SCENE_PARAMS.camera_far_m,
            )
        print(
            "[pybullet-workspace] "
            f"package={prepared_scene.world_package.package_id}@{prepared_scene.world_package.version} "
            f"robot_joints={pybullet.getNumJoints(robot_id)} world_objects={len(object_ids)} "
            f"cameras={len(cameras)} camera_markers={len(camera_marker_ids)} "
            f"frame_map={prepared_scene.frame_map} requested_frame_map={frame_map} "
            f"applied_initial_joints={applied_joints}",
            flush=True,
        )
        if camera_screenshot_dir is not None:
            print(f"[pybullet-workspace] camera_screenshots={camera_screenshot_count}", flush=True)
        print(PYBULLET_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while True:
            pybullet.stepSimulation()
            if deadline is not None and time.monotonic() >= deadline:
                break
            if no_viewer:
                break
            time.sleep(1.0 / PYBULLET_SCENE_PARAMS.viewer_step_hz)
    finally:
        pybullet.disconnect()


def main() -> int:
    args = _parse_args()
    prepare_pybullet_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_floor=args.no_floor,
        no_viewer=args.no_viewer,
        free_base=args.free_base,
        show_camera_markers=args.show_camera_markers,
        camera_screenshot_dir=Path(args.camera_screenshot_dir) if args.camera_screenshot_dir else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
