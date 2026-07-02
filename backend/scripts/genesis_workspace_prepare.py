from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from backend.models.simulator_runtime import SIMULATOR_GENESIS_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.camera_transfer import SimCameraSpec
from backend.services.simulator_adapters.genesis_camera import (
    add_camera_marker_entity,
    add_observation_camera_sensor,
    add_scene_camera,
    attach_scene_camera_to_robot_link,
    read_observation_camera_sensor_images,
    write_camera_screenshots,
    write_sensor_screenshots,
)
from backend.services.simulator_adapters.genesis_robot import (
    apply_joint_values,
    configure_robot_position_controller,
    joint_dof_indices_by_name,
    links_to_keep_for_camera_attachment,
    links_to_keep_for_workspace_attachments,
    robot_urdf_morph_kwargs,
)
from backend.services.simulator_adapters.genesis_scene import (
    add_floor_entity,
    add_primitive_entity,
    scene_center_and_radius,
)
from backend.services.simulator_adapters.params import (
    GENESIS_SCENE_PARAMS,
    GENESIS_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.robot_repairs import (
    genesis_robot_compatibility_patch_ids_from_world_package,
    materialize_genesis_robot_urdf_report,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap

GENESIS_BACKEND_ENV = "URDF_STUDIO_GENESIS_BACKEND"
GENESIS_PERFORMANCE_MODE_ENV = "URDF_STUDIO_GENESIS_PERFORMANCE_MODE"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a URDF Studio workspace in Genesis."
    )
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    parser.add_argument("--no-floor", action="store_true")
    parser.add_argument("--screenshot", default="")
    parser.add_argument("--screenshot-width", type=int, default=1280)
    parser.add_argument("--screenshot-height", type=int, default=720)
    parser.add_argument("--camera-screenshot-dir", default="")
    parser.add_argument("--sensor-screenshot-dir", default="")
    parser.add_argument("--show-camera-markers", action="store_true")
    return parser.parse_args()


def _viewer_run_in_thread() -> bool:
    return sys.platform != "darwin"


def _truthy_env(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _genesis_performance_mode() -> bool:
    return _truthy_env(os.getenv(GENESIS_PERFORMANCE_MODE_ENV))


def _torch_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available() and torch.version.cuda)
    except Exception:
        return False


def _torch_hip_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available() and torch.version.hip)
    except Exception:
        return False


def _torch_mps_available() -> bool:
    try:
        import torch

        return bool(torch.backends.mps.is_available())
    except Exception:
        return False


def _quadrants_backend_supported(backend_name: str) -> bool:
    try:
        import quadrants as qd
        from quadrants.lang.misc import is_arch_supported

        arch = getattr(qd, backend_name)
        return bool(is_arch_supported(arch))
    except Exception:
        return False


def _available_genesis_gpu_backend_name(gs) -> str | None:
    if (
        hasattr(gs, "cuda")
        and _torch_cuda_available()
        and _quadrants_backend_supported("cuda")
    ):
        return "cuda"
    if (
        hasattr(gs, "amdgpu")
        and _torch_hip_available()
        and _quadrants_backend_supported("amdgpu")
    ):
        return "amdgpu"
    if (
        sys.platform == "darwin"
        and hasattr(gs, "metal")
        and _torch_mps_available()
        and _quadrants_backend_supported("metal")
    ):
        return "metal"
    return None


def _default_genesis_backend_name(gs) -> str:
    gpu_backend = _available_genesis_gpu_backend_name(gs)
    if gpu_backend is not None:
        return gpu_backend
    return "cpu"


def _resolve_genesis_backend(gs) -> tuple[Any | None, str]:
    configured_backend = os.getenv(GENESIS_BACKEND_ENV, "").strip().lower()
    requested = configured_backend or _default_genesis_backend_name(gs)
    if requested == "auto":
        raise ValueError(
            f"{GENESIS_BACKEND_ENV}=auto is not deterministic; use gpu, cpu, cuda, amdgpu, or metal."
        )
    if requested == "gpu":
        gpu_backend = _available_genesis_gpu_backend_name(gs)
        if gpu_backend is None:
            raise ValueError(
                f"{GENESIS_BACKEND_ENV}=gpu requested, but no Genesis GPU backend is available."
            )
        requested = gpu_backend
    backend_names = {
        "cpu": "cpu",
        "cuda": "cuda",
        "amdgpu": "amdgpu",
        "amd": "amdgpu",
        "metal": "metal",
        "mps": "metal",
    }
    backend_name = backend_names.get(requested)
    if backend_name is None or not hasattr(gs, backend_name):
        raise ValueError(
            f"Unsupported {GENESIS_BACKEND_ENV}={requested!r}; use gpu, cpu, cuda, amdgpu, or metal."
        )
    if backend_name != "cpu" and not _quadrants_backend_supported(backend_name):
        raise ValueError(
            f"{GENESIS_BACKEND_ENV}={requested!r} requested, but Quadrants does not support "
            f"the {backend_name} backend on this machine."
        )
    return getattr(gs, backend_name), requested


