from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.mjx_rollout_runner import MjxRolloutBatchConfig, run_mjx_rollout_batch
from backend.services.simulator_adapters.params import MJX_WORKSPACE_PROCESS_PARAMS

_INSPECTION_STEPS = 20
_IDLE_POLL_SEC = 1.0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in MJX.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    return parser.parse_args()


def prepare_mjx_workspace_scene(
    *,
    robot_urdf_path: Path,
    duration_sec: float,
    report_path: Path | None,
) -> None:
    urdf_xml = robot_urdf_path.read_text(encoding="utf-8")
    config = MjxRolloutBatchConfig(urdf_xml=urdf_xml, episode_count=1, steps_per_episode=_INSPECTION_STEPS)
    episode = run_mjx_rollout_batch(config)[0]

    print(
        f"[mjx-workspace] robot_urdf={robot_urdf_path} frame_count={len(episode.trace.frames)} "
        f"diverged={episode.diverged} wall_time_ms={episode.wall_time_ms:.2f}",
        flush=True,
    )
    if report_path is not None:
        report = {
            "robot_urdf_path": str(robot_urdf_path),
            "rollout": {
                "steps": _INSPECTION_STEPS,
                "diverged": episode.diverged,
                "wall_time_ms": episode.wall_time_ms,
                "frame_count": len(episode.trace.frames),
            },
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")
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
        robot_urdf_path=Path(args.robot_urdf),
        duration_sec=args.duration_sec,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
