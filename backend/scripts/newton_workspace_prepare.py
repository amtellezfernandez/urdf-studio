from __future__ import annotations

import argparse
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import SIMULATOR_NEWTON_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import (
    NEWTON_SCENE_PARAMS,
    NEWTON_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.world_mesh_assets import resolve_declared_mesh_asset_path
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap
from backend.services.world_layout_transfer_types import WorldLayoutTransferError


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in Newton.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    parser.add_argument("--no-floor", action="store_true")
    parser.add_argument("--free-base", action="store_true")
    return parser.parse_args()


def _wp_quat_xyzw(wp: Any, quat_wxyz: tuple[float, float, float, float]) -> Any:
    return wp.quat(quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0])


def _wp_transform(
    wp: Any,
    position_xyz: tuple[float, float, float],
    quat_wxyz: tuple[float, float, float, float],
) -> Any:
    return wp.transform(
        wp.vec3(*position_xyz),
        _wp_quat_xyzw(wp, quat_wxyz),
    )


def _apply_initial_joint_positions(builder: Any, joint_positions: dict[str, float]) -> int:
    if not joint_positions:
        return 0
    applied_count = 0
    for joint_index, joint_name in enumerate(builder.joint_label):
        if joint_name not in joint_positions:
            continue
        position = joint_positions[joint_name]
        if not is_finite_number(position):
            continue
        q_start = builder.joint_q_start[joint_index]
        q_end = (
            builder.joint_q_start[joint_index + 1]
            if joint_index + 1 < len(builder.joint_q_start)
            else builder.joint_coord_count
        )
        if q_end - q_start != 1:
            continue
        builder.joint_q[q_start] = float(position)
        if q_start < len(builder.joint_target_q):
            builder.joint_target_q[q_start] = float(position)
        applied_count += 1
    return applied_count


def _shape_config(builder: Any, primitive: SimPrimitive) -> Any:
    cfg = builder.default_shape_cfg.copy()
    if primitive.friction is not None:
        cfg.mu = primitive.friction
    if primitive.restitution is not None and hasattr(cfg, "restitution"):
        cfg.restitution = primitive.restitution
    return cfg


def _load_newton_mesh(
    newton: Any,
    asset_path: Path,
    scale: tuple[float, float, float],
) -> Any:
    import numpy as np
    import trimesh

    loaded_mesh = trimesh.load(str(asset_path), force="mesh", process=False)
    if isinstance(loaded_mesh, trimesh.Scene):
        geometry = tuple(loaded_mesh.geometry.values())
        if not geometry:
            raise WorldLayoutTransferError(f"Newton could not load mesh asset: {asset_path}")
        loaded_mesh = trimesh.util.concatenate(geometry)
    vertices = np.asarray(loaded_mesh.vertices, dtype=np.float32)
    faces = np.asarray(loaded_mesh.faces, dtype=np.int32)
    if vertices.size == 0 or faces.size == 0:
        raise WorldLayoutTransferError(f"Newton mesh asset is empty: {asset_path}")
    scaled_vertices = vertices * np.asarray(scale, dtype=np.float32)
    return newton.Mesh(
        scaled_vertices,
        faces.reshape(-1),
        maxhullvert=64,
    )


