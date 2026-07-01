from __future__ import annotations

import argparse
import subprocess
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import SIMULATOR_COPPELIASIM_ID
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.coppeliasim_runtime import (
    coppeliasim_host,
    coppeliasim_port,
    coppeliasim_remote_configured,
    resolve_coppeliasim_executable,
)
from backend.services.simulator_adapters.params import COPPELIASIM_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.world_mesh_assets import resolve_declared_mesh_asset_path
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in CoppeliaSim.")
    parser.add_argument("--robot-urdf", required=True)
    add_common_workspace_args(parser)
    return parser.parse_args()


def _start_coppeliasim() -> subprocess.Popen | None:
    if coppeliasim_remote_configured():
        return None
    executable = resolve_coppeliasim_executable()
    if executable is None:
        raise RuntimeError(
            "CoppeliaSim executable is not configured. Set URDF_STUDIO_COPPELIASIM_PATH, "
            "COPPELIASIM_ROOT, or URDF_STUDIO_COPPELIASIM_REMOTE=1 for an already-running remote API."
        )
    return subprocess.Popen(
        [str(executable), "-h"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )


def _remote_client() -> tuple[Any, Any]:
    from coppeliasim_zmqremoteapi_client import RemoteAPIClient

    host = coppeliasim_host()
    port = coppeliasim_port()
    last_error: Exception | None = None
    for _attempt in range(60):
        try:
            client = RemoteAPIClient(host=host, port=port)
            sim = client.require("sim")
            sim.getSimulationState()
            return client, sim
        except Exception as exc:
            last_error = exc
            time.sleep(1.0)
    raise RuntimeError(f"CoppeliaSim ZMQ remote API did not become available at {host}:{port}") from last_error


def _quat_wxyz_to_xyzw(quat_wxyz: tuple[float, float, float, float]) -> list[float]:
    return [quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]]


def _set_object_pose(sim: Any, handle: int, primitive: SimPrimitive) -> None:
    sim.setObjectPosition(handle, list(primitive.position_xyz), sim.handle_world)
    sim.setObjectQuaternion(handle, _quat_wxyz_to_xyzw(primitive.quat_wxyz), sim.handle_world)


def _set_object_alias(sim: Any, handle: int, name: str) -> None:
    try:
        sim.setObjectAlias(handle, name)
    except Exception:
        pass


def _set_shape_color(sim: Any, handle: int, rgba: tuple[float, float, float, float]) -> None:
    try:
        sim.setShapeColor(handle, None, sim.colorcomponent_ambient_diffuse, list(rgba[:3]))
    except Exception:
        pass


def _add_primitive(
    sim: Any,
    primitive: SimPrimitive,
    *,
    asset_roots: Sequence[Path] = (),
) -> int:
    asset_path = resolve_declared_mesh_asset_path(
        primitive,
        asset_roots,
        simulator_label="CoppeliaSim",
    )
    if asset_path is not None:
        scale = primitive.asset_scale_xyz[0] if primitive.asset_scale_xyz else 1.0
        handle = sim.importShape(0, str(asset_path), 0, 0.0, float(scale))
    else:
        primitive_types = {
            "box": sim.primitiveshape_cuboid,
            "sphere": sim.primitiveshape_spheroid,
            "cylinder": sim.primitiveshape_cylinder,
        }
        primitive_type = primitive_types.get(primitive.sim_type)
        if primitive_type is None:
            raise ValueError(f"Unsupported CoppeliaSim primitive type: {primitive.sim_type}")
        handle = sim.createPrimitiveShape(primitive_type, list(primitive.size_xyz), 0)
    _set_object_alias(sim, handle, primitive.sim_name)
    _set_object_pose(sim, handle, primitive)
    _set_shape_color(sim, handle, primitive.rgba)
    return int(handle)


def _import_robot_urdf(client: Any, robot_urdf_path: Path) -> Any:
    try:
        sim_urdf = client.getObject("simURDF")
        return getattr(sim_urdf, "import")(str(robot_urdf_path.resolve()), -1, "")
    except AttributeError:
        return client.call("simURDF.import", (str(robot_urdf_path.resolve()), -1, ""))


def _step_simulation(sim: Any, steps: int) -> None:
    sim.setStepping(True)
    sim.startSimulation()
    for _index in range(steps):
        sim.step()


def _stop_simulation(sim: Any) -> None:
    try:
        sim.stopSimulation()
    except Exception:
        pass


def prepare_coppeliasim_workspace_scene(
    *,
    world_package_path: Path,
    robot_urdf_path: Path,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
    report_path: Path | None,
) -> None:
    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    coppeliasim_process = _start_coppeliasim()
    client, sim = _remote_client()
    try:
        for warning in simulator_scene.warnings:
            print(f"[coppeliasim-workspace] warning: {warning}", flush=True)
        try:
            sim.closeScene()
        except Exception:
            pass
        robot_result = _import_robot_urdf(client, robot_urdf_path)
        object_handles = [
            _add_primitive(sim, primitive, asset_roots=simulator_scene.robot.asset_roots)
            for primitive in simulator_scene.primitives
        ]
        _step_simulation(sim, 1)
        print(
            "[coppeliasim-workspace] "
            f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
            f"robot_loaded=1 world_objects={len(object_handles)} cameras={len(simulator_scene.cameras)} "
            f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map}",
            flush=True,
        )
        if report_path is not None:
            write_simulator_validation_report(
                simulator_scene,
                report_path,
                simulator_id=SIMULATOR_COPPELIASIM_ID,
                simulator_label="CoppeliaSim",
                runtime={
                    "robot_loaded": True,
                    "robot_import_result": robot_result,
                    "world_objects": len(object_handles),
                    "cameras": len(simulator_scene.cameras),
                    "remote_api": "zmq",
                    "host": coppeliasim_host(),
                    "port": coppeliasim_port(),
                },
            )
            print(f"[coppeliasim-workspace] report written: {report_path}", flush=True)
        print(COPPELIASIM_WORKSPACE_PROCESS_PARAMS.ready_log_marker, flush=True)

        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while True:
            sim.step()
            if deadline is not None and time.monotonic() >= deadline:
                break
            if no_viewer:
                break
            time.sleep(1.0 / 60.0)
    finally:
        if no_viewer:
            _stop_simulation(sim)
            if coppeliasim_process is not None:
                coppeliasim_process.terminate()


def main() -> int:
    args = _parse_args()
    prepare_coppeliasim_workspace_scene(
        world_package_path=Path(args.world_package),
        robot_urdf_path=Path(args.robot_urdf),
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
