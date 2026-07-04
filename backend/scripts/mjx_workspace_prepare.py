from __future__ import annotations

import argparse
import time
from pathlib import Path

from backend.models.simulator_runtime import SIMULATOR_MJX_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.mjx_rollout_runner import MjxRolloutBatchConfig, run_mjx_rollout_batch
from backend.services.simulator_adapters.params import MJX_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_static_transfer import append_primitives_to_mujoco_mjcf
from backend.services.world_layout_transfer_types import WorldLayoutFrameMap

_INSPECTION_STEPS = 20
_IDLE_POLL_SEC = 1.0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in MJX.")
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument("--robot-mjcf", default="")
    add_common_workspace_args(parser)
    return parser.parse_args()


def prepare_mjx_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    robot_mjcf_path: Path | None,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    report_path: Path | None,
) -> None:
    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    for warning in simulator_scene.warnings:
        print(f"[mjx-workspace] warning: {warning}", flush=True)
    model_xml_path = robot_mjcf_path
    if model_xml_path is not None and simulator_scene.primitives:
        combined_mjcf = append_primitives_to_mujoco_mjcf(
            model_xml_path.read_text(encoding="utf-8"),
            simulator_scene.primitives,
            asset_roots=simulator_scene.robot.asset_roots,
        )
        model_xml_path = model_xml_path.with_name("robot.world.xml")
        model_xml_path.write_text(combined_mjcf, encoding="utf-8")
    config = MjxRolloutBatchConfig(
        urdf_xml="" if model_xml_path is not None else robot_urdf_path.read_text(encoding="utf-8"),
        model_xml_path=model_xml_path,
        episode_count=1,
        steps_per_episode=_INSPECTION_STEPS,
    )
    episode = run_mjx_rollout_batch(config)[0]

    print(
        f"[mjx-workspace] "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"robot_urdf={robot_urdf_path} world_objects={len(simulator_scene.primitives)} "
        f"cameras={len(simulator_scene.cameras)} frame_map={simulator_scene.frame_map} "
        f"requested_frame_map={simulator_scene.requested_frame_map} "
        f"frame_count={len(episode.trace.frames)} diverged={episode.diverged} "
        f"wall_time_ms={episode.wall_time_ms:.2f}",
        flush=True,
    )
    if report_path is not None:
        write_simulator_validation_report(
            simulator_scene,
            report_path,
            simulator_id=SIMULATOR_MJX_ID,
            simulator_label="MJX",
            runtime={
                "model_xml_path": model_xml_path,
                "steps": _INSPECTION_STEPS,
                "diverged": episode.diverged,
                "wall_time_ms": episode.wall_time_ms,
                "frame_count": len(episode.trace.frames),
            },
        )
        print(f"[mjx-workspace] report written: {report_path}", flush=True)

    print(MJX_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            break
        time.sleep(_IDLE_POLL_SEC)


def main() -> int:
    args = _parse_args()
    prepare_mjx_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        robot_mjcf_path=Path(args.robot_mjcf) if args.robot_mjcf else None,
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
