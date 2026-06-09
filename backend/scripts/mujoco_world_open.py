from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters.params import MUJOCO_LAUNCH_PARAMS
from backend.services.world_layout_static_transfer import (
    WorldLayoutFrameMap,
    append_primitives_to_mujoco_mjcf,
    build_sim_primitives,
    parse_static_world_layout_payload,
    resolve_world_layout_frame_map,
)


MUJOCO_VIEWER_STEP_HZ = 60.0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open a URDF Studio robot in MuJoCo.")
    parser.add_argument("--world-package", required=True)
    parser.add_argument("--robot-mjcf", required=True)
    parser.add_argument(
        "--frame-map",
        choices=["auto", "studio-y-up-to-z-up", "identity"],
        default="auto",
    )
    parser.add_argument("--duration-sec", type=float, default=0.0)
    parser.add_argument("--include-hidden", action="store_true")
    parser.add_argument("--no-viewer", action="store_true")
    return parser.parse_args()


def _load_world_package(path: Path) -> WorldScenePackageManifest:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Failed to read world package: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid world package JSON: {exc}") from exc
    return WorldScenePackageManifest.model_validate(payload)


def _apply_initial_joint_positions(model: Any, data: Any, joint_positions: dict[str, float]) -> int:
    applied_count = 0
    for joint_name, position in joint_positions.items():
        if not isinstance(position, int | float) or not math.isfinite(position):
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


def open_mujoco_world_scene(
    *,
    world_package_path: Path,
    robot_mjcf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
) -> None:
    import mujoco

    world_package = _load_world_package(world_package_path)
    layout = parse_static_world_layout_payload(world_package.model_dump(mode="json"))
    resolved_frame_map = resolve_world_layout_frame_map(layout, frame_map)
    primitives, warnings = build_sim_primitives(
        layout,
        frame_map=resolved_frame_map,
        include_hidden=include_hidden,
    )
    for warning in warnings:
        print(f"[mujoco-world-open] warning: {warning}", flush=True)

    mjcf_path = robot_mjcf_path
    if primitives:
        combined_mjcf = append_primitives_to_mujoco_mjcf(
            robot_mjcf_path.read_text(encoding="utf-8"),
            primitives,
        )
        mjcf_path = robot_mjcf_path.with_name("robot.world.xml")
        mjcf_path.write_text(combined_mjcf, encoding="utf-8")

    model = mujoco.MjModel.from_xml_path(str(mjcf_path.resolve()))
    data = mujoco.MjData(model)
    applied_joints = _apply_initial_joint_positions(
        model,
        data,
        world_package.world_snapshot.joint_positions,
    )
    print(
        "[mujoco-world-open] "
        f"package={world_package.package_id}@{world_package.version} "
        f"joints={model.njnt} world_objects={len(primitives)} "
        f"frame_map={resolved_frame_map} requested_frame_map={frame_map} "
        f"applied_initial_joints={applied_joints}",
        flush=True,
    )
    print(MUJOCO_LAUNCH_PARAMS.ready_log_marker, flush=True)

    if no_viewer:
        mujoco.mj_step(model, data)
        return

    import mujoco.viewer

    if duration_sec <= 0:
        mujoco.viewer.launch(model, data)
        return

    with mujoco.viewer.launch_passive(model, data) as viewer:
        deadline = time.monotonic() + duration_sec
        while viewer.is_running() and time.monotonic() < deadline:
            step_started = time.monotonic()
            mujoco.mj_step(model, data)
            viewer.sync()
            sleep_sec = (1.0 / MUJOCO_VIEWER_STEP_HZ) - (time.monotonic() - step_started)
            if sleep_sec > 0:
                time.sleep(sleep_sec)


def main() -> int:
    args = _parse_args()
    open_mujoco_world_scene(
        world_package_path=Path(args.world_package),
        robot_mjcf_path=Path(args.robot_mjcf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
