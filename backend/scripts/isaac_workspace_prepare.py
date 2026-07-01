from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

from backend.models.simulator_runtime import (
    SIMULATOR_ISAAC_LAB_ID,
    SIMULATOR_ISAAC_SIM_ID,
    SimulatorId,
)
from backend.scripts.simulator_workspace_cli import add_common_workspace_args
from backend.services.simulator_adapters.params import (
    ISAAC_LAB_WORKSPACE_PROCESS_PARAMS,
    ISAAC_SIM_WORKSPACE_PROCESS_PARAMS,
)
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_layout_transfer_types import SimPrimitive, WorldLayoutFrameMap


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a URDF Studio workspace in Isaac Sim.")
    parser.add_argument("--stage-usd", required=True)
    parser.add_argument("--robot-urdf", required=True)
    parser.add_argument(
        "--simulator-id",
        choices=(SIMULATOR_ISAAC_SIM_ID, SIMULATOR_ISAAC_LAB_ID),
        default=SIMULATOR_ISAAC_SIM_ID,
    )
    add_common_workspace_args(parser)
    return parser.parse_args()


def _ready_marker(simulator_id: SimulatorId) -> str:
    if simulator_id == SIMULATOR_ISAAC_LAB_ID:
        return ISAAC_LAB_WORKSPACE_PROCESS_PARAMS.ready_log_marker
    return ISAAC_SIM_WORKSPACE_PROCESS_PARAMS.ready_log_marker


def _simulator_label(simulator_id: SimulatorId) -> str:
    if simulator_id == SIMULATOR_ISAAC_LAB_ID:
        return "Isaac Lab"
    return "Isaac Sim"


def _launch_simulation_app(*, headless: bool) -> Any:
    try:
        from isaacsim import SimulationApp
    except Exception:
        from omni.isaac.kit import SimulationApp

    return SimulationApp({"headless": headless})


def _enable_urdf_importer() -> None:
    try:
        from omni.isaac.core.utils.extensions import enable_extension
    except Exception:
        from isaacsim.core.utils.extensions import enable_extension

    for extension_name in ("isaacsim.asset.importer.urdf", "omni.importer.urdf"):
        try:
            enable_extension(extension_name)
            return
        except Exception:
            continue


def _create_urdf_import_config() -> Any:
    import omni.kit.commands

    _enable_urdf_importer()
    try:
        from isaacsim.asset.importer.urdf import _urdf
    except Exception:
        from omni.importer.urdf import _urdf

    _status, import_config = omni.kit.commands.execute("URDFCreateImportConfig")
    for attr_name, value in (
        ("merge_fixed_joints", False),
        ("import_inertia_tensor", True),
        ("fix_base", True),
        ("distance_scale", 1.0),
        ("default_drive_type", getattr(_urdf.UrdfJointTargetType, "JOINT_DRIVE_NONE", 0)),
    ):
        if hasattr(import_config, attr_name):
            setattr(import_config, attr_name, value)
    return import_config


def _import_robot_urdf(robot_urdf_path: Path, stage_usd_path: Path) -> str:
    import omni.kit.commands

    import_config = _create_urdf_import_config()
    _status, prim_path = omni.kit.commands.execute(
        "URDFParseAndImportFile",
        urdf_path=str(robot_urdf_path.resolve()),
        import_config=import_config,
        dest_path=str(stage_usd_path.resolve()),
        get_articulation_root=True,
    )
    return str(prim_path)


def _open_or_create_stage(stage_usd_path: Path) -> Any:
    from pxr import Usd, UsdGeom

    stage = Usd.Stage.Open(str(stage_usd_path))
    if stage is None:
        stage = Usd.Stage.CreateNew(str(stage_usd_path))
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        UsdGeom.Xform.Define(stage, "/World")
        stage.SetDefaultPrim(stage.GetPrimAtPath("/World"))
    return stage


def _set_xform(prim: Any, position_xyz: tuple[float, float, float]) -> None:
    from pxr import Gf, UsdGeom

    xform = UsdGeom.Xformable(prim)
    xform.AddTranslateOp().Set(Gf.Vec3d(*position_xyz))


