from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

from backend.services.simulator_adapters.camera_transfer import (
    append_cameras_to_mujoco_mjcf,
    build_sim_camera_specs,
)
from backend.services.simulator_adapters.mujoco import apply_mjcf_launch_repairs
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import MUJOCO_LAUNCH_PARAMS, MUJOCO_SCENE_PARAMS
from backend.services.simulator_adapters.world_scene import prepare_world_scene
from backend.services.world_layout_static_transfer import (
    WorldLayoutFrameMap,
    append_primitives_to_mujoco_mjcf,
)

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open a URDF Studio robot in MuJoCo.")
    parser.add_argument("--world-package", required=True)
    parser.add_argument("--robot-mjcf", required=True)
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument(
        "--frame-map",
        choices=["auto", "studio-y-up-to-z-up", "identity"],
        default="auto",
    )
    parser.add_argument("--duration-sec", type=float, default=0.0)
    parser.add_argument("--include-hidden", action="store_true")
    parser.add_argument("--no-viewer", action="store_true")
    return parser.parse_args()


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


def _load_model_with_launch_repair(mujoco: Any, mjcf_path: Path) -> tuple[Any, Path, tuple[str, ...]]:
    try:
        return mujoco.MjModel.from_xml_path(str(mjcf_path.resolve())), mjcf_path, ()
    except ValueError as exc:
        if not _is_known_mjcf_inertial_load_error(exc):
            raise
        repaired_content, warnings = apply_mjcf_launch_repairs(mjcf_path.read_text(encoding="utf-8"))
        if not warnings:
            raise
        repaired_path = mjcf_path.with_name(f"{mjcf_path.stem}.repaired{mjcf_path.suffix}")
        repaired_path.write_text(repaired_content, encoding="utf-8")
        model = mujoco.MjModel.from_xml_path(str(repaired_path.resolve()))
        return model, repaired_path, warnings


def _is_known_mjcf_inertial_load_error(error: ValueError) -> bool:
    message = str(error).lower()
    return "inertia" in message or "inertial" in message


def open_mujoco_world_scene(
    *,
    world_package_path: Path,
    robot_mjcf_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
) -> None:
    import mujoco

    prepared_scene = prepare_world_scene(
        world_package_path=world_package_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in prepared_scene.warnings:
        print(f"[mujoco-world-open] warning: {warning}", flush=True)
    cameras, camera_warnings = build_sim_camera_specs(
        prepared_scene.world_package,
        robot_urdf_path=robot_urdf_path,
    )
    for warning in camera_warnings:
        print(f"[mujoco-world-open] warning: {warning}", flush=True)

    mjcf_path = robot_mjcf_path
    if prepared_scene.primitives or cameras:
        combined_mjcf = robot_mjcf_path.read_text(encoding="utf-8")
        if prepared_scene.primitives:
            combined_mjcf = append_primitives_to_mujoco_mjcf(
                combined_mjcf,
                prepared_scene.primitives,
            )
        combined_mjcf = append_cameras_to_mujoco_mjcf(combined_mjcf, cameras)
        mjcf_path = robot_mjcf_path.with_name("robot.world.xml")
        mjcf_path.write_text(combined_mjcf, encoding="utf-8")

    model, mjcf_path, mjcf_repair_warnings = _load_model_with_launch_repair(mujoco, mjcf_path)
    for warning in mjcf_repair_warnings:
        print(f"[mujoco-world-open] warning: {warning}", flush=True)
    data = mujoco.MjData(model)
    applied_joints = _apply_initial_joint_positions(
        model,
        data,
        prepared_scene.world_package.world_snapshot.joint_positions,
    )
    print(
        "[mujoco-world-open] "
        f"package={prepared_scene.world_package.package_id}@{prepared_scene.world_package.version} "
        f"joints={model.njnt} world_objects={len(prepared_scene.primitives)} cameras={len(cameras)} "
        f"frame_map={prepared_scene.frame_map} requested_frame_map={frame_map} "
        f"applied_initial_joints={applied_joints}",
        flush=True,
    )
    print(MUJOCO_LAUNCH_PARAMS.ready_log_marker, flush=True)

    if no_viewer:
        mujoco.mj_forward(model, data)
        return

    import mujoco.viewer

    with mujoco.viewer.launch_passive(model, data) as viewer:
        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while viewer.is_running():
            viewer.sync()
            if deadline is not None and time.monotonic() >= deadline:
                break
            time.sleep(1.0 / MUJOCO_SCENE_PARAMS.viewer_step_hz)


def main() -> int:
    args = _parse_args()
    open_mujoco_world_scene(
        world_package_path=Path(args.world_package),
        robot_mjcf_path=Path(args.robot_mjcf),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
