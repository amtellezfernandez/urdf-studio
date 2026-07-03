from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import (
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SimulatorId,
)
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.camera_transfer import (
    append_cameras_to_mujoco_mjcf,
)
from backend.services.simulator_adapters.mujoco import apply_mjcf_workspace_repairs
from backend.services.simulator_adapters.mujoco_camera import (
    write_mujoco_camera_screenshots,
)
from backend.services.simulator_adapters.mujoco_scene import (
    configure_mujoco_passive_viewer,
    mujoco_scene_bounds,
)
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import (
    MJLAB_WORKSPACE_PROCESS_PARAMS,
    MUJOCO_SCENE_PARAMS,
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_static_transfer import append_primitives_to_mujoco_mjcf
from backend.services.world_layout_transfer_types import WorldLayoutFrameMap


def _parse_args(
    *,
    default_simulator_id: SimulatorId = SIMULATOR_MUJOCO_ID,
    simulator_choices: tuple[SimulatorId, ...] = (SIMULATOR_MJLAB_ID, SIMULATOR_MUJOCO_ID),
) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in MuJoCo.")
    parser.add_argument("--robot-mjcf", required=True)
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument(
        "--simulator-id",
        choices=simulator_choices,
        default=default_simulator_id,
    )
    add_common_workspace_args(parser)
    parser.add_argument("--camera-screenshot-dir", default="")
    return parser.parse_args()


def _simulator_label(simulator_id: SimulatorId) -> str:
    if simulator_id == SIMULATOR_MJLAB_ID:
        return "MJLab"
    return "MuJoCo"


def _workspace_log_prefix(simulator_id: SimulatorId) -> str:
    if simulator_id == SIMULATOR_MJLAB_ID:
        return "[mjlab-workspace]"
    return "[mujoco-workspace]"


def _workspace_ready_marker(simulator_id: SimulatorId) -> str:
    if simulator_id == SIMULATOR_MJLAB_ID:
        return MJLAB_WORKSPACE_PROCESS_PARAMS.ready_log_marker
    return MUJOCO_WORKSPACE_PROCESS_PARAMS.ready_log_marker


def _apply_initial_joint_positions(model: Any, data: Any, joint_positions: dict[str, float]) -> int:
    applied_count = 0
    for joint_name, position in joint_positions.items():
        if not is_finite_number(position):
            continue
        try:
            joint = data.joint(joint_name)
        except KeyError:
            continue
        qpos = getattr(joint, "qpos", None)
        if qpos is None:
            continue
        try:
            qpos[0] = float(position)
        except (IndexError, TypeError, ValueError):
            continue
        applied_count += 1
    if applied_count:
        import mujoco

        mujoco.mj_forward(model, data)
    return applied_count


def _load_model_with_workspace_repair(mujoco: Any, mjcf_path: Path) -> tuple[Any, Path, tuple[str, ...]]:
    try:
        return mujoco.MjModel.from_xml_path(str(mjcf_path.resolve())), mjcf_path, ()
    except ValueError as exc:
        if not _is_known_mjcf_inertial_load_error(exc):
            raise
        repaired_content, warnings = apply_mjcf_workspace_repairs(mjcf_path.read_text(encoding="utf-8"))
        if not warnings:
            raise
        repaired_path = mjcf_path.with_name(f"{mjcf_path.stem}.repaired{mjcf_path.suffix}")
        repaired_path.write_text(repaired_content, encoding="utf-8")
        model = mujoco.MjModel.from_xml_path(str(repaired_path.resolve()))
        return model, repaired_path, warnings


def _is_known_mjcf_inertial_load_error(error: ValueError) -> bool:
    message = str(error).lower()
    return "inertia" in message or "inertial" in message


def prepare_mujoco_workspace_scene(
    *,
    world_package_path: Path,
    robot_mjcf_path: Path,
    robot_urdf_path: Path,
    simulator_id: SimulatorId,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
    camera_screenshot_dir: Path | None,
    report_path: Path | None,
) -> None:
    import mujoco

    log_prefix = _workspace_log_prefix(simulator_id)
    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in simulator_scene.warnings:
        print(f"{log_prefix} warning: {warning}", flush=True)
    cameras = simulator_scene.cameras

    mjcf_path = robot_mjcf_path
    if simulator_scene.primitives or cameras:
        combined_mjcf = robot_mjcf_path.read_text(encoding="utf-8")
        if simulator_scene.primitives:
            combined_mjcf = append_primitives_to_mujoco_mjcf(
                combined_mjcf,
                simulator_scene.primitives,
                asset_roots=simulator_scene.robot.asset_roots,
            )
        combined_mjcf = append_cameras_to_mujoco_mjcf(combined_mjcf, cameras)
        mjcf_path = robot_mjcf_path.with_name("robot.world.xml")
        mjcf_path.write_text(combined_mjcf, encoding="utf-8")

    model, mjcf_path, mjcf_repair_warnings = _load_model_with_workspace_repair(mujoco, mjcf_path)
    for warning in mjcf_repair_warnings:
        print(f"{log_prefix} warning: {warning}", flush=True)
    data = mujoco.MjData(model)
    applied_joints = _apply_initial_joint_positions(
        model,
        data,
        simulator_scene.robot.joint_positions,
    )
    mujoco.mj_forward(model, data)
    scene_bounds = mujoco_scene_bounds(mujoco, model, data)
    camera_screenshot_count = 0
    if camera_screenshot_dir is not None:
        camera_screenshot_count = write_mujoco_camera_screenshots(
            mujoco,
            model,
            data,
            cameras,
            camera_screenshot_dir,
        )
    print(
        f"{log_prefix} "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"joints={model.njnt} world_objects={len(simulator_scene.primitives)} cameras={len(cameras)} "
        f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map} "
        f"applied_initial_joints={applied_joints}",
        flush=True,
    )
    if camera_screenshot_dir is not None:
        print(f"{log_prefix} camera_screenshots={camera_screenshot_count}", flush=True)
    if report_path is not None:
        write_simulator_validation_report(
            simulator_scene,
            report_path,
            simulator_id=simulator_id,
            simulator_label=_simulator_label(simulator_id),
            runtime={
                "mjcf_path": mjcf_path,
                "source_mjcf_path": robot_mjcf_path,
                "model_joints": model.njnt,
                "world_objects": len(simulator_scene.primitives),
                "cameras": len(cameras),
                "camera_screenshots": camera_screenshot_count,
                "applied_initial_joints": applied_joints,
                "mjcf_repair_warnings": mjcf_repair_warnings,
                "scene_bounds": {
                    "center_xyz": scene_bounds.center_xyz,
                    "radius_m": scene_bounds.radius_m,
                    "min_xyz": scene_bounds.min_xyz,
                    "max_xyz": scene_bounds.max_xyz,
                    "geom_count": scene_bounds.geom_count,
                },
                "viewer_step_hz": MUJOCO_SCENE_PARAMS.viewer_step_hz,
            },
            artifacts={
                "mjcf_path": mjcf_path,
                "camera_screenshot_dir": camera_screenshot_dir,
            },
        )
        print(f"{log_prefix} report written: {report_path}", flush=True)
    print(_workspace_ready_marker(simulator_id), flush=True)

    if no_viewer:
        return

    import mujoco.viewer

    with mujoco.viewer.launch_passive(model, data) as viewer:
        configure_mujoco_passive_viewer(mujoco, model, data, viewer)
        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while viewer.is_running():
            viewer.sync()
            if deadline is not None and time.monotonic() >= deadline:
                break
            time.sleep(1.0 / MUJOCO_SCENE_PARAMS.viewer_step_hz)


def main(
    *,
    default_simulator_id: SimulatorId = SIMULATOR_MUJOCO_ID,
    simulator_choices: tuple[SimulatorId, ...] = (SIMULATOR_MJLAB_ID, SIMULATOR_MUJOCO_ID),
) -> int:
    args = _parse_args(
        default_simulator_id=default_simulator_id,
        simulator_choices=simulator_choices,
    )
    prepare_mujoco_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_mjcf_path=Path(args.robot_mjcf),
        robot_urdf_path=Path(args.robot_urdf),
        simulator_id=args.simulator_id,
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
        camera_screenshot_dir=Path(args.camera_screenshot_dir) if args.camera_screenshot_dir else None,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