def genesis_overview_viewer_pose(
    primitives: Sequence[SimPrimitive],
) -> tuple[
    tuple[float, float, float],
    tuple[float, float, float],
    tuple[float, float, float],
    float,
]:
    center, radius = scene_center_and_radius(primitives)
    camera_pos = (
        center[0] + radius * GENESIS_SCENE_PARAMS.viewer.camera_radius_scale_xyz[0],
        center[1] + radius * GENESIS_SCENE_PARAMS.viewer.camera_radius_scale_xyz[1],
        max(
            center[2] + radius * GENESIS_SCENE_PARAMS.viewer.camera_radius_scale_xyz[2],
            GENESIS_SCENE_PARAMS.viewer.min_camera_z_m,
        ),
    )
    return camera_pos, center, (0.0, 0.0, 1.0), GENESIS_SCENE_PARAMS.viewer.fov_deg


def should_step_genesis_workspace(
    *,
    no_viewer: bool,
    duration_sec: float,
    screenshot_path: Path | None,
    camera_screenshot_dir: Path | None,
    sensor_screenshot_dir: Path | None,
    report_path: Path | None,
) -> bool:
    return (
        no_viewer
        or duration_sec > 0
        or screenshot_path is not None
        or camera_screenshot_dir is not None
        or sensor_screenshot_dir is not None
        or report_path is not None
    )


def should_add_genesis_scene_cameras(*, camera_screenshot_dir: Path | None) -> bool:
    return camera_screenshot_dir is not None


