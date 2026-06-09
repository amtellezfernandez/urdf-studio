from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters.params import GENESIS_LAUNCH_PARAMS
from backend.services.so101_genesis_urdf import materialize_so101_genesis_urdf
from backend.services.world_layout_static_transfer import (
    WorldLayoutFrameMap,
    build_sim_primitives,
    parse_static_world_layout_payload,
    resolve_world_layout_frame_map,
)

GENESIS_FLOOR_SIZE_XY = (4.0, 4.0)
GENESIS_FLOOR_THICKNESS_M = 0.08
GENESIS_ROBOT_BASE_Z_OFFSET_M = 0.004
GENESIS_ARM_KP = 600.0
GENESIS_ARM_KV = 35.0
GENESIS_ARM_FORCE_LIMIT = 220.0
GENESIS_GRIPPER_KP = 700.0
GENESIS_GRIPPER_KV = 42.0
GENESIS_GRIPPER_FORCE_LIMIT = 260.0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open a URDF Studio world package in Genesis."
    )
    parser.add_argument("--world-package", required=True)
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument("--frame-map", choices=["auto", "studio-y-up-to-z-up", "identity"], default="auto")
    parser.add_argument("--duration-sec", type=float, default=0.0)
    parser.add_argument("--include-hidden", action="store_true")
    parser.add_argument("--no-floor", action="store_true")
    parser.add_argument("--no-viewer", action="store_true")
    parser.add_argument("--screenshot", default="")
    parser.add_argument("--screenshot-width", type=int, default=1280)
    parser.add_argument("--screenshot-height", type=int, default=720)
    return parser.parse_args()


def _scene_center_and_radius(
    positions: Sequence[tuple[float, float, float]]
) -> tuple[tuple[float, float, float], float]:
    if not positions:
        return (0.0, 0.0, 0.4), 1.0
    mins = [min(position[axis] for position in positions) for axis in range(3)]
    maxs = [max(position[axis] for position in positions) for axis in range(3)]
    center = tuple((mins[axis] + maxs[axis]) * 0.5 for axis in range(3))
    radius = max(
        0.75,
        max(
            sum((position[axis] - center[axis]) ** 2 for axis in range(3)) ** 0.5
            for position in positions
        ),
    )
    return center, radius


def _viewer_run_in_thread() -> bool:
    return sys.platform != "darwin"


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _to_float_list(value: Any) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, int | float):
        return [float(value)]
    if not isinstance(value, list | tuple):
        return []
    flattened: list[float] = []
    for item in value:
        if isinstance(item, list | tuple):
            flattened.extend(_to_float_list(item))
        elif _is_finite_number(item):
            flattened.append(float(item))
    return flattened


def _joint_dof_indices_by_name(robot_entity) -> dict[str, int]:
    indices: dict[str, int] = {}
    for joint in getattr(robot_entity, "joints", []):
        name = getattr(joint, "name", "")
        dof_indices = getattr(joint, "dofs_idx_local", None)
        if not isinstance(name, str) or not name:
            continue
        local_indices = _to_float_list(dof_indices)
        if len(local_indices) != 1:
            continue
        indices[name] = int(local_indices[0])
    return indices


