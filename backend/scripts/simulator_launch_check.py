from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
    SimulatorId,
    SimulatorMeshAssetUpload,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
)
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldRuntimeTarget,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.simulator_adapters import get_simulator_runtime_status
from backend.services.simulator_adapters.genesis import prepare_genesis_launch
from backend.services.simulator_adapters.launch_package import PreparedSimulatorLaunch
from backend.services.simulator_adapters.mujoco import PreparedMujocoLaunch, prepare_mujoco_launch
from backend.services.simulator_adapters.params import (
    GENESIS_LAUNCH_PARAMS,
    MUJOCO_LAUNCH_PARAMS,
    PYBULLET_LAUNCH_PARAMS,
    SimulatorLaunchParams,
)
from backend.services.simulator_adapters.pybullet import prepare_pybullet_launch


WORLD_LAUNCH_SIMULATORS: tuple[SimulatorId, ...] = (
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_PYBULLET_ID,
)
DEMO_ROOT = BASE_DIR / "web" / "public" / "demo"
SO101_MANIFEST_PATH = DEMO_ROOT / "so101" / "manifest.json"
SO101_CAMERA_CONFIG_PATH = DEMO_ROOT / "so101" / "camera-config.json"
STATIC_WORLD_LAYOUT_PATH = (
    BASE_DIR / "web" / "public" / "world-layouts" / "static-transfer-smoke.world-layout.json"
)
REQUIRE_SIMULATOR_LAUNCH_ENV = "URDF_STUDIO_REQUIRE_SIMULATOR_LAUNCH"
DEFAULT_DURATION_SEC = 0.02
DEFAULT_TIMEOUT_SEC = 180.0


@dataclass(frozen=True)
class PreparedLaunchCommand:
    command: list[str]
    ready_marker: str
    expected_object_marker: str
    expected_camera_marker: str


@dataclass(frozen=True)
class LaunchExpectations:
    object_count: int
    camera_count: int
    duration_sec: float


@dataclass(frozen=True)
class LaunchTarget:
    simulator_id: SimulatorId
    label: str
    prepare: Callable[[SimulatorWorldOpenRequest, LaunchExpectations], PreparedLaunchCommand]