def prepare_genesis_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    include_floor: bool,
    no_viewer: bool,
    screenshot_path: Path | None,
    screenshot_size: tuple[int, int],
    camera_screenshot_dir: Path | None,
    sensor_screenshot_dir: Path | None,
    show_camera_markers: bool,
    report_path: Path | None,
) -> None:
    import genesis as gs

    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    print(
        "[genesis-workspace] "
        f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
        f"objects={len(simulator_scene.layout.objects)} primitives={len(simulator_scene.primitives)} "
        f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map}",
        flush=True,
    )
    for warning in simulator_scene.warnings:
        print(f"[genesis-workspace] warning: {warning}", flush=True)
    cameras = simulator_scene.cameras

    genesis_backend, genesis_backend_label = _resolve_genesis_backend(gs)
    genesis_performance_mode = _genesis_performance_mode()
    gs.init(
        backend=genesis_backend,
        precision="32",
        logging_level="warning",
        performance_mode=genesis_performance_mode,
    )
    print(
        "[genesis-workspace] "
        f"genesis_backend_request={genesis_backend_label} "
        f"genesis_backend={getattr(gs, 'backend', None)} "
        f"performance_mode={genesis_performance_mode}",
        flush=True,
    )
    camera_pos, camera_lookat, camera_up, camera_fov = genesis_overview_viewer_pose(
        simulator_scene.primitives
    )
    scene = gs.Scene(
        show_viewer=not no_viewer,
        sim_options=gs.options.SimOptions(
            dt=GENESIS_SCENE_PARAMS.sim_dt_sec,
            gravity=GENESIS_SCENE_PARAMS.gravity_xyz,
        ),
        rigid_options=gs.options.RigidOptions(
            enable_collision=GENESIS_SCENE_PARAMS.enable_collision,
            enable_self_collision=GENESIS_SCENE_PARAMS.enable_self_collision,
            enable_adjacent_collision=GENESIS_SCENE_PARAMS.enable_adjacent_collision,
            box_box_detection=GENESIS_SCENE_PARAMS.box_box_detection,
        ),
        viewer_options=gs.options.ViewerOptions(
            camera_pos=camera_pos,
            camera_lookat=camera_lookat,
            camera_up=camera_up,
            camera_fov=camera_fov,
            max_FPS=int(GENESIS_SCENE_PARAMS.viewer.step_hz),
            run_in_thread=_viewer_run_in_thread(),
            enable_gui=True,
        ),
        profiling_options=gs.options.ProfilingOptions(show_FPS=False),
        vis_options=gs.options.VisOptions(
            show_cameras=GENESIS_SCENE_PARAMS.visual.show_camera_helpers,
            ambient_light=GENESIS_SCENE_PARAMS.visual.ambient_light_rgb,
            background_color=GENESIS_SCENE_PARAMS.visual.background_rgb,
        ),
    )
    if include_floor:
        add_floor_entity(gs, scene)
    asset_roots = simulator_scene.robot.asset_roots
    for primitive in simulator_scene.primitives:
        add_primitive_entity(gs, scene, primitive, asset_roots=asset_roots)
    if show_camera_markers:
        for camera_spec in cameras:
            add_camera_marker_entity(gs, scene, camera_spec)

    requested_robot_patch_ids = genesis_robot_compatibility_patch_ids_from_world_package(
        simulator_scene.world_package
    )
    robot_repair = materialize_genesis_robot_urdf_report(
        robot_urdf_path,
        requested_patch_ids=requested_robot_patch_ids,
    )
    if robot_repair.applied:
        print(
            "[genesis-workspace] "
            f"robot_repair={robot_repair.repair_id} repaired_urdf={robot_repair.path}",
            flush=True,
        )
    else:
        print(
            f"[genesis-workspace] robot_repair=none requested_patches={len(requested_robot_patch_ids)}",
            flush=True,
        )
    camera_attachment_links = links_to_keep_for_camera_attachment(cameras)
    attachment_links = links_to_keep_for_workspace_attachments(
        cameras,
        robot_urdf_path=robot_repair.path,
    )
    robot_entity = scene.add_entity(
        gs.morphs.URDF(
            **robot_urdf_morph_kwargs(
                robot_repair.path,
                links_to_keep=attachment_links,
            )
        ),
        name="robot",
    )

    camera = None
    if screenshot_path is not None:
        camera = scene.add_camera(
            res=screenshot_size,
            pos=camera_pos,
            lookat=camera_lookat,
            up=camera_up,
            fov=camera_fov,
            GUI=False,
        )
    should_add_scene_cameras = should_add_genesis_scene_cameras(
        camera_screenshot_dir=camera_screenshot_dir
    )
    scene_cameras = (
        [
            add_scene_camera(gs, scene, camera_spec, visible=False)
            for camera_spec in cameras
        ]
        if should_add_scene_cameras
        else []
    )
    attached_camera_count = sum(
        1
        for scene_camera, camera_spec in zip(scene_cameras, cameras)
        if attach_scene_camera_to_robot_link(scene_camera, robot_entity, camera_spec)
    )
    should_add_observation_sensors = no_viewer or sensor_screenshot_dir is not None
    observation_camera_sensors = []
    if should_add_observation_sensors:
        for camera_spec in cameras:
            sensor = add_observation_camera_sensor(gs, scene, robot_entity, camera_spec)
            if sensor is not None:
                observation_camera_sensors.append((camera_spec, sensor))

    scene.build()
    joint_dof_indices = joint_dof_indices_by_name(robot_entity)
    controlled_dof_count = configure_robot_position_controller(robot_entity, joint_dof_indices)
    applied_joints = apply_joint_values(
        robot_entity,
        joint_dof_indices,
        simulator_scene.robot.joint_positions,
    )
    print(GENESIS_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)
    print(
        "[genesis-workspace] "
        f"controller_policy={GENESIS_SCENE_PARAMS.controller_policy.name} "
        f"controlled_dofs={controlled_dof_count} "
        f"applied_initial_joints={applied_joints}",
        flush=True,
    )
    print(
        "[genesis-workspace] "
        f"cameras={len(cameras)} scene_cameras={len(scene_cameras)} "
        f"attached_cameras={attached_camera_count}",
        flush=True,
    )
    print(
        "[genesis-workspace] "
        f"camera_gui_windows=0 observation_cameras={len(observation_camera_sensors)} "
        f"observation_sensors={'enabled' if should_add_observation_sensors else 'viewer-skipped'}",
        flush=True,
    )
    print(
        "[genesis-workspace] "
        f"links_to_keep={len(attachment_links)} "
        f"merge_fixed_links={GENESIS_SCENE_PARAMS.merge_fixed_links}",
        flush=True,
    )
    if camera_attachment_links:
        print(
            "[genesis-workspace] "
            f"camera_attachment_links={len(camera_attachment_links)} "
            f"links_to_keep={len(attachment_links)}",
            flush=True,
        )
    should_step_workspace = should_step_genesis_workspace(
        no_viewer=no_viewer,
        duration_sec=duration_sec,
        screenshot_path=screenshot_path,
        camera_screenshot_dir=camera_screenshot_dir,
        sensor_screenshot_dir=sensor_screenshot_dir,
        report_path=report_path,
    )

    def step_runtime() -> None:
        scene.step()

    try:
        initial_step_done = False
        sensor_reads_reported = False
        sensor_read_count = 0
        sensor_images: tuple[tuple[SimCameraSpec, np.ndarray], ...] = ()

        def ensure_initial_step() -> None:
            nonlocal initial_step_done, sensor_reads_reported, sensor_images, sensor_read_count
            if not initial_step_done:
                if should_step_workspace:
                    step_runtime()
                initial_step_done = True
            if not sensor_reads_reported:
                sensor_read_count, sensor_images = read_observation_camera_sensor_images(
                    observation_camera_sensors
                ) if observation_camera_sensors else (0, ())
                print(f"[genesis-workspace] sensor_reads={sensor_read_count}", flush=True)
                sensor_reads_reported = True

        if screenshot_path is not None or camera_screenshot_dir is not None or sensor_screenshot_dir is not None:
            ensure_initial_step()
            if screenshot_path is not None and camera is not None:
                from PIL import Image

                image = camera.render(rgb=True)[0]
                screenshot_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(image).save(screenshot_path)
                print(f"[genesis-workspace] screenshot written: {screenshot_path}", flush=True)
            if camera_screenshot_dir is not None:
                camera_screenshot_count = write_camera_screenshots(
                    scene_cameras,
                    cameras,
                    camera_screenshot_dir,
                )
                print(
                    f"[genesis-workspace] camera_screenshots={camera_screenshot_count}",
                    flush=True,
                )
            if sensor_screenshot_dir is not None:
                sensor_screenshot_count = write_sensor_screenshots(
                    sensor_images,
                    sensor_screenshot_dir,
                )
                print(
                    f"[genesis-workspace] sensor_screenshots={sensor_screenshot_count}",
                    flush=True,
                )

        if report_path is not None:
            write_simulator_validation_report(
                simulator_scene,
                report_path,
                simulator_id=SIMULATOR_GENESIS_ID,
                simulator_label="Genesis",
                runtime={
                    "backend_request": genesis_backend_label,
                    "backend": str(getattr(gs, "backend", None)),
                    "performance_mode": genesis_performance_mode,
                    "robot_repair": {
                        "applied": robot_repair.applied,
                        "repair_id": robot_repair.repair_id,
                        "urdf_path": robot_repair.path,
                        "requested_patch_ids": requested_robot_patch_ids,
                    },
                    "controlled_dofs": controlled_dof_count,
                    "applied_initial_joints": applied_joints,
                    "configured_cameras": len(cameras),
                    "scene_cameras": len(scene_cameras),
                    "attached_cameras": attached_camera_count,
                    "camera_gui_windows": 0,
                    "static_view": not should_step_workspace,
                    "observation_cameras": len(observation_camera_sensors),
                    "sensor_reads": sensor_read_count,
                    "camera_attachment_links": len(camera_attachment_links),
                    "links_to_keep": len(attachment_links),
                    "merge_fixed_links": GENESIS_SCENE_PARAMS.merge_fixed_links,
                },
                artifacts={
                    "viewer_screenshot": screenshot_path,
                    "camera_screenshot_dir": camera_screenshot_dir,
                    "sensor_screenshot_dir": sensor_screenshot_dir,
                },
            )
            print(f"[genesis-workspace] report written: {report_path}", flush=True)

        if no_viewer:
            ensure_initial_step()
            headless_steps = GENESIS_SCENE_PARAMS.viewer.headless_min_steps
            if duration_sec > 0 and math.isfinite(duration_sec):
                headless_steps = max(
                    headless_steps,
                    int(math.ceil(duration_sec / GENESIS_SCENE_PARAMS.sim_dt_sec)),
                )
            for _ in range(headless_steps):
                step_runtime()
            return

        ensure_initial_step()
        if duration_sec <= 0:
            print(
                "[genesis-workspace] Genesis static viewer opened. Press Ctrl-C to return.",
                flush=True,
            )
            while True:
                time.sleep(1.0 / GENESIS_SCENE_PARAMS.viewer.step_hz)

        deadline = time.monotonic() + duration_sec
        while time.monotonic() < deadline:
            if should_step_workspace:
                step_runtime()
            time.sleep(1.0 / GENESIS_SCENE_PARAMS.viewer.step_hz)
    except KeyboardInterrupt:
        return


def main() -> int:
    args = _parse_args()
    prepare_genesis_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        include_floor=not args.no_floor,
        no_viewer=args.no_viewer,
        screenshot_path=Path(args.screenshot) if args.screenshot else None,
        screenshot_size=(args.screenshot_width, args.screenshot_height),
        camera_screenshot_dir=Path(args.camera_screenshot_dir) if args.camera_screenshot_dir else None,
        sensor_screenshot_dir=Path(args.sensor_screenshot_dir) if args.sensor_screenshot_dir else None,
        show_camera_markers=args.show_camera_markers,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
