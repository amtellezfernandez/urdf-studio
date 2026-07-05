from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from backend.models.simulator_runtime import (
    SimulatorId,
    SimulatorWorkspacePrepareRequest,
)
from backend.services.simulator_adapters.params import SimulatorWorkspaceProcessParams
from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
from backend.services.simulator_adapters.workspace_report_validation import (
    ExpectedCameraReport,
    ExpectedObjectReport,
)
from backend.services.world_layout_transfer_types import (
    ConcreteWorldLayoutFrameMap,
    WorldLayoutFrameMap,
)


@dataclass(frozen=True)
class PreparedWorkspaceCommand:
    command: list[str]
    ready_marker: str
    expected_object_marker: str
    expected_camera_log_marker: str
    extra_expected_markers: tuple[str, ...] = ()
    expected_image_paths: tuple[Path, ...] = ()
    expected_image_dirs: tuple[tuple[Path, int], ...] = ()
    expected_file_paths: tuple[Path, ...] = ()
    expected_file_validators: tuple[tuple[Path, Callable[[Path], str | None]], ...] = ()
    expected_report_path: Path | None = None
    expected_simulator_id: SimulatorId | None = None
    expected_object_count: int | None = None
    expected_camera_count: int | None = None
    expected_requested_frame_map: WorldLayoutFrameMap | None = None
    expected_frame_map: ConcreteWorldLayoutFrameMap | None = None
    expected_object_positions_xyz: Mapping[str, tuple[float, float, float]] | None = None
    expected_object_sizes_xyz: Mapping[str, tuple[float, float, float]] | None = None
    expected_object_asset_refs: Mapping[str, str | None] | None = None
    expected_object_contracts: Mapping[str, ExpectedObjectReport] | None = None
    expected_joint_positions: Mapping[str, float] | None = None
    expected_camera_ids: tuple[str, ...] | None = None
    expected_camera_contracts: Mapping[str, ExpectedCameraReport] | None = None
    expected_report_artifact_file_keys: tuple[str, ...] = ()
    expected_report_artifact_dir_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkspaceTarget:
    simulator_id: SimulatorId
    label: str
    prepare: Callable[[SimulatorWorkspacePrepareRequest, WorkspaceExpectations], PreparedWorkspaceCommand]
    requires_runtime: bool = True
    include_in_parity: bool = True


def _module_command(
    workspace_process: SimulatorWorkspaceProcessParams,
    *,
    world_package_path: Path,
    robot_asset_flag: str,
    robot_asset_path: Path,
    duration_sec: float,
    frame_map: WorldLayoutFrameMap = "auto",
    extra_args: Sequence[str] = (),
    report_path: Path | None = None,
) -> list[str]:
    report_args = ("--report", str(report_path)) if report_path is not None else ()
    return [
        sys.executable,
        "-u",
        "-m",
        workspace_process.module_name,
        "--world-package",
        str(world_package_path),
        robot_asset_flag,
        str(robot_asset_path),
        *extra_args,
        *report_args,
        "--frame-map",
        frame_map,
        "--no-viewer",
        "--duration-sec",
        str(duration_sec),
    ]


def _workspace_expectation_fields(
    expectations: WorkspaceExpectations,
) -> dict[str, object]:
    return {
        "expected_object_count": expectations.object_count,
        "expected_camera_count": expectations.camera_count,
        "expected_requested_frame_map": expectations.frame_map,
        "expected_frame_map": expectations.resolved_frame_map,
        "expected_object_positions_xyz": expectations.object_positions_xyz,
        "expected_object_sizes_xyz": expectations.object_sizes_xyz,
        "expected_object_asset_refs": expectations.object_asset_refs,
        "expected_object_contracts": expectations.object_contracts,
        "expected_joint_positions": expectations.joint_positions,
        "expected_camera_ids": expectations.camera_ids,
        "expected_camera_contracts": expectations.camera_contracts,
    }


def _prepare_direct_urdf_command(
    prepared: PreparedSimulatorWorkspace,
    *,
    simulator_id: SimulatorId,
    workspace_process: SimulatorWorkspaceProcessParams,
    object_marker: str,
    camera_log_marker: str | None = None,
    extra_expected_markers: tuple[str, ...] = (),
    extra_args: Sequence[str] = (),
    expected_image_paths: tuple[Path, ...] = (),
    expected_image_dirs: tuple[tuple[Path, int], ...] = (),
    expected_file_paths: tuple[Path, ...] = (),
    expected_file_validators: tuple[tuple[Path, Callable[[Path], str | None]], ...] = (),
    expected_report_path: Path | None = None,
    expected_report_artifact_file_keys: tuple[str, ...] = (),
    expected_report_artifact_dir_keys: tuple[str, ...] = (),
    expectations: WorkspaceExpectations,
) -> PreparedWorkspaceCommand:
    expected_camera_log_marker = camera_log_marker or f"cameras={expectations.camera_count}"
    return PreparedWorkspaceCommand(
        command=_module_command(
            workspace_process,
            world_package_path=prepared.world_package_path,
            robot_asset_flag="--robot-urdf",
            robot_asset_path=prepared.robot_urdf_path,
            duration_sec=expectations.duration_sec,
            frame_map=expectations.frame_map,
            extra_args=extra_args,
            report_path=expected_report_path,
        ),
        ready_marker=workspace_process.ready_log_marker,
        expected_object_marker=object_marker,
        expected_camera_log_marker=expected_camera_log_marker,
        extra_expected_markers=extra_expected_markers,
        expected_image_paths=expected_image_paths,
        expected_image_dirs=expected_image_dirs,
        expected_file_paths=expected_file_paths,
        expected_file_validators=expected_file_validators,
        expected_report_path=expected_report_path,
        expected_simulator_id=simulator_id,
        expected_report_artifact_file_keys=expected_report_artifact_file_keys,
        expected_report_artifact_dir_keys=expected_report_artifact_dir_keys,
        **_workspace_expectation_fields(expectations),
    )
