from __future__ import annotations

import argparse
import subprocess
import time
from pathlib import Path

from backend.models.simulator_runtime import SIMULATOR_BLENDER_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.blender_runtime import (
    BLENDER_PATH_ENV,
    resolve_blender_executable,
)
from backend.services.simulator_adapters.blender_workspace import (
    write_blender_workspace_artifacts,
)
from backend.services.simulator_adapters.params import (
    BLENDER_SCENE_PARAMS,
    BLENDER_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a URDF Studio visual layout edit session in Blender."
    )
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument("--blender", default="")
    add_common_workspace_args(parser)
    return parser.parse_args()


def prepare_blender_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
    report_path: Path | None,
    blender_executable: str | None,
) -> None:
    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    artifact_dir = world_package_path.parent / "artifacts"
    blend_path = world_package_path.parent / "blender" / "urdf-studio-layout.blend"
    artifacts = write_blender_workspace_artifacts(
        simulator_scene,
        artifact_dir=artifact_dir,
        robot_urdf_path=robot_urdf_path,
        blend_path=blend_path,
    )
    for warning in simulator_scene.warnings:
        print(f"[blender-workspace] warning: {warning}", flush=True)
    print(
        "[blender-workspace] "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"world_objects={len(simulator_scene.primitives)} cameras={len(simulator_scene.cameras)} "
        f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map}",
        flush=True,
    )
    if report_path is not None:
        write_simulator_validation_report(
            simulator_scene,
            report_path,
            simulator_id=SIMULATOR_BLENDER_ID,
            simulator_label="Blender",
            runtime={
                "mode": BLENDER_SCENE_PARAMS.workspace_mode,
                "blender_executable": blender_executable,
                "edit_session_path": artifacts.edit_session_path,
                "open_script_path": artifacts.open_script_path,
                "export_script_path": artifacts.export_script_path,
                "change_set_path": artifacts.change_set_path,
            },
            artifacts={
                "edit_session_path": artifacts.edit_session_path,
                "open_script_path": artifacts.open_script_path,
                "export_script_path": artifacts.export_script_path,
                "change_set_path": artifacts.change_set_path,
                "blend_path": blend_path,
            },
        )
        print(f"[blender-workspace] report written: {report_path}", flush=True)
    print(f"[blender-workspace] edit_session={artifacts.edit_session_path}", flush=True)

    if no_viewer:
        print(BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)
        if duration_sec > 0:
            time.sleep(duration_sec)
        return
    if blender_executable is None:
        raise RuntimeError(
            f"Blender executable was not found. Install Blender or set {BLENDER_PATH_ENV}."
        )
    process = subprocess.Popen(
        [
            blender_executable,
            "--python",
            str(artifacts.open_script_path),
        ],
        cwd=world_package_path.parent,
    )
    print(BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)
    try:
        while process.poll() is None:
            time.sleep(0.5)
    except KeyboardInterrupt:
        process.terminate()
        raise


def main() -> int:
    args = _parse_args()
    blender_executable = resolve_blender_executable(args.blender)
    prepare_blender_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
        report_path=Path(args.report) if args.report else None,
        blender_executable=blender_executable,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