def _add_primitive(
    newton: Any,
    wp: Any,
    builder: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> int:
    xform = _wp_transform(wp, primitive.position_xyz, primitive.quat_wxyz)
    body = -1
    shape_xform = xform
    if not primitive.fixed:
        body = builder.add_body(
            xform=xform,
            mass=primitive.mass_kg if primitive.mass_kg is not None else 1.0,
            label=primitive.sim_name,
        )
        shape_xform = wp.transform()

    cfg = _shape_config(builder, primitive)
    asset_path = resolve_declared_mesh_asset_path(
        primitive,
        asset_roots,
        simulator_label="Newton",
    )
    if asset_path is not None:
        mesh = _load_newton_mesh(
            newton,
            asset_path,
            primitive.asset_scale_xyz or (1.0, 1.0, 1.0),
        )
        return builder.add_shape_mesh(
            body,
            xform=shape_xform,
            mesh=mesh,
            cfg=cfg,
            label=primitive.sim_name,
        )
    if primitive.sim_type == "box":
        return builder.add_shape_box(
            body,
            xform=shape_xform,
            hx=primitive.size_xyz[0] * 0.5,
            hy=primitive.size_xyz[1] * 0.5,
            hz=primitive.size_xyz[2] * 0.5,
            cfg=cfg,
            label=primitive.sim_name,
        )
    if primitive.sim_type == "sphere":
        return builder.add_shape_sphere(
            body,
            xform=shape_xform,
            radius=max(primitive.size_xyz) * 0.5,
            cfg=cfg,
            label=primitive.sim_name,
        )
    if primitive.sim_type == "cylinder":
        return builder.add_shape_cylinder(
            body,
            xform=shape_xform,
            radius=primitive.size_xyz[0] * 0.5,
            half_height=primitive.size_xyz[2] * 0.5,
            cfg=cfg,
            label=primitive.sim_name,
        )
    raise WorldLayoutTransferError(f"Unsupported Newton primitive type: {primitive.sim_type}")


def prepare_newton_workspace_scene(
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
    import newton
    import warp as wp

    newton.use_coord_layout_targets = True
    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in simulator_scene.warnings:
        print(f"[newton-workspace] warning: {warning}", flush=True)

    builder = newton.ModelBuilder()
    builder.default_shape_cfg.mu = 0.6
    builder.default_shape_cfg.ke = 1.0e5
    builder.default_shape_cfg.kd = 1.0e3
    builder.add_urdf(
        str(robot_urdf_path.resolve()),
        xform=wp.transform(wp.vec3(0.0, 0.0, 0.0), wp.quat_identity()),
        floating=free_base,
        enable_self_collisions=NEWTON_SCENE_PARAMS.enable_self_collision,
        force_show_colliders=True,
        ignore_inertial_definitions=NEWTON_SCENE_PARAMS.ignore_inertial_definitions,
    )
    applied_joints = _apply_initial_joint_positions(
        builder,
        dict(simulator_scene.robot.joint_positions),
    )
    object_shape_ids = [
        _add_primitive(
            newton,
            wp,
            builder,
            primitive,
            asset_roots=simulator_scene.robot.asset_roots,
        )
        for primitive in simulator_scene.primitives
    ]
    floor_shape = builder.add_ground_plane(label="urdf_studio_floor") if not no_floor else None

    model = builder.finalize()
    if hasattr(model, "set_gravity"):
        model.set_gravity((0.0, 0.0, -9.81))
    solver = newton.solvers.SolverXPBD(model, iterations=NEWTON_SCENE_PARAMS.solver_iterations)
    state_0 = model.state()
    state_1 = model.state()
    control = model.control()
    contacts = model.contacts()
    newton.eval_fk(model, model.joint_q, model.joint_qd, state_0)

    def step_once() -> None:
        nonlocal state_0, state_1
        state_0.clear_forces()
        model.collide(state_0, contacts)
        solver.step(state_0, state_1, control, contacts, NEWTON_SCENE_PARAMS.sim_dt_sec)
        state_0, state_1 = state_1, state_0

    step_once()
    print(
        "[newton-workspace] "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"robot_loaded=1 robot_joints={model.joint_count} world_objects={len(object_shape_ids)} "
        f"cameras={len(simulator_scene.cameras)} frame_map={simulator_scene.frame_map} "
        f"requested_frame_map={simulator_scene.requested_frame_map} "
        f"applied_initial_joints={applied_joints} newton_step=1 warp_device={wp.get_device()}",
        flush=True,
    )
    if report_path is not None:
        write_simulator_validation_report(
            simulator_scene,
            report_path,
            simulator_id=SIMULATOR_NEWTON_ID,
            simulator_label="Newton",
            runtime={
                "robot_loaded": True,
                "robot_joints": model.joint_count,
                "joint_coord_count": model.joint_coord_count,
                "body_count": model.body_count,
                "shape_count": model.shape_count,
                "world_objects": len(object_shape_ids),
                "cameras": len(simulator_scene.cameras),
                "applied_initial_joints": applied_joints,
                "solver": "SolverXPBD",
                "solver_iterations": NEWTON_SCENE_PARAMS.solver_iterations,
                "step_dt_sec": NEWTON_SCENE_PARAMS.sim_dt_sec,
                "newton_step": True,
                "warp_device": str(wp.get_device()),
                "free_base": free_base,
                "floor": floor_shape is not None,
                "headless": True,
            },
        )
        print(f"[newton-workspace] report written: {report_path}", flush=True)
    print(NEWTON_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
    while True:
        step_once()
        if deadline is not None and time.monotonic() >= deadline:
            break
        if no_viewer:
            break
        time.sleep(1.0 / NEWTON_SCENE_PARAMS.viewer_step_hz)


def main() -> int:
    args = _parse_args()
    prepare_newton_workspace_scene(
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
