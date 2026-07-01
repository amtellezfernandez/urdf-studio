from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import SIMULATOR_MJX_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.camera_transfer import (
    append_cameras_to_mujoco_mjcf,
)
from backend.services.simulator_adapters.mujoco_workspace import (
    apply_initial_joint_positions,
    load_model_with_workspace_repair,
)
from backend.services.simulator_adapters.params import (
    MJX_WORKSPACE_PROCESS_PARAMS,
    MUJOCO_SCENE_PARAMS,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_static_transfer import append_primitives_to_mujoco_mjcf
from backend.services.world_layout_transfer_types import WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in MuJoCo MJX.")
    parser.add_argument("--robot-mjcf", required=True)
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    return parser.parse_args()


def _prepare_world_mjcf(
    *,
    robot_mjcf_path: Path,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    include_hidden: bool,
) -> tuple[Any, Path, tuple[str, ...], Any]:
    import mujoco

    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    mjcf_path = robot_mjcf_path
    if simulator_scene.primitives or simulator_scene.cameras:
        combined_mjcf = robot_mjcf_path.read_text(encoding="utf-8")
        if simulator_scene.primitives:
            combined_mjcf = append_primitives_to_mujoco_mjcf(
                combined_mjcf,
                simulator_scene.primitives,
                asset_roots=simulator_scene.robot.asset_roots,
            )
        combined_mjcf = append_cameras_to_mujoco_mjcf(combined_mjcf, simulator_scene.cameras)
        mjcf_path = robot_mjcf_path.with_name("robot.mjx.world.xml")
        mjcf_path.write_text(combined_mjcf, encoding="utf-8")
    model, mjcf_path, repair_warnings = load_model_with_workspace_repair(mujoco, mjcf_path)
    return model, mjcf_path, repair_warnings, simulator_scene


def prepare_mjx_workspace_scene(
    *,
    world_package_path: Path,
    robot_mjcf_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
    report_path: Path | None,
) -> None:
    import jax
    import mujoco
    from mujoco import mjx

    model, mjcf_path, mjcf_repair_warnings, simulator_scene = _prepare_world_mjcf(
        robot_mjcf_path=robot_mjcf_path,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in (*simulator_scene.warnings, *mjcf_repair_warnings):
        print(f"[mjx-workspace] warning: {warning}", flush=True)
    data = mujoco.MjData(model)
    applied_joints = apply_initial_joint_positions(
        mujoco,
        model,
        data,
        simulator_scene.robot.joint_positions,
    )
    mujoco.mj_forward(model, data)
    mjx_model = mjx.put_model(model)
    mjx_data = mjx.put_data(model, data)
    mjx_data = mjx.step(mjx_model, mjx_data)
    print(
        "[mjx-workspace] "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"joints={model.njnt} world_objects={len(simulator_scene.primitives)} "
        f"cameras={len(simulator_scene.cameras)} frame_map={simulator_scene.frame_map} "
        f"requested_frame_map={simulator_scene.requested_frame_map} "
        f"applied_initial_joints={applied_joints} mjx_step=1 jax_backend={jax.default_backend()}",
        flush=True,
    )
    if report_path is not None:
        write_simulator_validation_report(
            simulator_scene,
            report_path,
            simulator_id=SIMULATOR_MJX_ID,
            simulator_label="MuJoCo MJX",
            runtime={
                "mjcf_path": mjcf_path,
                "source_mjcf_path": robot_mjcf_path,
                "model_joints": model.njnt,
                "model_geoms": model.ngeom,
                "world_objects": len(simulator_scene.primitives),
                "cameras": len(simulator_scene.cameras),
                "applied_initial_joints": applied_joints,
                "mjcf_repair_warnings": mjcf_repair_warnings,
                "mjx_step": True,
                "jax_backend": jax.default_backend(),
                "qpos_size": int(mjx_data.qpos.size),
            },
            artifacts={
                "mjcf_path": mjcf_path,
            },
        )
        print(f"[mjx-workspace] report written: {report_path}", flush=True)
    print(MJX_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
    while True:
        mjx_data = mjx.step(mjx_model, mjx_data)
        if deadline is not None and time.monotonic() >= deadline:
            break
        if no_viewer:
            break
        time.sleep(1.0 / MUJOCO_SCENE_PARAMS.viewer_step_hz)


def main() -> int:
    args = _parse_args()
    prepare_mjx_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_mjcf_path=Path(args.robot_mjcf),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