def _add_usd_primitive(stage: Any, primitive: SimPrimitive) -> str:
    from pxr import UsdGeom

    prim_path = f"/World/{primitive.sim_name}"
    if primitive.sim_type == "sphere":
        geom = UsdGeom.Sphere.Define(stage, prim_path)
        geom.CreateRadiusAttr(max(primitive.size_xyz) * 0.5)
    elif primitive.sim_type == "cylinder":
        geom = UsdGeom.Cylinder.Define(stage, prim_path)
        geom.CreateRadiusAttr(primitive.size_xyz[0] * 0.5)
        geom.CreateHeightAttr(primitive.size_xyz[2])
    else:
        geom = UsdGeom.Cube.Define(stage, prim_path)
        geom.CreateSizeAttr(1.0)
        UsdGeom.Xformable(geom.GetPrim()).AddScaleOp().Set(primitive.size_xyz)
    _set_xform(geom.GetPrim(), primitive.position_xyz)
    return prim_path


def _add_usd_cameras(stage: Any, cameras: tuple[Any, ...]) -> tuple[str, ...]:
    from pxr import UsdGeom

    prim_paths: list[str] = []
    for camera in cameras:
        prim_path = f"/World/{camera.sim_name}"
        geom = UsdGeom.Camera.Define(stage, prim_path)
        _set_xform(geom.GetPrim(), camera.position_xyz)
        prim_paths.append(prim_path)
    return tuple(prim_paths)


def _materialize_workspace_usd(
    *,
    robot_urdf_path: Path,
    stage_usd_path: Path,
    primitives: tuple[SimPrimitive, ...],
    cameras: tuple[Any, ...],
) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
    robot_prim_path = _import_robot_urdf(robot_urdf_path, stage_usd_path)
    stage = _open_or_create_stage(stage_usd_path)
    object_paths = tuple(_add_usd_primitive(stage, primitive) for primitive in primitives)
    camera_paths = _add_usd_cameras(stage, cameras)
    stage.Save()
    return robot_prim_path, object_paths, camera_paths


def prepare_isaac_workspace_scene(
    *,
    world_package_path: Path,
    stage_usd_path: Path,
    robot_urdf_path: Path,
    simulator_id: SimulatorId,
    frame_map: WorldLayoutFrameMap,
    duration_sec: float,
    include_hidden: bool,
    no_viewer: bool,
    report_path: Path | None,
) -> None:
    if simulator_id == SIMULATOR_ISAAC_LAB_ID:
        import isaaclab  # noqa: F401

    simulator_scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=frame_map,
        include_hidden=include_hidden,
    )
    simulation_app = _launch_simulation_app(headless=no_viewer)
    try:
        for warning in simulator_scene.warnings:
            print(f"[isaac-workspace] warning: {warning}", flush=True)
        robot_prim_path, object_paths, camera_paths = _materialize_workspace_usd(
            robot_urdf_path=robot_urdf_path,
            stage_usd_path=stage_usd_path,
            primitives=simulator_scene.primitives,
            cameras=simulator_scene.cameras,
        )
        simulation_app.update()
        print(
            "[isaac-workspace] "
            f"package={simulator_scene.world_package.package_id}@{simulator_scene.world_package.version} "
            f"robot_loaded=1 world_objects={len(object_paths)} cameras={len(camera_paths)} "
            f"frame_map={simulator_scene.frame_map} requested_frame_map={simulator_scene.requested_frame_map} "
            f"stage_usd={stage_usd_path}",
            flush=True,
        )
        if report_path is not None:
            write_simulator_validation_report(
                simulator_scene,
                report_path,
                simulator_id=simulator_id,
                simulator_label=_simulator_label(simulator_id),
                runtime={
                    "stage_usd_path": stage_usd_path,
                    "robot_prim_path": robot_prim_path,
                    "world_objects": len(object_paths),
                    "cameras": len(camera_paths),
                    "object_paths": object_paths,
                    "camera_paths": camera_paths,
                    "headless": no_viewer,
                },
                artifacts={
                    "stage_usd_path": stage_usd_path,
                },
            )
            print(f"[isaac-workspace] report written: {report_path}", flush=True)
        print(_ready_marker(simulator_id), flush=True)

        deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
        while True:
            simulation_app.update()
            if deadline is not None and time.monotonic() >= deadline:
                break
            if no_viewer:
                break
            time.sleep(1.0 / 60.0)
    finally:
        if no_viewer:
            simulation_app.close()


def main() -> int:
    args = _parse_args()
    prepare_isaac_workspace_scene(
        world_package_path=Path(args.world_package),
        stage_usd_path=Path(args.stage_usd),
        robot_urdf_path=Path(args.robot_urdf),
        simulator_id=args.simulator_id,
        frame_map=args.frame_map,
        duration_sec=args.duration_sec,
        include_hidden=args.include_hidden,
        no_viewer=args.no_viewer,
        report_path=Path(args.report) if args.report else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