@dataclass(frozen=True)
class LaunchCheckResult:
    simulator_id: SimulatorId
    label: str
    status: str
    detail: str = ""


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Headlessly launch the SO101 demo world in installed simulator runtimes."
    )
    parser.add_argument(
        "--simulator",
        action="append",
        choices=WORLD_LAUNCH_SIMULATORS,
        help="Simulator to check. May be passed more than once. Defaults to every openable simulator.",
    )
    parser.add_argument(
        "--require-all",
        action="store_true",
        help=f"Fail when a simulator runtime is missing. Also enabled by {REQUIRE_SIMULATOR_LAUNCH_ENV}=1.",
    )
    parser.add_argument("--duration-sec", type=float, default=DEFAULT_DURATION_SEC)
    parser.add_argument("--timeout-sec", type=float, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--json", action="store_true", help="Print machine-readable results.")
    return parser.parse_args()


def _is_truthy_env(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"1", "true", "yes", "on"}


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def _load_demo_mesh_assets() -> list[SimulatorMeshAssetUpload]:
    manifest = _load_json(SO101_MANIFEST_PATH)
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError(f"Invalid SO101 manifest: {SO101_MANIFEST_PATH}")

    uploads: list[SimulatorMeshAssetUpload] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        relative_path = entry.get("path")
        if not isinstance(relative_path, str) or relative_path == "robot.urdf":
            continue
        url = entry.get("url")
        source_path = (
            (SO101_MANIFEST_PATH.parent / url).resolve()
            if isinstance(url, str) and url
            else (DEMO_ROOT / relative_path).resolve()
        )
        uploads.append(
            SimulatorMeshAssetUpload(
                path=relative_path,
                aliases=[],
                content_base64=base64.b64encode(source_path.read_bytes()).decode("ascii"),
                mime=entry.get("mime") if isinstance(entry.get("mime"), str) else None,
            )
        )
    return uploads


def _load_demo_cameras() -> list[dict]:
    payload = _load_json(SO101_CAMERA_CONFIG_PATH)
    cameras = payload.get("cameras")
    if not isinstance(cameras, list):
        raise ValueError(f"Invalid SO101 camera config: {SO101_CAMERA_CONFIG_PATH}")
    return [camera for camera in cameras if isinstance(camera, dict)]


def _load_demo_objects() -> list[dict]:
    payload = _load_json(STATIC_WORLD_LAYOUT_PATH)
    world_layout = payload.get("world_layout")
    if not isinstance(world_layout, dict):
        raise ValueError(f"Invalid static world layout: {STATIC_WORLD_LAYOUT_PATH}")
    objects = world_layout.get("objects")
    if not isinstance(objects, list):
        raise ValueError(f"Invalid object list in static world layout: {STATIC_WORLD_LAYOUT_PATH}")
    return [item for item in objects if isinstance(item, dict)]


def build_demo_world_open_request() -> SimulatorWorldOpenRequest:
    urdf_xml = (DEMO_ROOT / "robot.urdf").read_text(encoding="utf-8")
    cameras = _load_demo_cameras()
    objects = _load_demo_objects()
    world_package = WorldScenePackageManifest(
        package_id="so101-simulator-launch-check",
        version="1.0.0",
        title="SO101 Simulator Launch Check",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        runtime_targets=[
            WorldRuntimeTarget(name=simulator_id, mode="python")
            for simulator_id in WORLD_LAUNCH_SIMULATORS
        ],
        interface=WorldInterfaceSpec(
            observation_modalities=["state", "rgb"],
            action_semantics="joint_position",
            timestep_ms=10,
            frame_convention="ros-rep-103",
        ),
        world_snapshot=WorldSnapshot(
            urdf_xml=urdf_xml,
            joint_positions={},
            cameras=cameras,
            objects=objects,
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
        provenance={
            "robot": str((DEMO_ROOT / "robot.urdf").relative_to(BASE_DIR)),
            "cameras": str(SO101_CAMERA_CONFIG_PATH.relative_to(BASE_DIR)),
            "world_layout": str(STATIC_WORLD_LAYOUT_PATH.relative_to(BASE_DIR)),
        },
    )
    return SimulatorWorldOpenRequest(
        world_package=world_package,
        urdf_asset_path="robot.urdf",
        mesh_assets=_load_demo_mesh_assets(),
    )


def _module_command(
    launch_params: SimulatorLaunchParams,
    *,
    world_package_path: Path,
    robot_asset_flag: str,
    robot_asset_path: Path,
    duration_sec: float,
    extra_args: Sequence[str] = (),
) -> list[str]:
    return [
        sys.executable,
        "-u",
        "-m",
        launch_params.module_name,
        "--world-package",
        str(world_package_path),
        robot_asset_flag,
        str(robot_asset_path),
        *extra_args,
        "--frame-map",
        "auto",
        "--no-viewer",
        "--duration-sec",
        str(duration_sec),
    ]


def _prepare_direct_urdf_command(
    prepared: PreparedSimulatorLaunch,
    *,
    launch_params: SimulatorLaunchParams,
    object_marker: str,
    expectations: LaunchExpectations,
) -> PreparedLaunchCommand:
    return PreparedLaunchCommand(
        command=_module_command(
            launch_params,
            world_package_path=prepared.world_package_path,
            robot_asset_flag="--robot-urdf",
            robot_asset_path=prepared.robot_urdf_path,
            duration_sec=expectations.duration_sec,
        ),
        ready_marker=launch_params.ready_log_marker,
        expected_object_marker=object_marker,
        expected_camera_marker=f"cameras={expectations.camera_count}",
    )


def _prepare_genesis_command(
    request: SimulatorWorldOpenRequest,
    expectations: LaunchExpectations,
) -> PreparedLaunchCommand:
    prepared = prepare_genesis_launch(request)
    return _prepare_direct_urdf_command(
        prepared,
        launch_params=GENESIS_LAUNCH_PARAMS,
        object_marker=f"primitives={expectations.object_count}",
        expectations=expectations,
    )


def _prepare_pybullet_command(
    request: SimulatorWorldOpenRequest,
    expectations: LaunchExpectations,
) -> PreparedLaunchCommand:
    prepared = prepare_pybullet_launch(request)
    return _prepare_direct_urdf_command(
        prepared,
        launch_params=PYBULLET_LAUNCH_PARAMS,
        object_marker=f"world_objects={expectations.object_count}",
        expectations=expectations,
    )


def _prepare_mujoco_command(
    request: SimulatorWorldOpenRequest,
    expectations: LaunchExpectations,
    *,
    simulator_id: SimulatorId,
) -> PreparedLaunchCommand:
    prepared: PreparedMujocoLaunch = prepare_mujoco_launch(
        request,
        simulator_id=simulator_id,
    )
    return PreparedLaunchCommand(
        command=_module_command(
            MUJOCO_LAUNCH_PARAMS,
            world_package_path=prepared.shared_launch.world_package_path,
            robot_asset_flag="--robot-mjcf",
            robot_asset_path=prepared.mjcf_path,
            duration_sec=expectations.duration_sec,
            extra_args=("--robot-urdf", str(prepared.shared_launch.robot_urdf_path)),
        ),
        ready_marker=MUJOCO_LAUNCH_PARAMS.ready_log_marker,
        expected_object_marker=f"world_objects={expectations.object_count}",
        expected_camera_marker=f"cameras={expectations.camera_count}",
    )


LAUNCH_TARGETS: dict[SimulatorId, LaunchTarget] = {
    SIMULATOR_GENESIS_ID: LaunchTarget(
        simulator_id=SIMULATOR_GENESIS_ID,
        label="Genesis",
        prepare=_prepare_genesis_command,
    ),
    SIMULATOR_MJLAB_ID: LaunchTarget(
        simulator_id=SIMULATOR_MJLAB_ID,
        label="MJLab",
        prepare=lambda request, expectations: _prepare_mujoco_command(
            request,
            expectations,
            simulator_id=SIMULATOR_MJLAB_ID,
        ),
    ),
    SIMULATOR_MUJOCO_ID: LaunchTarget(
        simulator_id=SIMULATOR_MUJOCO_ID,
        label="MuJoCo",
        prepare=lambda request, expectations: _prepare_mujoco_command(
            request,
            expectations,
            simulator_id=SIMULATOR_MUJOCO_ID,
        ),
    ),
    SIMULATOR_PYBULLET_ID: LaunchTarget(
        simulator_id=SIMULATOR_PYBULLET_ID,
        label="PyBullet",
        prepare=_prepare_pybullet_command,
    ),
}


def _format_missing_runtime(status: SimulatorRuntimeStatus) -> str:
    missing = [
        dependency.name
        for dependency in status.dependencies
        if not dependency.available
    ]
    if missing:
        return f"missing runtime dependency: {', '.join(missing)}"
    return status.status


def _run_launch_command(
    command: PreparedLaunchCommand,
    *,
    timeout_sec: float,
) -> tuple[bool, str]:
    process = subprocess.run(
        command.command,
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )
    output = "\n".join(part for part in (process.stdout, process.stderr) if part)
    if process.returncode != 0:
        return False, output.strip() or f"process exited with code {process.returncode}"
    required_markers = (
        command.ready_marker,
        command.expected_object_marker,
        command.expected_camera_marker,
    )
    missing_markers = [marker for marker in required_markers if marker not in output]
    if missing_markers:
        return False, f"missing launch marker(s): {', '.join(missing_markers)}\n{output.strip()}"
    return True, output.strip()


def _check_target(
    target: LaunchTarget,
    *,
    request: SimulatorWorldOpenRequest,
    expectations: LaunchExpectations,
    timeout_sec: float,
    require_runtime: bool,
) -> LaunchCheckResult:
    status = get_simulator_runtime_status(target.simulator_id)
    if not status.available:
        detail = _format_missing_runtime(status)
        if require_runtime:
            return LaunchCheckResult(target.simulator_id, target.label, "failed", detail)
        return LaunchCheckResult(target.simulator_id, target.label, "skipped", detail)

    try:
        command = target.prepare(request, expectations)
        ok, detail = _run_launch_command(command, timeout_sec=timeout_sec)
    except Exception as exc:
        return LaunchCheckResult(
            target.simulator_id,
            target.label,
            "failed",
            f"{type(exc).__name__}: {exc}",
        )
    return LaunchCheckResult(
        target.simulator_id,
        target.label,
        "passed" if ok else "failed",
        detail,
    )


def _selected_targets(simulator_ids: Sequence[SimulatorId] | None) -> tuple[LaunchTarget, ...]:
    selected_ids = tuple(simulator_ids or WORLD_LAUNCH_SIMULATORS)
    return tuple(LAUNCH_TARGETS[simulator_id] for simulator_id in selected_ids)


def _active_object_count(request: SimulatorWorldOpenRequest) -> int:
    return sum(
        1
        for item in request.world_package.world_snapshot.objects
        if not (isinstance(item, dict) and item.get("is_hidden") is True)
    )


def _print_human_results(results: Sequence[LaunchCheckResult]) -> None:
    for result in results:
        if result.status == "passed":
            print(f"[simulator-launch-check] {result.label}: passed", flush=True)
        elif result.status == "skipped":
            print(f"[simulator-launch-check] {result.label}: skipped ({result.detail})", flush=True)
        else:
            print(f"[simulator-launch-check] {result.label}: failed", flush=True)
            if result.detail:
                print(result.detail, flush=True)


def main() -> int:
    args = _parse_args()
    selected_ids = tuple(args.simulator or ())
    require_runtime = bool(selected_ids) or args.require_all or _is_truthy_env(os.getenv(REQUIRE_SIMULATOR_LAUNCH_ENV))
    request = build_demo_world_open_request()
    expectations = LaunchExpectations(
        object_count=_active_object_count(request),
        camera_count=len(request.world_package.world_snapshot.cameras),
        duration_sec=args.duration_sec,
    )
    results = [
        _check_target(
            target,
            request=request,
            expectations=expectations,
            timeout_sec=args.timeout_sec,
            require_runtime=require_runtime,
        )
        for target in _selected_targets(selected_ids or None)
    ]

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "simulator_id": result.simulator_id,
                        "label": result.label,
                        "status": result.status,
                        "detail": result.detail,
                    }
                    for result in results
                ],
                indent=2,
            )
        )
    else:
        _print_human_results(results)
    return 0 if all(result.status != "failed" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
