from __future__ import annotations

import argparse
import time
from pathlib import Path

from backend.models.simulator_runtime import SIMULATOR_PYBULLET_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.params import (
    PYBULLET_SCENE_PARAMS,
    PYBULLET_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.pybullet_camera import (
    write_pybullet_camera_screenshots,
)
from backend.services.simulator_adapters.pybullet_primitives import (
    add_pybullet_camera_marker,
    add_pybullet_primitive,
)
from backend.services.simulator_adapters.pybullet_scene import (
    advance_pybullet_viewer_frame,
    apply_initial_pybullet_joint_positions,
    configure_pybullet_debug_camera,
    configure_pybullet_static_debug_viewer,
    configure_pybullet_static_interactive_viewer_gravity,
    hold_pybullet_current_joint_positions,
    is_pybullet_connected,
    pump_pybullet_static_debug_viewer,
    require_pybullet_gui_environment,
    should_step_pybullet_workspace_once,
    suspend_pybullet_gui_rendering_while_loading,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in PyBullet.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    parser.add_argument("--no-floor", action="store_true")
    parser.add_argument("--free-base", action="store_true")
    parser.add_argument("--show-camera-markers", action="store_true")
    parser.add_argument("--camera-screenshot-dir", default="")
    return parser.parse_args()


def _elapsed_ms(started_at: float) -> float:
    return round((time.perf_counter() - started_at) * 1000.0, 3)


def prepare_pybullet_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_floor: bool,
    no_viewer: bool,
    free_base: bool,
    show_camera_markers: bool,
    camera_screenshot_dir: Path | None,
    report_path: Path | None,
) -> None:
    import pybullet
    import pybullet_data

    total_started_at = time.perf_counter()
    timings_ms: dict[str, float] = {}
    prepare_scene_started_at = time.perf_counter()
    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    timings_ms["prepare_scene"] = _elapsed_ms(prepare_scene_started_at)
    for warning in simulator_scene.warnings:
        print(f"[pybullet-workspace] warning: {warning}", flush=True)
    cameras = simulator_scene.cameras

    require_pybullet_gui_environment(no_viewer=no_viewer)
    connection_mode = pybullet.DIRECT if no_viewer else pybullet.GUI
    connection_label = "direct" if no_viewer else "gui"
    connect_started_at = time.perf_counter()
    client_id = pybullet.connect(connection_mode)
    timings_ms["connect"] = _elapsed_ms(connect_started_at)
    if client_id < 0:
        raise RuntimeError(f"PyBullet could not open a {connection_label} simulation connection.")
    try:
        debug_viewer_state = configure_pybullet_static_debug_viewer(pybullet, no_viewer=no_viewer)
        pybullet.setAdditionalSearchPath(pybullet_data.getDataPath())
        pybullet.setGravity(*PYBULLET_SCENE_PARAMS.gravity_xyz)
        load_scene_started_at = time.perf_counter()
        with suspend_pybullet_gui_rendering_while_loading(pybullet, no_viewer=no_viewer) as suspended_rendering:
            if not no_floor:
                pybullet.loadURDF("plane.urdf", useFixedBase=True)
            robot_id = pybullet.loadURDF(
                str(robot_urdf_path.resolve()),
                basePosition=PYBULLET_SCENE_PARAMS.robot_base_position_xyz,
                baseOrientation=PYBULLET_SCENE_PARAMS.robot_base_orientation_xyzw,
                useFixedBase=not free_base,
            )
            applied_joints = apply_initial_pybullet_joint_positions(
                pybullet,
                robot_id,
                simulator_scene.robot.joint_positions,
            )
            held_joints = hold_pybullet_current_joint_positions(pybullet, robot_id)
            object_ids = [
                add_pybullet_primitive(pybullet, primitive, asset_roots=simulator_scene.robot.asset_roots)
                for primitive in simulator_scene.primitives
            ]
            camera_marker_ids = (
                [add_pybullet_camera_marker(pybullet, camera) for camera in cameras]
                if show_camera_markers
                else []
            )
        timings_ms["load_scene"] = _elapsed_ms(load_scene_started_at)
        viewer_camera = configure_pybullet_debug_camera(
            pybullet,
            no_viewer=no_viewer,
            body_ids=(robot_id, *object_ids),
        )
        static_viewer_gravity = configure_pybullet_static_interactive_viewer_gravity(
            pybullet,
            no_viewer=no_viewer,
            free_base=free_base,
        )
        viewer_pump_state = pump_pybullet_static_debug_viewer(pybullet, no_viewer=no_viewer)
        if should_step_pybullet_workspace_once(
            no_viewer=no_viewer,
            free_base=free_base,
            camera_screenshot_dir=camera_screenshot_dir,
            report_path=report_path,
        ):
            step_started_at = time.perf_counter()
            pybullet.stepSimulation()
            timings_ms["step_once"] = _elapsed_ms(step_started_at)
        camera_screenshot_count = 0
        if camera_screenshot_dir is not None:
            camera_screenshot_started_at = time.perf_counter()
            camera_screenshot_count = write_pybullet_camera_screenshots(
                pybullet,
                cameras,
                camera_screenshot_dir,
                near_m=PYBULLET_SCENE_PARAMS.camera_near_m,
                far_m=PYBULLET_SCENE_PARAMS.camera_far_m,
            )
            timings_ms["camera_screenshots"] = _elapsed_ms(camera_screenshot_started_at)
        timings_ms["to_ready"] = _elapsed_ms(total_started_at)
        print(
            "[pybullet-workspace] "
            f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
            f"robot_joints={pybullet.getNumJoints(robot_id)} world_objects={len(object_ids)} "
            f"cameras={len(cameras)} camera_markers={len(camera_marker_ids)} "
            f"connection_mode={connection_label} "
            f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map} "
            f"applied_initial_joints={applied_joints} held_joints={held_joints} "
            f"static_view={not free_base} static_viewer_gravity={static_viewer_gravity} "
            f"debug_viewer={debug_viewer_state} "
            f"viewer_camera={viewer_camera} viewer_pump={viewer_pump_state} startup_ms={timings_ms}",
            flush=True,
        )
        if camera_screenshot_dir is not None:
            print(f"[pybullet-workspace] camera_screenshots={camera_screenshot_count}", flush=True)
        if report_path is not None:
            write_simulator_validation_report(
                simulator_scene,
                report_path,
                simulator_id=SIMULATOR_PYBULLET_ID,
                simulator_label="PyBullet",
                runtime={
                    "connection_mode": connection_label,
                    "client_id": client_id,
                    "robot_id": robot_id,
                    "robot_joints": pybullet.getNumJoints(robot_id),
                    "world_objects": len(object_ids),
                    "cameras": len(cameras),
                    "camera_markers": len(camera_marker_ids),
                    "camera_screenshots": camera_screenshot_count,
                    "applied_initial_joints": applied_joints,
                    "held_joints": held_joints,
                    "static_view": not free_base,
                    "free_base": free_base,
                    "floor": not no_floor,
                    "static_viewer_gravity": static_viewer_gravity,
                    "debug_viewer": debug_viewer_state,
                    "viewer_camera": viewer_camera,
                    "viewer_pump": viewer_pump_state,
                    "suspended_rendering_during_load": suspended_rendering,
                    "startup_timings_ms": timings_ms,
                },
                artifacts={
                    "camera_screenshot_dir": camera_screenshot_dir,
                },
            )
            print(f"[pybullet-workspace] report written: {report_path}", flush=True)
        print(PYBULLET_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while True:
            if not is_pybullet_connected(pybullet, client_id):
                break
            advance_pybullet_viewer_frame(
                pybullet,
                no_viewer=no_viewer,
                free_base=free_base,
            )
            if deadline is not None and time.monotonic() >= deadline:
                break
            if no_viewer:
                break
            time.sleep(1.0 / PYBULLET_SCENE_PARAMS.viewer_step_hz)
    finally:
        pybullet.disconnect()


def main() -> int:
    args = _parse_args()
    prepare_pybullet_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_floor=args.no_floor,
        no_viewer=args.no_viewer,
        free_base=args.free_base,
        show_camera_markers=args.show_camera_markers,
        camera_screenshot_dir=Path(args.camera_screenshot_dir) if args.camera_screenshot_dir else None,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
