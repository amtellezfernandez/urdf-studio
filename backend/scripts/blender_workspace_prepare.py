from __future__ import annotations

import argparse
import os
import subprocess
import sys
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

BLENDER_EDIT_SESSION_LOADED_MARKER = "[urdf-studio-blender] edit session loaded:"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a URDF Studio visual layout edit session in Blender."
    )
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument("--blender", default="")
    add_common_workspace_args(parser)
    parser.add_argument("--camera-screenshot-dir", default="")
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
    camera_screenshot_dir: Path | None = None,
) -> None:
    world_package_path = world_package_path.expanduser().resolve()
    robot_urdf_path = robot_urdf_path.expanduser().resolve()
    report_path = report_path.expanduser().resolve() if report_path is not None else None
    camera_screenshot_dir = (
        camera_screenshot_dir.expanduser().resolve()
        if camera_screenshot_dir is not None
        else None
    )
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
        camera_screenshot_dir=camera_screenshot_dir,
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
                "robot_glb_path": artifacts.robot_glb_path,
                "robot_usd_path": artifacts.robot_usd_path,
                "camera_screenshot_dir": camera_screenshot_dir,
            },
            artifacts={
                "edit_session_path": artifacts.edit_session_path,
                "open_script_path": artifacts.open_script_path,
                "export_script_path": artifacts.export_script_path,
                "change_set_path": artifacts.change_set_path,
                "robot_glb_path": artifacts.robot_glb_path,
                "robot_usd_path": artifacts.robot_usd_path,
                "blend_path": blend_path,
                "camera_screenshot_dir": camera_screenshot_dir,
            },
        )
        print(f"[blender-workspace] report written: {report_path}", flush=True)
    print(f"[blender-workspace] edit_session={artifacts.edit_session_path}", flush=True)

    if no_viewer and blender_executable is None:
        print(BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)
        if duration_sec > 0:
            time.sleep(duration_sec)
        return
    if blender_executable is None:
        raise RuntimeError(
            f"Blender executable was not found. Install Blender or set {BLENDER_PATH_ENV}."
        )
    _run_blender_workspace_until_ready(
        blender_executable=blender_executable,
        open_script_path=artifacts.open_script_path,
        blend_path=blend_path,
        cwd=world_package_path.parent,
        background=no_viewer,
    )


def _run_blender_workspace_until_ready(
    *,
    blender_executable: str,
    open_script_path: Path,
    blend_path: Path | None = None,
    cwd: Path,
    background: bool = False,
) -> None:
    open_script_path = open_script_path.expanduser().resolve()
    blend_path = blend_path.expanduser().resolve() if blend_path is not None else None
    cwd = cwd.expanduser().resolve()
    if background:
        _build_blender_workspace_file(
            blender_executable=blender_executable,
            open_script_path=open_script_path,
            cwd=cwd,
        )
        print(BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)
        return
    if blend_path is None:
        raise RuntimeError("Interactive Blender workspace launch requires a saved .blend path.")
    _build_blender_workspace_file(
        blender_executable=blender_executable,
        open_script_path=open_script_path,
        cwd=cwd,
    )
    _open_blender_saved_workspace(
        blender_executable=blender_executable,
        blend_path=blend_path,
        cwd=cwd,
    )


def _build_blender_workspace_file(
    *,
    blender_executable: str,
    open_script_path: Path,
    cwd: Path,
) -> None:
    command = [
        blender_executable,
        "--background",
        "--python-exit-code",
        "1",
        "--python",
        str(open_script_path),
    ]
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=_blender_process_env(background=True),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        bufsize=1,
    )
    ready = False
    try:
        assert process.stdout is not None
        for line in process.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            if not ready and BLENDER_EDIT_SESSION_LOADED_MARKER in line:
                ready = True
        returncode = process.wait()
    except KeyboardInterrupt:
        process.terminate()
        raise
    if not ready:
        raise RuntimeError(
            f"Blender exited before loading the URDF Studio edit session with code {returncode}."
        )
    if returncode != 0:
        raise RuntimeError(f"Blender workspace process exited with code {returncode}.")


def _open_blender_saved_workspace(
    *,
    blender_executable: str,
    blend_path: Path,
    cwd: Path,
    startup_grace_sec: float = BLENDER_WORKSPACE_PROCESS_PARAMS.post_ready_grace_sec,
) -> None:
    if not blend_path.is_file():
        raise RuntimeError(f"Blender workspace .blend was not created: {blend_path}")
    command = [
        blender_executable,
        "--window-geometry",
        "80",
        "80",
        "1440",
        "900",
        str(blend_path),
    ]
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=_blender_process_env(background=False),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        bufsize=1,
    )
    try:
        time.sleep(startup_grace_sec)
        returncode = process.poll()
        if returncode is not None:
            raise RuntimeError(
                f"Blender exited before opening the saved workspace with code {returncode}."
            )
        print(BLENDER_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)
        assert process.stdout is not None
        for line in process.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
        returncode = process.wait()
    except KeyboardInterrupt:
        process.terminate()
        raise
    if returncode != 0:
        raise RuntimeError(f"Blender workspace process exited with code {returncode}.")


def _blender_process_env(*, background: bool) -> dict[str, str]:
    env = os.environ.copy()
    if background or not _is_wsl_environment():
        return env
    env["GDK_BACKEND"] = "x11"
    env["QT_QPA_PLATFORM"] = "xcb"
    env.pop("WAYLAND_DISPLAY", None)
    return env


def _is_wsl_environment() -> bool:
    if os.environ.get("WSL_DISTRO_NAME") or os.environ.get("WSL_INTEROP"):
        return True
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8").lower()
    except OSError:
        return False


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
        camera_screenshot_dir=(
            Path(args.camera_screenshot_dir) if args.camera_screenshot_dir else None
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