def _configure_robot_position_controller(
    robot_entity,
    joint_dof_indices: dict[str, int],
) -> int:
    if not joint_dof_indices:
        return 0
    dof_indices: list[int] = []
    kp_values: list[float] = []
    kv_values: list[float] = []
    force_lower: list[float] = []
    force_upper: list[float] = []
    for joint_name, dof_index in joint_dof_indices.items():
        dof_indices.append(dof_index)
        normalized_joint_name = joint_name.lower()
        is_gripper = (
            "gripper" in normalized_joint_name
            or "finger" in normalized_joint_name
            or "slide" in normalized_joint_name
        )
        kp_values.append(GENESIS_GRIPPER_KP if is_gripper else GENESIS_ARM_KP)
        kv_values.append(GENESIS_GRIPPER_KV if is_gripper else GENESIS_ARM_KV)
        force_limit = GENESIS_GRIPPER_FORCE_LIMIT if is_gripper else GENESIS_ARM_FORCE_LIMIT
        force_lower.append(-force_limit)
        force_upper.append(force_limit)

    if hasattr(robot_entity, "set_dofs_kp"):
        robot_entity.set_dofs_kp(kp_values, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "set_dofs_kv"):
        robot_entity.set_dofs_kv(kv_values, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "set_dofs_force_range"):
        robot_entity.set_dofs_force_range(force_lower, force_upper, dofs_idx_local=dof_indices)
    return len(dof_indices)


def _apply_joint_values(
    robot_entity,
    joint_dof_indices: dict[str, int],
    joint_values: dict[str, Any],
) -> int:
    dof_indices: list[int] = []
    positions: list[float] = []
    for joint_name, value in joint_values.items():
        if joint_name not in joint_dof_indices or not _is_finite_number(value):
            continue
        dof_indices.append(joint_dof_indices[joint_name])
        positions.append(float(value))
    if not dof_indices:
        return 0
    if hasattr(robot_entity, "set_dofs_position"):
        try:
            robot_entity.set_dofs_position(
                positions,
                dofs_idx_local=dof_indices,
                zero_velocity=True,
            )
        except TypeError:
            robot_entity.set_dofs_position(positions, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "control_dofs_position"):
        robot_entity.control_dofs_position(positions, dofs_idx_local=dof_indices)
    return len(dof_indices)


def _add_floor_entity(gs, scene) -> None:
    scene.add_entity(
        gs.morphs.Box(
            size=(GENESIS_FLOOR_SIZE_XY[0], GENESIS_FLOOR_SIZE_XY[1], GENESIS_FLOOR_THICKNESS_M),
            pos=(0.0, 0.0, -GENESIS_FLOOR_THICKNESS_M / 2.0),
            fixed=True,
            collision=True,
        ),
        surface=gs.surfaces.Default(color=(0.16, 0.16, 0.16), opacity=0.35),
        name="wl_reference_floor",
    )


def _add_primitive_entity(gs, scene, primitive) -> None:
    if primitive.sim_type == "box":
        morph = gs.morphs.Box(
            size=primitive.size_xyz,
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=True,
            collision=primitive.collision,
        )
    elif primitive.sim_type == "sphere":
        morph = gs.morphs.Sphere(
            radius=max(primitive.size_xyz) * 0.5,
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=True,
            collision=primitive.collision,
        )
    elif primitive.sim_type == "cylinder":
        morph = gs.morphs.Cylinder(
            radius=primitive.size_xyz[0] * 0.5,
            height=primitive.size_xyz[2],
            pos=primitive.position_xyz,
            quat=primitive.quat_wxyz,
            fixed=True,
            collision=primitive.collision,
        )
    else:
        raise ValueError(f"Unsupported Genesis primitive type: {primitive.sim_type}")
    scene.add_entity(
        morph,
        surface=gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3]),
        name=primitive.sim_name,
    )


def _load_world_package(path: Path) -> WorldScenePackageManifest:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Failed to read world package: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid world package JSON: {exc}") from exc
    return WorldScenePackageManifest.model_validate(payload)


