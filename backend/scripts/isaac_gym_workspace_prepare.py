from __future__ import annotations

import argparse
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import SIMULATOR_ISAAC_GYM_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.params import ISAAC_GYM_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in Isaac Gym.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    parser.add_argument("--free-base", action="store_true")
    return parser.parse_args()


def _gym_transform(gymapi: Any, primitive: SimPrimitive) -> Any:
    transform = gymapi.Transform()
    transform.p = gymapi.Vec3(*primitive.position_xyz)
    transform.r = gymapi.Quat(
        primitive.quat_wxyz[1],
        primitive.quat_wxyz[2],
        primitive.quat_wxyz[3],
        primitive.quat_wxyz[0],
    )
    return transform


def _create_primitive_asset(gym: Any, gymapi: Any, sim: Any, primitive: SimPrimitive) -> Any:
    options = gymapi.AssetOptions()
    options.fix_base_link = primitive.fixed
    if primitive.sim_type == "sphere":
        return gym.create_sphere(sim, max(primitive.size_xyz) * 0.5, options)
    if primitive.sim_type == "cylinder" and hasattr(gym, "create_capsule"):
        return gym.create_capsule(
            sim,
            primitive.size_xyz[0] * 0.5,
            primitive.size_xyz[2],
            options,
        )
    return gym.create_box(sim, *primitive.size_xyz, options)


def _add_primitives(
    gym: Any,
    gymapi: Any,
    sim: Any,
    env: Any,
    primitives: Sequence[SimPrimitive],
) -> list[int]:
    handles: list[int] = []
    for primitive in primitives:
        asset = _create_primitive_asset(gym, gymapi, sim, primitive)
        handle = gym.create_actor(
            env,
            asset,
            _gym_transform(gymapi, primitive),
            primitive.sim_name,
            0,
            0,
        )
        handles.append(int(handle))
    return handles


def prepare_isaac_gym_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
    free_base: bool,
    report_path: Path | None,
) -> None:
    from isaacgym import gymapi

    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    gym = gymapi.acquire_gym()
    sim_params = gymapi.SimParams()
    sim = gym.create_sim(0, 0, gymapi.SIM_PHYSX, sim_params)
    if sim is None:
        raise RuntimeError("Isaac Gym could not create a simulation.")
    viewer = None
    try:
        if not no_viewer:
            viewer = gym.create_viewer(sim, gymapi.CameraProperties())
        asset_options = gymapi.AssetOptions()
        asset_options.fix_base_link = not free_base
        robot_asset = gym.load_asset(
            sim,
            str(robot_urdf_path.parent.resolve()),
            robot_urdf_path.name,
            asset_options,
        )
        env = gym.create_env(
            sim,
            gymapi.Vec3(-2.0, -2.0, 0.0),
            gymapi.Vec3(2.0, 2.0, 2.0),
            1,
        )
        robot_pose = gymapi.Transform()
        robot_handle = gym.create_actor(env, robot_asset, robot_pose, "robot", 0, 0)
        object_handles = _add_primitives(
            gym,
            gymapi,
            sim,
            env,
            simulator_scene.primitives,
        )
        gym.prepare_sim(sim)
        gym.simulate(sim)
        gym.fetch_results(sim, True)
        print(
            "[isaac-gym-workspace] "
            f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
            f"robot_loaded=1 world_objects={len(object_handles)} cameras={len(simulator_scene.cameras)} "
            f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map}",
            flush=True,
        )
        if report_path is not None:
            write_simulator_validation_report(
                simulator_scene,
                report_path,
                simulator_id=SIMULATOR_ISAAC_GYM_ID,
                simulator_label="Isaac Gym",
                runtime={
                    "robot_loaded": True,
                    "robot_handle": int(robot_handle),
                    "world_objects": len(object_handles),
                    "cameras": len(simulator_scene.cameras),
                    "free_base": free_base,
                    "headless": no_viewer,
                },
            )
            print(f"[isaac-gym-workspace] report written: {report_path}", flush=True)
        print(ISAAC_GYM_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while True:
            gym.simulate(sim)
            gym.fetch_results(sim, True)
            if viewer is not None:
                gym.step_graphics(sim)
                gym.draw_viewer(viewer, sim, True)
            if deadline is not None and time.monotonic() >= deadline:
                break
            if no_viewer:
                break
            time.sleep(1.0 / 60.0)
    finally:
        if viewer is not None:
            gym.destroy_viewer(viewer)
        gym.destroy_sim(sim)


def main() -> int:
    args = _parse_args()
    prepare_isaac_gym_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
        free_base=args.free_base,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