def open_genesis_world_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    include_floor: bool,
    no_viewer: bool,
    screenshot_path: Path | None,
    screenshot_size: tuple[int, int],
) -> None:
    import genesis as gs

    world_package = _load_world_package(world_package_path)
    layout = parse_static_world_layout_payload(world_package.model_dump(mode="json"))
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    primitives, warnings = build_sim_primitives(
        layout,
        frame_map=resolved_frame_map,
        include_hidden=include_hidden,
    )
    print(
        "[genesis-world-open] "
        f"package={world_package.package_id}@{world_package.version} "
        f"objects={len(layout.objects)} primitives={len(primitives)} "
        f"frame_map={resolved_frame_map} requested_frame_map={frame_map}",
        flush=True,
    )
    for warning in warnings:
        print(f"[genesis-world-open] warning: {warning}", flush=True)

    gs.init(backend=gs.cpu, logging_level="warning")
    center, radius = _scene_center_and_radius(
        [primitive.position_xyz for primitive in primitives] + [(0.0, 0.0, 0.35)]
    )
    camera_pos = (
        center[0] + radius * 2.6,
        center[1] - radius * 2.4,
        max(center[2] + radius * 1.7, 0.8),
    )
    scene = gs.Scene(
        show_viewer=not no_viewer,
        sim_options=gs.options.SimOptions(dt=0.01, gravity=(0.0, 0.0, -9.81)),
        rigid_options=gs.options.RigidOptions(
            enable_collision=True,
            enable_self_collision=False,
            enable_adjacent_collision=False,
            box_box_detection=True,
        ),
        viewer_options=gs.options.ViewerOptions(
            camera_pos=camera_pos,
            camera_lookat=center,
            camera_up=(0.0, 0.0, 1.0),
            camera_fov=45,
            run_in_thread=_viewer_run_in_thread(),
            enable_gui=True,
        ),
    )
    if include_floor:
        _add_floor_entity(gs, scene)
    for primitive in primitives:
        _add_primitive_entity(gs, scene, primitive)

    genesis_robot_urdf_path = materialize_so101_genesis_urdf(robot_urdf_path)
    robot_entity = scene.add_entity(
        gs.morphs.URDF(
            file=str(genesis_robot_urdf_path.resolve()),
            pos=(0.0, 0.0, GENESIS_ROBOT_BASE_Z_OFFSET_M),
            fixed=True,
            merge_fixed_links=False,
            collision=True,
            visualization=True,
        ),
        name="robot",
    )

    camera = None
    if screenshot_path is not None:
        camera = scene.add_camera(
            res=screenshot_size,
            pos=camera_pos,
            lookat=center,
            up=(0.0, 0.0, 1.0),
            fov=45,
            GUI=False,
        )

    scene.build()
    joint_dof_indices = _joint_dof_indices_by_name(robot_entity)
    _configure_robot_position_controller(robot_entity, joint_dof_indices)
    _apply_joint_values(
        robot_entity,
        joint_dof_indices,
        world_package.world_snapshot.joint_positions,
    )
    print(GENESIS_LAUNCH_PARAMS.ready_log_marker, flush=True)

    def step_runtime() -> None:
        scene.step()

    try:
        if screenshot_path is not None and camera is not None:
            from PIL import Image

            step_runtime()
            image = camera.render(rgb=True)[0]
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(image).save(screenshot_path)
            print(f"[genesis-world-open] screenshot written: {screenshot_path}", flush=True)

        if no_viewer:
            headless_steps = 5
            if duration_sec > 0 and math.isfinite(duration_sec):
                headless_steps = max(headless_steps, int(math.ceil(duration_sec / 0.01)))
            for _ in range(headless_steps):
                step_runtime()
            return

        if duration_sec <= 0:
            print("[genesis-world-open] Genesis viewer opened. Press Ctrl-C to return.", flush=True)
            while True:
                step_runtime()
                time.sleep(1.0 / 60.0)

        deadline = time.monotonic() + duration_sec
        while time.monotonic() < deadline:
            step_runtime()
            time.sleep(1.0 / 60.0)
    except KeyboardInterrupt:
        return


def main() -> int:
    args = _parse_args()
    open_genesis_world_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        include_floor=not args.no_floor,
        no_viewer=args.no_viewer,
        screenshot_path=Path(args.screenshot) if args.screenshot else None,
        screenshot_size=(args.screenshot_width, args.screenshot_height),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
